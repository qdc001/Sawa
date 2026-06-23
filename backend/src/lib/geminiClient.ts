// Cliente Gemini (Google Generative AI) com rate limit + retry.
//
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}
//
// Free tier (Jan 2026, gemini-2.5-flash):
//   ~10 RPM, ~250K TPM, ~1M tokens/dia. Limites bem maiores que a Groq.
//
// IMPORTANTE: no free tier, a Google usa os pedidos para treinar modelos.
// Para CRM com dados de clientes reais, recomenda-se plano pago da Google
// (paid tier nao usa dados). Esta opcao fica documentada na env.

import crypto from 'crypto';

const RPM_LIMIT = Number(process.env.GEMINI_RPM || 10);
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 5);
const MAX_RETRY_AFTER_MS = 30_000;

const requestTimestamps: number[] = [];
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

// =====================================================================
// Pool de chaves Gemini com rotacao automatica em quota diaria esgotada
// =====================================================================
//
// Configuracao: GEMINI_API_KEY (obrigatoria) + GEMINI_API_KEY_2..GEMINI_API_KEY_10
// (opcionais). Cada chave deve vir de uma conta Google diferente para que o
// limite diario seja independente.

const API_KEY_POOL: string[] = (() => {
  const keys: string[] = [];
  const first = process.env.GEMINI_API_KEY;
  if (first && first.trim()) keys.push(first.trim());
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return keys;
})();

// Chave -> timestamp ms ate quando esta marcada como esgotada (quota diaria).
// Gemini reseta a meia-noite no fuso horario de Pacifico (PT), aproximadamente
// 08:00 UTC. Para simplificar e ser conservador, usamos meia-noite UTC + 8h.
const exhaustedUntil = new Map<string, number>();

function nextResetMs(): number {
  const now = new Date();
  // Proxima meia-noite UTC + 8h (cobre o reset em PT). Conservador.
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return utcMidnight + 8 * 60 * 60_000;
}

function markGeminiKeyExhausted(key: string): void {
  exhaustedUntil.set(key, nextResetMs());
  console.warn(`[gemini] chave ${key.slice(0, 12)}... marcada como esgotada ate ${new Date(nextResetMs()).toISOString()}`);
}

function getActiveGeminiKey(skip?: string): string | null {
  const now = Date.now();
  for (const k of API_KEY_POOL) {
    if (skip && k === skip) continue;
    const until = exhaustedUntil.get(k);
    if (until && until > now) continue;
    return k;
  }
  return null;
}

export function getGeminiKeyPoolStatus() {
  const now = Date.now();
  return API_KEY_POOL.map((k) => {
    const until = exhaustedUntil.get(k);
    return {
      keyPreview: `${k.slice(0, 8)}...${k.slice(-4)}`,
      healthy: !until || until <= now,
      exhaustedUntil: until && until > now ? new Date(until).toISOString() : null,
    };
  });
}

// Detecta erros que indicam que a quota diaria desta chave esta esgotada.
// Gemini devolve 429 com mensagens que mencionam "quota" ou "exceeded".
// Para distinguir de RPM transiente (que tambem da 429), tentamos detectar
// PerDay/Daily ou ausencia de retry-after curto.
function isGeminiQuotaExhausted(detail: string, retryAfterMs: number | null): boolean {
  const d = detail.toLowerCase();
  if (d.includes('perday') || d.includes('per day') || d.includes('daily') || d.includes('quota')) return true;
  // Se o servidor pede para esperar mais de 5 minutos, e quota diaria
  if (retryAfterMs && retryAfterMs > 5 * 60_000) return true;
  return false;
}

function purgeOldTimestamps() {
  const cutoff = Date.now() - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) requestTimestamps.shift();
}

async function waitForSlot(): Promise<void> {
  while (true) {
    purgeOldTimestamps();
    if (requestTimestamps.length < RPM_LIMIT) {
      requestTimestamps.push(Date.now());
      return;
    }
    const waitMs = 60_000 - (Date.now() - requestTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(50, waitMs)));
  }
}

function hashKey(payload: any): string {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function cacheGet(key: string): string | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, e);
  return e.value;
}

function cacheSet(key: string, value: string) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const f = cache.keys().next().value;
    if (f) cache.delete(f);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

type LlmMsg = { role: 'system' | 'user' | 'assistant'; content: string };

// Converte mensagens estilo OpenAI/Groq para o formato Gemini:
//   - todas as system messages sao concatenadas em systemInstruction
//   - user -> role: 'user', assistant -> role: 'model'
//   - mensagens consecutivas do mesmo role sao juntas (Gemini exige alternancia)
function toGeminiBody(messages: LlmMsg[], temperature: number, maxTokens: number, jsonMode: boolean) {
  const systemTexts: string[] = [];
  const turns: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const m of messages) {
    if (m.role === 'system') { systemTexts.push(m.content); continue; }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    // Juntar com a mensagem anterior se for do mesmo role
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].parts.push({ text: m.content });
    } else {
      turns.push({ role, parts: [{ text: m.content }] });
    }
  }

  // Gemini exige que a conversa comece com role=user
  if (turns.length === 0 || turns[0].role !== 'user') {
    turns.unshift({ role: 'user', parts: [{ text: '(continuar)' }] });
  }

  const body: any = {
    contents: turns,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  if (systemTexts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
  }
  if (jsonMode) {
    body.generationConfig.responseMimeType = 'application/json';
  }
  return body;
}

async function geminiRequest(model: string, body: any): Promise<{ raw: string; promptTokens?: number; completionTokens?: number }> {
  if (API_KEY_POOL.length === 0) {
    throw Object.assign(new Error('GEMINI_API_KEY nao configurada'), { status: 500 });
  }

  // Resolve a primeira chave saudavel do pool.
  let currentKey = getActiveGeminiKey() || API_KEY_POOL[0];
  const triedKeys = new Set<string>();

  let lastErr: any = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    triedKeys.add(currentKey);
    await waitForSlot();
    let res: Response;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${currentKey}`;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = Object.assign(new Error(`Rede: ${e.message}`), { status: 502 });
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      const data: any = await res.json().catch(() => null);
      if (!data) throw Object.assign(new Error('Resposta invalida do Gemini'), { status: 502 });
      const candidate = data.candidates?.[0];
      const finish = candidate?.finishReason;
      if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
        throw Object.assign(new Error(`Gemini terminou com motivo ${finish}: ${JSON.stringify(candidate?.safetyRatings || {})}`), { status: 502 });
      }
      const text = candidate?.content?.parts?.map((p: any) => p?.text || '').filter(Boolean).join('') || '';
      if (!text) throw Object.assign(new Error('Gemini devolveu resposta vazia'), { status: 502 });
      return {
        raw: text,
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      };
    }

    let detail = `HTTP ${res.status}`;
    let bodyText = '';
    try {
      bodyText = await res.text();
      const j = JSON.parse(bodyText);
      detail = j?.error?.message || j?.message || detail;
    } catch {
      if (bodyText) detail = bodyText.slice(0, 300);
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Math.min(MAX_RETRY_AFTER_MS, Math.max(500, Number(retryAfterHeader) * 1000))
        : 1000 * 2 ** (attempt + 1);

      // Se parece quota diaria desta chave, marca como esgotada e tenta a proxima
      if (isGeminiQuotaExhausted(detail, retryAfterMs)) {
        markGeminiKeyExhausted(currentKey);
        const next = getActiveGeminiKey();
        if (next && !triedKeys.has(next)) {
          console.warn(`[gemini] a rodar para chave alternativa ${next.slice(0, 12)}...`);
          currentKey = next;
          continue;
        }
        console.warn(`[gemini] todas as chaves do pool esgotadas. A falhar.`);
        throw Object.assign(new Error(`429: ${detail}`), { status: 429, dailyExhausted: true });
      }

      // 429 transiente (RPM). Backoff curto.
      lastErr = Object.assign(new Error(`429: ${detail}`), { status: 429, retryAfterMs });
      console.warn(`[gemini] 429 (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${retryAfterMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }
      throw lastErr;
    }

    if (res.status >= 500 && res.status < 600) {
      // Backoff mais agressivo para 5xx (alta demanda no 2.5-flash e comum).
      // Sequencia: 2s, 4s, 8s, 16s, 25s. Total ~55s antes de desistir.
      const backoffMs = Math.min(25_000, 2000 * 2 ** attempt);
      lastErr = Object.assign(new Error(`${res.status}: ${detail}`), { status: res.status });
      console.warn(`[gemini] ${res.status} transiente (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${backoffMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw lastErr;
    }

    throw Object.assign(new Error(detail), { status: res.status });
  }
  throw lastErr || Object.assign(new Error('Gemini: esgotaram-se as tentativas'), { status: 502 });
}

export async function callGeminiText(
  model: string,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<string> {
  const cacheKey = hashKey({ model, messages, maxTokens, json: false });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const body = toGeminiBody(messages, temperature, maxTokens, false);
  const { raw } = await geminiRequest(model, body);
  cacheSet(cacheKey, raw);
  return raw;
}

export async function callGeminiJson<T = any>(
  model: string,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<{ json: T; raw: string; promptTokens?: number; completionTokens?: number }> {
  const body = toGeminiBody(messages, temperature, maxTokens, true);
  const result = await geminiRequest(model, body);
  let json: any;
  try { json = JSON.parse(result.raw); } catch {
    throw Object.assign(new Error('Gemini devolveu conteudo nao-JSON: ' + result.raw.slice(0, 200)), { status: 502 });
  }
  return { json: json as T, raw: result.raw, promptTokens: result.promptTokens, completionTokens: result.completionTokens };
}

export function getGeminiStats() {
  purgeOldTimestamps();
  return {
    rpmLimit: RPM_LIMIT,
    requestsInLastMinute: requestTimestamps.length,
    cacheSize: cache.size,
    apiKeyPool: getGeminiKeyPoolStatus(),
  };
}
