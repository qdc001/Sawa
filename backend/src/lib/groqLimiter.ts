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
// retry: a quota so refresca dali a horas. Devolve true para falhar imediato.
function isDailyQuotaExhausted(detail: string): boolean {
  const d = detail.toLowerCase();
  return d.includes('tokens per day') || d.includes('tpd') || d.includes('requests per day') || d.includes('rpd');
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
  // 1. Cache lookup
  const cacheKey = hashKey({ model, messages, maxTokens });
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let lastErr: GroqError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // 2. Esperar slot do nosso rate limit interno
    await waitForSlot();

    // 3. Pedido HTTP
    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
      });
    } catch (e: any) {
      lastErr = Object.assign(new Error(`Rede: ${e.message}`), { status: 502 });
      // Backoff e tentar de novo
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
      // Quota diaria esgotada: nao vale a pena retry (so refresca dali a horas).
      if (isDailyQuotaExhausted(detail)) {
        console.warn(`[groq] 429 quota diaria esgotada. A falhar imediato sem retry.`);
        throw Object.assign(new Error(`429: ${detail}`), { status: 429, dailyExhausted: true });
      }
      // Rate limit transiente. Honra header retry-after capado a 30s para nao
      // prender o worker; senao backoff 2s/4s/8s.
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

    // Outro erro — não vale a pena retry
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

  let lastErr: GroqError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForSlot();

    let res: Response;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
        // O modelo nao respeitou o json_object. Devolvemos string solta envelopada.
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
        console.warn(`[groq-json] 429 quota diaria esgotada. A falhar imediato sem retry.`);
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
  };
}
