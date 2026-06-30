// Camada de abstraccao entre o codigo aplicacional e o provider LLM activo.
//
// Permite alternar entre Groq e Gemini sem tocar nos call sites: basta mudar
// a env LLM_PROVIDER. Continua a usar Groq para transcricao de audio
// (whisper), que e endpoint diferente e nao tem equivalente directo no
// Gemini.
//
// Variaveis de ambiente:
//   LLM_PROVIDER       = "groq" (default) | "gemini"
//   GROQ_API_KEY       = chave Groq (e GROQ_API_KEY_2..10 para pool)
//   GROQ_MODEL         = modelo Groq default (ex: llama-3.3-70b-versatile)
//   GEMINI_API_KEY     = chave Google AI Studio
//   GEMINI_MODEL       = modelo Gemini default (ex: gemini-2.5-flash)

import { callGroqWithLimiter, callGroqJsonWithLimiter, getLimiterStats } from './groqLimiter';
import { callGeminiText, callGeminiJson, getGeminiStats } from './geminiClient';
import { checkLimitOrThrow, recordUsage, LlmFeature } from './aiUsage';

export type LlmProvider = 'groq' | 'gemini';
export type LlmMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmTrackOpts = {
  workspaceId?: string;
  feature?: LlmFeature;
  // Forca um provider especifico, ignorando a env LLM_PROVIDER. Util para
  // features sensiveis a truncamento (ex: sugestoes de resposta) que correm
  // melhor num provider especifico.
  forceProvider?: LlmProvider;
};

function resolveProviderAndModel(
  modelOverride: string | null | undefined,
  forceProvider?: LlmProvider,
): { provider: LlmProvider; model: string } {
  const provider = forceProvider || getActiveLlmProvider();
  if (modelOverride && modelOverride.trim()) {
    return { provider, model: modelOverride.trim() };
  }
  const model = provider === 'gemini'
    ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash')
    : (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
  return { provider, model };
}

export function getActiveLlmProvider(): LlmProvider {
  return (process.env.LLM_PROVIDER || 'groq').toLowerCase() === 'gemini' ? 'gemini' : 'groq';
}

export function getActiveLlmModel(override?: string | null): string {
  if (override && override.trim()) return override.trim();
  if (getActiveLlmProvider() === 'gemini') {
    return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }
  return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
}

// Estimativa grosseira de tokens para o caminho callLlm (texto), onde a Groq
// nao devolve usage no nosso wrapper actual. 1 token ~= 4 chars em PT.
function estimateTokens(s: string): number {
  return Math.ceil((s?.length || 0) / 4);
}

// Generico: devolve texto. Cache LRU interno (10 min) em ambos os providers.
// Tracking de tokens via opts.workspaceId + feature; se ausente, skip silencioso.
export async function callLlm(
  model: string | null | undefined,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
  track: LlmTrackOpts = {},
): Promise<string> {
  if (track.workspaceId) await checkLimitOrThrow(track.workspaceId);
  const { provider, model: m } = resolveProviderAndModel(model, track.forceProvider);
  let raw: string;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  if (provider === 'gemini') {
    raw = await callGeminiText(m, messages, maxTokens, temperature);
  } else {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY nao configurada'), { status: 500 });
    raw = await callGroqWithLimiter(apiKey, m, messages, maxTokens, temperature);
  }
  // O caminho texto nao devolve usage real; estimamos.
  if (track.workspaceId) {
    promptTokens = messages.reduce((a, b) => a + estimateTokens(b.content), 0);
    completionTokens = estimateTokens(raw);
    recordUsage({
      workspaceId: track.workspaceId,
      provider,
      model: m,
      feature: track.feature || 'other',
      promptTokens,
      completionTokens,
    });
  }
  return raw;
}

// JSON mode (response_format / responseMimeType). Sem cache.
export async function callLlmJson<T = any>(
  model: string | null | undefined,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
  track: LlmTrackOpts = {},
): Promise<{ json: T; raw: string; promptTokens?: number; completionTokens?: number }> {
  if (track.workspaceId) await checkLimitOrThrow(track.workspaceId);
  const { provider, model: m } = resolveProviderAndModel(model, track.forceProvider);
  let result: { json: T; raw: string; promptTokens?: number; completionTokens?: number };
  if (provider === 'gemini') {
    result = await callGeminiJson<T>(m, messages, maxTokens, temperature);
  } else {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY nao configurada'), { status: 500 });
    result = await callGroqJsonWithLimiter<T>(apiKey, m, messages, maxTokens, temperature);
  }
  if (track.workspaceId) {
    recordUsage({
      workspaceId: track.workspaceId,
      provider,
      model: m,
      feature: track.feature || 'other',
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
  }
  return result;
}

export function getLlmStats() {
  return {
    activeProvider: getActiveLlmProvider(),
    activeModel: getActiveLlmModel(),
    groq: getLimiterStats(),
    gemini: getGeminiStats(),
  };
}
