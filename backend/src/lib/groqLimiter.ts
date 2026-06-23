// Rate limiter + retry com backoff + cache LRU para chamadas à Groq.
//
// Objectivo: nunca mostrar ao utilizador "Limite de pedidos da Groq atingido".
//
// 3 camadas de defesa:
//   1. Cache LRU — pedidos idênticos (mesmo prompt + modelo) reutilizam resposta
//      durante 10 min. Cobre cliques duplos no botão "Resumir" e refreshs.
//   2. Token bucket — limita-nos a N pedidos por minuto antes de chegarmos
//      ao limite real da Groq. Se a janela está cheia, AWAITAMOS até abrir.
//   3. Retry com backoff exponencial — se mesmo assim a Groq devolver 429
//      (ex: outra app a usar a mesma chave), tentamos de novo até 3x
//      com waits de 2s, 4s, 8s.
//
// Free tier Groq (Maio 2026): ~30 req/min RPM e 6000 tokens/min TPM por modelo.
// Default conservador: 25 RPM para deixar margem. Override via env GROQ_RPM.

import crypto from 'crypto';

const RPM_LIMIT = Number(process.env.GROQ_RPM || 25);
const CACHE_TTL_MS = 10 * 60_000; // 10 min
const CACHE_MAX_ENTRIES = 200;
const MAX_RETRIES = 3;
// Cap absoluto do backoff entre tentativas (30s). A Groq por vezes devolve
// retry-after de varios minutos (quando o limite TPD diario foi atingido),
// o que prende o worker. Preferimos falhar rapido e deixar o caller decidir.
const MAX_RETRY_AFTER_MS = 30_000;

// Detecta limites diarios irrecuperaveis (TPD). Quando esgotado, nao adianta
// retry com a mesma chave: a quota so refresca dali a horas. Em vez disso,
// rodamos para a proxima chave do pool, se houver.
function isDailyQuotaExhausted(detail: string): boolean {
  const d = detail.toLowerCase();
  return d.includes('tokens per day') || d.includes('tpd') || d.includes('requests per day') || d.includes('rpd');
}

// =====================================================================
// Pool de chaves Groq com rotacao automatica em TPD esgotado
// =====================================================================
//
// Configuracao: GROQ_API_KEY (obrigatoria) + GROQ_API_KEY_2..GROQ_API_KEY_10
// (opcionais). Cada uma deve ser de uma conta Groq diferente para o limite
// TPD ser independente.

const API_KEY_POOL: string[] = (() => {
  const keys: string[] = [];
  const first = process.env.GROQ_API_KEY;
  if (first && first.trim()) keys.push(first.trim());
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return keys;
})();

// Chave -> timestamp ms ate quando esta marcada como esgotada (TPD).
// Reset diario na Groq e a meia-noite UTC.
const exhaustedUntil = new Map<string, number>();

function nextResetMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 60_000;
}

export function markKeyExhausted(key: string): void {
  exhaustedUntil.set(key, nextResetMs());
  console.warn(`[groq] chave ${key.slice(0, 12)}... marcada como TPD esgotada ate ${new Date(nextResetMs()).toISOString()}`);
}

// Devolve a primeira chave saudavel do pool, opcionalmente excluindo uma.
// Devolve null se todas estao esgotadas.
export function getActiveApiKey(skip?: string): string | null {
  const now = Date.now();
  for (const k of API_KEY_POOL) {
    if (skip && k === skip) continue;
    const until = exhaustedUntil.get(k);
    if (until && until > now) continue;
    return k;
  }
  return null;
}

export function getApiKeyPoolStatus() {
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

// Modelo de fallback usado quando o modelo principal esgota TPD em TODAS as
// chaves do pool. Pode ser configurado via env GROQ_MODEL_FALLBACK. Tipico:
// principal = llama-3.3-70b-versatile (qualidade alta, 100K TPD)
// fallback  = meta-llama/llama-4-scout-17b-16e-instruct (qualidade ok, 500K TPD)
const FALLBACK_MODEL: string | null = (process.env.GROQ_MODEL_FALLBACK || '').trim() || null;

// Marca um modelo como esgotado em todas as chaves ate ao reset diario, para
// evitar redescobrir o mesmo problema em cada pedido durante o dia.
const modelExhaustedUntil = new Map<string, number>();

function isModelExhausted(model: string): boolean {
  const until = modelExhaustedUntil.get(model);
  return !!(until && until > Date.now());
}

function markModelExhausted(model: string): void {
  modelExhaustedUntil.set(model, nextResetMs());
  console.warn(`[groq] modelo ${model} marcado como TPD esgotado em todas as chaves ate ${new Date(nextResetMs()).toISOString()}`);
}

// Token bucket: timestamps dos pedidos no último minuto.
const requestTimestamps: number[] = [];

// Cache LRU simples: Map mantém ordem de inserção, removemos o mais antigo quando enche.
const cache = new Map<string, { value: string; expiresAt: number }>();

function purgeOldTimestamps() {
  const cutoff = Date.now() - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

async function waitForSlot(): Promise<void> {
  while (true) {
    purgeOldTimestamps();
    if (requestTimestamps.length < RPM_LIMIT) {
      requestTimestamps.push(Date.now());
      return;
    }
    // Esperar até o pedido mais antigo expirar
    const waitMs = 60_000 - (Date.now() - requestTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(50, waitMs)));
  }
}

function hashKey(payload: any): string {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function cacheGet(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refrescar ordem LRU
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: string) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Remover o mais antigo (primeiro da Map)
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface GroqError extends Error {
  status?: number;
  retryAfterMs?: number;
}

// Faz o pedido a Groq com rate limit e retry. Devolve string com a resposta.
// O caller fica responsável por transformar erros não-recuperáveis em AppError.
export async function callGroqWithLimiter(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature = 0.7,
): Promise<string> {
  // Se este modelo ja esta marcado como esgotado em todas as chaves, salta
  // directo para o fallback (se existir) sem perder tempo a pedir.
  if (isModelExhausted(model) && FALLBACK_MODEL && model !== FALLBACK_MODEL && !isModelExhausted(FALLBACK_MODEL)) {
    console.warn(`[groq] modelo ${model} pre-marcado como esgotado, a usar fallback ${FALLBACK_MODEL}`);
    return callGroqWithLimiter(apiKey, FALLBACK_MODEL, messages, maxTokens, temperature);
  }

  // 1. Cache lookup
  const cacheKey = hashKey({ model, messages, maxTokens });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // Resolve a chave actual a usar: se a passada esta marcada como esgotada,
  // tenta a proxima saudavel do pool antes de comecar.
  let currentKey: string = apiKey;
  if (exhaustedUntil.get(currentKey)) {
    const alt = getActiveApiKey(currentKey);
    if (alt) currentKey = alt;
  }

  let lastErr: GroqError | null = null;
  const triedKeys = new Set<string>();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    triedKeys.add(currentKey);
    // 2. Esperar slot do nosso rate limit interno
    await waitForSlot();

    // 3. Pedido HTTP
    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentKey}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
      });
    } catch (e: any) {
      lastErr = Object.assign(new Error(`Rede: ${e.message}`), { status: 502 });
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      let data: any;
      try { data = await res.json(); } catch (e: any) {
        throw Object.assign(new Error('Resposta inválida da Groq'), { status: 502 });
      }
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw Object.assign(new Error('Groq devolveu resposta vazia'), { status: 502 });
      cacheSet(cacheKey, content);
      return content;
    }

    // Não-OK
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
      if (isDailyQuotaExhausted(detail)) {
        markKeyExhausted(currentKey);
        // Tenta rotar para a proxima chave saudavel do pool (que ainda nao tentamos)
        const next = getActiveApiKey();
        if (next && !triedKeys.has(next)) {
          console.warn(`[groq] a rodar para chave alternativa ${next.slice(0, 12)}...`);
          currentKey = next;
          continue; // refaz a tentativa com a nova chave (nao conta como retry exhaustivo)
        }
        // Todas as chaves esgotadas para este modelo: marca o modelo e
        // tenta o fallback (se configurado e ainda nao esgotado).
        markModelExhausted(model);
        if (FALLBACK_MODEL && model !== FALLBACK_MODEL && !isModelExhausted(FALLBACK_MODEL)) {
          console.warn(`[groq] todas as chaves esgotadas para ${model}, a usar fallback ${FALLBACK_MODEL}`);
          return callGroqWithLimiter(apiKey, FALLBACK_MODEL, messages, maxTokens, temperature);
        }
        console.warn(`[groq] todas as chaves do pool esgotadas e sem fallback disponivel. A falhar.`);
        throw Object.assign(new Error(`429: ${detail}`), { status: 429, dailyExhausted: true });
      }
      // Rate limit transiente (RPM/TPM). Backoff capado a 30s.
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Math.min(MAX_RETRY_AFTER_MS, Math.max(500, Number(retryAfterHeader) * 1000))
        : 1000 * 2 ** (attempt + 1);
      lastErr = Object.assign(new Error(`429: ${detail}`), { status: 429, retryAfterMs });
      console.warn(`[groq] 429 rate limit (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${retryAfterMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }
      throw lastErr;
    }

    // 500/502/503 sao tipicamente transientes do lado da Groq (alta demanda,
    // restart de instancia). Retry com backoff antes de desistir.
    if (res.status >= 500 && res.status < 600) {
      const backoffMs = Math.min(10_000, 1000 * 2 ** attempt);
      lastErr = Object.assign(new Error(`${res.status}: ${detail}`), { status: res.status });
      console.warn(`[groq] ${res.status} transiente (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${backoffMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw lastErr;
    }

    throw Object.assign(new Error(detail), { status: res.status });
  }

  throw lastErr || Object.assign(new Error('Groq: esgotaram-se as tentativas'), { status: 502 });
}

// Variante em JSON-mode: forca a Groq a devolver JSON valido.
// Util para o agente IA Vendedora, que precisa de output estruturado
// (parts, action, productId, reasoning, principles).
//
// Diferencas para callGroqWithLimiter:
//  - response_format: { type: "json_object" } passado a API
//  - devolve o objecto ja parseado, nao a string crua
//  - inclui contagem de tokens (usage) para auditoria/custos
//  - tipa o resultado como T generico para o caller
export async function callGroqJsonWithLimiter<T = any>(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature = 0.7,
): Promise<{ json: T; raw: string; promptTokens?: number; completionTokens?: number }> {
  // Sem cache: cada chamada do agente e contextual e o LRU partilhado
  // poderia devolver respostas erradas para conversas diferentes.

  // Salta directo para fallback se o modelo principal ja esta esgotado.
  if (isModelExhausted(model) && FALLBACK_MODEL && model !== FALLBACK_MODEL && !isModelExhausted(FALLBACK_MODEL)) {
    console.warn(`[groq-json] modelo ${model} pre-marcado como esgotado, a usar fallback ${FALLBACK_MODEL}`);
    return callGroqJsonWithLimiter<T>(apiKey, FALLBACK_MODEL, messages, maxTokens, temperature);
  }

  let currentKey: string = apiKey;
  if (exhaustedUntil.get(currentKey)) {
    const alt = getActiveApiKey(currentKey);
    if (alt) currentKey = alt;
  }

  let lastErr: GroqError | null = null;
  const triedKeys = new Set<string>();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    triedKeys.add(currentKey);
    await waitForSlot();

    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentKey}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          messages,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (e: any) {
      lastErr = Object.assign(new Error(`Rede: ${e.message}`), { status: 502 });
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      let data: any;
      try { data = await res.json(); } catch {
        throw Object.assign(new Error('Resposta invalida da Groq (nao-JSON envelope)'), { status: 502 });
      }
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) throw Object.assign(new Error('Groq devolveu resposta vazia'), { status: 502 });
      let json: any;
      try { json = JSON.parse(raw); } catch {
        throw Object.assign(new Error('Groq JSON-mode devolveu conteudo nao-JSON: ' + raw.slice(0, 200)), { status: 502 });
      }
      return {
        json: json as T,
        raw,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
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
      if (isDailyQuotaExhausted(detail)) {
        markKeyExhausted(currentKey);
        const next = getActiveApiKey();
        if (next && !triedKeys.has(next)) {
          console.warn(`[groq-json] a rodar para chave alternativa ${next.slice(0, 12)}...`);
          currentKey = next;
          continue;
        }
        markModelExhausted(model);
        if (FALLBACK_MODEL && model !== FALLBACK_MODEL && !isModelExhausted(FALLBACK_MODEL)) {
          console.warn(`[groq-json] todas as chaves esgotadas para ${model}, a usar fallback ${FALLBACK_MODEL}`);
          return callGroqJsonWithLimiter<T>(apiKey, FALLBACK_MODEL, messages, maxTokens, temperature);
        }
        console.warn(`[groq-json] todas as chaves esgotadas e sem fallback. A falhar.`);
        throw Object.assign(new Error(`429: ${detail}`), { status: 429, dailyExhausted: true });
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader
        ? Math.min(MAX_RETRY_AFTER_MS, Math.max(500, Number(retryAfterHeader) * 1000))
        : 1000 * 2 ** (attempt + 1);
      lastErr = Object.assign(new Error(`429: ${detail}`), { status: 429, retryAfterMs });
      console.warn(`[groq-json] 429 (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${retryAfterMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }
      throw lastErr;
    }

    if (res.status >= 500 && res.status < 600) {
      const backoffMs = Math.min(10_000, 1000 * 2 ** attempt);
      lastErr = Object.assign(new Error(`${res.status}: ${detail}`), { status: res.status });
      console.warn(`[groq-json] ${res.status} transiente (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${backoffMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw lastErr;
    }

    throw Object.assign(new Error(detail), { status: res.status });
  }

  throw lastErr || Object.assign(new Error('Groq JSON: esgotaram-se as tentativas'), { status: 502 });
}

// Diagnóstico
export function getLimiterStats() {
  purgeOldTimestamps();
  return {
    rpmLimit: RPM_LIMIT,
    requestsInLastMinute: requestTimestamps.length,
    cacheSize: cache.size,
    cacheTtlMin: CACHE_TTL_MS / 60_000,
    apiKeyPool: getApiKeyPoolStatus(),
  };
}
