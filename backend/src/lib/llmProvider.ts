// Camada de abstraccao entre o codigo aplicacional e o provider LLM activo.
//
// Permite alternar entre Groq / Gemini / DeepSeek sem tocar nos call sites:
// basta mudar a env LLM_PROVIDER. Continua a usar Groq para transcricao de
// audio (whisper), que e endpoint diferente e nao tem equivalente directo
// nos outros.
//
// Variaveis de ambiente:
//   LLM_PROVIDER       = "groq" (default) | "gemini" | "deepseek"
//   GROQ_API_KEY       = chave Groq (e GROQ_API_KEY_2..10 para pool)
//   GROQ_MODEL         = modelo Groq default (ex: llama-3.3-70b-versatile)
//   GEMINI_API_KEY     = chave Google AI Studio (formato AIzaSy...)
//   GEMINI_MODEL       = modelo Gemini default (ex: gemini-2.5-flash)
//   DEEPSEEK_API_KEY   = chave DeepSeek (formato sk-...)
//   DEEPSEEK_MODEL     = modelo DeepSeek default (ex: deepseek-v4-flash)

import { callGroqWithLimiter, callGroqJsonWithLimiter, getLimiterStats } from './groqLimiter';
import { callGeminiText, callGeminiJson, getGeminiStats } from './geminiClient';
import { callDeepseekText, callDeepseekJson, getDeepseekStats } from './deepseekClient';
import { checkLimitOrThrow, recordUsage, LlmFeature } from './aiUsage';

export type LlmProvider = 'groq' | 'gemini' | 'deepseek';
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
  let model: string;
  switch (provider) {
    case 'gemini':
      model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      break;
    case 'deepseek':
      model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
      break;
    default:
      model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  }
  return { provider, model };
}

export function getActiveLlmProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
  if (p === 'gemini') return 'gemini';
  if (p === 'deepseek') return 'deepseek';
  return 'groq';
}

export function getActiveLlmModel(override?: string | null): string {
  if (override && override.trim()) return override.trim();
  const p = getActiveLlmProvider();
  if (p === 'gemini') return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (p === 'deepseek') return process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
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
  } else if (provider === 'deepseek') {
    raw = await callDeepseekText(m, messages, maxTokens, temperature);
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
  } else if (provider === 'deepseek') {
    result = await callDeepseekJson<T>(m, messages, maxTokens, temperature);
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
    deepseek: getDeepseekStats(),
  };
}
