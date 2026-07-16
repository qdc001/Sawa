// Cliente DeepSeek com retry + rate limit + pool opcional de chaves.
//
// Endpoint: POST https://api.deepseek.com/v1/chat/completions
// Auth: Authorization: Bearer sk-...
//
// A API do DeepSeek e OpenAI-compatible, portanto o formato de messages
// e o mesmo do OpenAI/Groq. Nao ha conversao como no Gemini.
//
// Cache de prompt: o DeepSeek cacheia automaticamente prefixos repetidos
// (ate 24h de TTL) e cobra 90% menos os tokens em cache. A resposta
// devolve prompt_cache_hit_tokens / prompt_cache_miss_tokens para
// telemetria; nao ha nada a configurar do nosso lado.
//
// Modelos actuais: deepseek-v4-flash (barato, rapido) e deepseek-v4-pro
// (mais capaz). V4 tem reasoning nativo que consome tokens extra e sai
// como reasoning_content na resposta; ignoramos e usamos so content.
//
// Configuracao (env):
//   DEEPSEEK_API_KEY       -> chave sk-... (obrigatoria se LLM_PROVIDER=deepseek)
//   DEEPSEEK_API_KEY_2..10 -> pool opcional para escalar RPM
//   DEEPSEEK_MODEL         -> default: deepseek-v4-flash
//   DEEPSEEK_RPM           -> limite local (default 60, generoso)

import crypto from 'crypto';

const RPM_LIMIT = Number(process.env.DEEPSEEK_RPM || 60);
const MAX_RETRIES = Number(process.env.DEEPSEEK_MAX_RETRIES || 4);
const MAX_RETRY_AFTER_MS = 30_000;

const requestTimestamps: number[] = [];
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

const API_KEY_POOL: string[] = (() => {
  const keys: string[] = [];
  const first = process.env.DEEPSEEK_API_KEY;
  if (first && first.trim()) keys.push(first.trim());
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`DEEPSEEK_API_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return keys;
})();

const exhaustedUntil = new Map<string, number>();

function markKeyExhausted(key: string, until: number): void {
  exhaustedUntil.set(key, until);
  console.warn(`[deepseek] chave ${key.slice(0, 8)}... marcada como esgotada ate ${new Date(until).toISOString()}`);
}

function getActiveKey(skip?: string): string | null {
  const now = Date.now();
  for (const k of API_KEY_POOL) {
    if (skip && k === skip) continue;
    const until = exhaustedUntil.get(k);
    if (until && until > now) continue;
    return k;
  }
  return null;
}

export function getDeepseekKeyPoolStatus() {
  const now = Date.now();
  return API_KEY_POOL.map((k) => {
    const until = exhaustedUntil.get(k);
    return {
      keyPreview: `${k.slice(0, 6)}...${k.slice(-4)}`,
      healthy: !until || until <= now,
      exhaustedUntil: until && until > now ? new Date(until).toISOString() : null,
    };
  });
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

async function deepseekRequest(
  model: string,
  messages: LlmMsg[],
  temperature: number,
  maxTokens: number,
  jsonMode: boolean,
): Promise<{ raw: string; promptTokens?: number; completionTokens?: number; cacheHitTokens?: number }> {
  if (API_KEY_POOL.length === 0) {
    throw Object.assign(new Error('DEEPSEEK_API_KEY nao configurada'), { status: 500 });
  }

  let currentKey = getActiveKey() || API_KEY_POOL[0];
  const triedKeys = new Set<string>();

  // DeepSeek V4 tem reasoning nativo que consome ~200-500 tokens antes de
  // gerar o content visivel. Se max_tokens for apertado (ex: 1000 no coach),
  // o reasoning come tudo e o content sai vazio. Expandimos 4x com cap de
  // 8192, similar ao que fazemos no Gemini. Nao afecta preco porque o
  // DeepSeek so cobra os tokens realmente gerados.
  const expandedMax = Math.min(8192, Math.max(maxTokens, maxTokens * 4));

  // DeepSeek em response_format=json_object EXIGE mencao explicita a "JSON"
  // nas mensagens (doc oficial), senao gera reasoning + content vazio. Ao
  // contrario do Groq/OpenAI que sao permissivos. Se nenhuma mensagem
  // referir JSON, appendamos uma instrucao curta ao ultimo system para
  // desbloquear o modelo sem alterar semantica.
  let effectiveMessages = messages;
  if (jsonMode) {
    const anyMentionsJson = messages.some((m) => /json/i.test(m.content));
    if (!anyMentionsJson) {
      effectiveMessages = [...messages];
      // Encontra ultimo system para appendar; se nao houver, cria um.
      const lastSystemIdx = [...effectiveMessages].reverse().findIndex((m) => m.role === 'system');
      const suffix = '\n\nDevolve SEMPRE a resposta como um objecto JSON valido.';
      if (lastSystemIdx === -1) {
        effectiveMessages.unshift({ role: 'system', content: 'Devolve SEMPRE a resposta como um objecto JSON valido.' });
      } else {
        const realIdx = effectiveMessages.length - 1 - lastSystemIdx;
        effectiveMessages[realIdx] = { ...effectiveMessages[realIdx], content: effectiveMessages[realIdx].content + suffix };
      }
    }
  }

  const body: any = {
    model,
    messages: effectiveMessages,
    temperature,
    max_tokens: expandedMax,
    stream: false,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let lastErr: any = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    triedKeys.add(currentKey);
    await waitForSlot();
    let res: Response;
    try {
      res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      lastErr = Object.assign(new Error(`Rede: ${e.message}`), { status: 502 });
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }

    if (res.ok) {
      const data: any = await res.json().catch(() => null);
      if (!data) throw Object.assign(new Error('Resposta invalida do DeepSeek'), { status: 502 });
      const choice = data.choices?.[0];
      const text: string = (choice?.message?.content || '').trim();
      const finish = choice?.finish_reason;
      const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
      const completionTokens = data.usage?.completion_tokens;
      if (!text) {
        // Content vazio: quase sempre reasoning ate esgotar max_tokens.
        // Devolve mensagem descritiva para o diagnostico.
        const detail = reasoningTokens
          ? `reasoning consumiu ${reasoningTokens}/${completionTokens} tokens, nao sobrou para o content (finish=${finish}, max_tokens=${expandedMax}). Aumenta max_tokens ou muda para deepseek-v4-pro que tem thinking mais eficiente.`
          : `content vazio, finish=${finish}, tokens=${completionTokens}`;
        throw Object.assign(new Error(`DeepSeek devolveu resposta vazia: ${detail}`), { status: 502 });
      }
      if (finish === 'length') {
        console.warn(`[deepseek] resposta truncada (finish=length). completion=${completionTokens} reasoning=${reasoningTokens || 0}. Amostra: ${text.slice(0, 200)}`);
      }
      return {
        raw: text,
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        cacheHitTokens: data.usage?.prompt_cache_hit_tokens,
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

      // Se retry longo, provavelmente quota/creditos. Marca a chave por 1h
      // e roda para a proxima do pool. DeepSeek nao tem quota "diaria" tao
      // rigida como o Gemini free tier, mas pode falhar por saldo.
      if (retryAfterMs > 5 * 60_000 || /balance|credit|quota/i.test(detail)) {
        markKeyExhausted(currentKey, Date.now() + 60 * 60_000);
        const next = getActiveKey();
        if (next && !triedKeys.has(next)) {
          console.warn(`[deepseek] a rodar para chave alternativa ${next.slice(0, 8)}...`);
          currentKey = next;
          continue;
        }
        throw Object.assign(new Error(`429: ${detail}`), { status: 429 });
      }

      lastErr = Object.assign(new Error(`429: ${detail}`), { status: 429, retryAfterMs });
      console.warn(`[deepseek] 429 (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${retryAfterMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, retryAfterMs));
        continue;
      }
      throw lastErr;
    }

    if (res.status >= 500 && res.status < 600) {
      const backoffMs = Math.min(20_000, 2000 * 2 ** attempt);
      lastErr = Object.assign(new Error(`${res.status}: ${detail}`), { status: res.status });
      console.warn(`[deepseek] ${res.status} transiente (tentativa ${attempt + 1}/${MAX_RETRIES + 1}). A esperar ${backoffMs}ms.`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw lastErr;
    }

    // 401/403 (chave invalida) e 4xx nao-transientes: fail rapido.
    throw Object.assign(new Error(detail), { status: res.status });
  }
  throw lastErr || Object.assign(new Error('DeepSeek: esgotaram-se as tentativas'), { status: 502 });
}

export async function callDeepseekText(
  model: string,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<string> {
  const cacheKey = hashKey({ model, messages, maxTokens, json: false });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const { raw } = await deepseekRequest(model, messages, temperature, maxTokens, false);
  cacheSet(cacheKey, raw);
  return raw;
}

// Tenta extrair um objecto JSON de dentro de texto livre (usado em fallback).
function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  // Preferir fence ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // Ou primeiro { ... } equilibrado
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return null;
}

export async function callDeepseekJson<T = any>(
  model: string,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<{ json: T; raw: string; promptTokens?: number; completionTokens?: number }> {
  let result: { raw: string; promptTokens?: number; completionTokens?: number };
  try {
    result = await deepseekRequest(model, messages, temperature, maxTokens, true);
  } catch (e: any) {
    // DeepSeek em jsonMode as vezes devolve content vazio quando o prompt e
    // longo (historico grande) ou quando ja respondeu em turnos anteriores.
    // Retry sem response_format (modo texto livre) e extraimos o JSON.
    if (e?.status === 502 && /resposta vazia/i.test(e?.message || '')) {
      console.warn('[deepseek] retry sem response_format apos content vazio em jsonMode');
      const alt = await deepseekRequest(model, messages, temperature, maxTokens, false);
      const block = extractJsonBlock(alt.raw);
      if (!block) {
        throw Object.assign(new Error(`DeepSeek fallback: nao encontrei JSON no texto livre: ${alt.raw.slice(0, 200)}`), { status: 502 });
      }
      try {
        const json = JSON.parse(block);
        return { json: json as T, raw: block, promptTokens: alt.promptTokens, completionTokens: alt.completionTokens };
      } catch (parseErr: any) {
        throw Object.assign(new Error(`DeepSeek fallback: JSON invalido: ${parseErr.message}. Bruto: ${block.slice(0, 200)}`), { status: 502 });
      }
    }
    throw e;
  }
  let json: any;
  try { json = JSON.parse(result.raw); } catch {
    // Segunda tentativa: extrair de dentro do texto (o modelo as vezes envolve em markdown apesar do jsonMode).
    const block = extractJsonBlock(result.raw);
    if (block) {
      try { json = JSON.parse(block); }
      catch {
        throw Object.assign(new Error('DeepSeek devolveu conteudo nao-JSON: ' + result.raw.slice(0, 200)), { status: 502 });
      }
    } else {
      throw Object.assign(new Error('DeepSeek devolveu conteudo nao-JSON: ' + result.raw.slice(0, 200)), { status: 502 });
    }
  }
  return { json: json as T, raw: result.raw, promptTokens: result.promptTokens, completionTokens: result.completionTokens };
}

export function getDeepseekStats() {
  purgeOldTimestamps();
  return {
    rpmLimit: RPM_LIMIT,
    requestsInLastMinute: requestTimestamps.length,
    cacheSize: cache.size,
    apiKeyPool: getDeepseekKeyPoolStatus(),
  };
}
