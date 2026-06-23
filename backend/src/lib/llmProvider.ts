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

export type LlmProvider = 'groq' | 'gemini';
export type LlmMsg = { role: 'system' | 'user' | 'assistant'; content: string };

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

// Generico: devolve texto. Cache LRU interno (10 min) em ambos os providers.
export async function callLlm(
  model: string | null | undefined,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<string> {
  const m = getActiveLlmModel(model);
  if (getActiveLlmProvider() === 'gemini') {
    return callGeminiText(m, messages, maxTokens, temperature);
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY nao configurada'), { status: 500 });
  return callGroqWithLimiter(apiKey, m, messages, maxTokens, temperature);
}

// JSON mode (response_format / responseMimeType). Sem cache.
export async function callLlmJson<T = any>(
  model: string | null | undefined,
  messages: LlmMsg[],
  maxTokens: number,
  temperature = 0.7,
): Promise<{ json: T; raw: string; promptTokens?: number; completionTokens?: number }> {
  const m = getActiveLlmModel(model);
  if (getActiveLlmProvider() === 'gemini') {
    return callGeminiJson<T>(m, messages, maxTokens, temperature);
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY nao configurada'), { status: 500 });
  return callGroqJsonWithLimiter<T>(apiKey, m, messages, maxTokens, temperature);
}

export function getLlmStats() {
  return {
    activeProvider: getActiveLlmProvider(),
    activeModel: getActiveLlmModel(),
    groq: getLimiterStats(),
    gemini: getGeminiStats(),
  };
}
