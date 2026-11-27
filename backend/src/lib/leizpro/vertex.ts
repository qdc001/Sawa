// Segunda opiniao da Leiz Pro: Gemini no Vertex AI (Google Cloud).
//
// So e chamado quando o modelo local (qwen 3b) teve de adivinhar. O Gemini nao
// escreve texto: escolhe uma das respostas do guia que o motor ja calculou, ou
// passa a conversa a equipa. Sem credenciais, ou com o limite diario gasto,
// fica tudo como antes (o motor usa a leitura do modelo local).
//
// Variaveis (Easypanel):
//   VERTEX_API_KEY            chave de API do Vertex AI (mais simples), OU
//   VERTEX_SA_JSON            JSON da conta de servico (texto ou base64)
//   VERTEX_PROJECT            id do projecto (obrigatorio com a conta de servico)
//   VERTEX_LOCATION           regiao (por omissao: global)
//   VERTEX_MODEL              modelos por ordem, separados por virgula; se um deixar de
//                             existir (404) usa o seguinte
//                             (por omissao: gemini-3-flash-preview,gemini-3.1-flash-lite)
//   LEIZPRO_VERTEX            "off" desliga sem apagar as credenciais
//   LEIZPRO_VERTEX_DAILY_USD  limite de gasto por dia (por omissao: 2)
//   VERTEX_PRICE_IN / VERTEX_PRICE_OUT  USD por milhao de tokens (0.50 / 3.00, por cima)
import crypto from 'crypto';

const env = (k: string) => (process.env[k] || '').trim();

export function vertexModels(): string[] {
  return (env('VERTEX_MODEL') || 'gemini-3-flash-preview,gemini-3.1-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);
}
// Ultimo modelo que respondeu (para o registo da sugestao).
let lastModel = '';
export function vertexModel(): string {
  return lastModel || vertexModels()[0];
}

let saCache: any = undefined;
function serviceAccount(): any | null {
  if (saCache !== undefined) return saCache;
  const raw = env('VERTEX_SA_JSON');
  saCache = null;
  if (raw) {
    try {
      saCache = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      console.error('[leizpro/vertex] VERTEX_SA_JSON invalido');
    }
  }
  return saCache;
}

export function vertexEnabled(): boolean {
  if (env('LEIZPRO_VERTEX').toLowerCase() === 'off') return false;
  return !!env('VERTEX_API_KEY') || !!serviceAccount();
}

// ---- Token da conta de servico (JWT assinado, sem bibliotecas) ---------------
let token: { value: string; exp: number } | null = null;
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(sa: any): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const uri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: uri, iat: now, exp: now + 3600,
  }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key));
  const r = await fetch(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`token HTTP ${r.status}`);
  token = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

// ---- Gasto do dia ---------------------------------------------------------------
const spend = { day: '', usd: 0, calls: 0 };
function today(): string { return new Date().toISOString().slice(0, 10); }
function dailyLimit(): number { const v = Number(env('LEIZPRO_VERTEX_DAILY_USD')); return Number.isFinite(v) && v > 0 ? v : 2; }
export function vertexSpend(): { day: string; usd: number; calls: number; limit: number } {
  if (spend.day !== today()) Object.assign(spend, { day: today(), usd: 0, calls: 0 });
  return { ...spend, limit: dailyLimit() };
}

export type VertexResult = { json: any; usd: number; tokensIn: number; tokensOut: number; ms: number; model: string };

// Uma chamada ao Gemini que devolve JSON. Lanca erro em falha (quem chama decide).
export async function askVertex(system: string, prompt: string, timeoutMs = 30_000): Promise<VertexResult> {
  if (!vertexEnabled()) throw new Error('vertex desligado');
  const s = vertexSpend();
  if (s.usd >= s.limit) throw new Error(`limite diario atingido (${s.usd.toFixed(2)} USD)`);

  const loc = env('VERTEX_LOCATION') || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const sa = serviceAccount();
  const project = env('VERTEX_PROJECT') || sa?.project_id || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env('VERTEX_API_KEY')) headers['x-goog-api-key'] = env('VERTEX_API_KEY');
  else headers.Authorization = `Bearer ${await accessToken(sa)}`;
  const urlFor = (model: string) => (project || !env('VERTEX_API_KEY')
    ? `https://${host}/v1/projects/${project}/locations/${loc}/publishers/google/models/${model}:generateContent`
    : `https://${host}/v1/publishers/google/models/${model}:generateContent`);

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let data: any = null;
    let model = '';
    let lastErr = '';
    for (const m of vertexModels()) {
      // Gemini 3: raciocinio "low" (mais rapido e barato; a escolha e simples).
      // Se o modelo nao aceitar a opcao, tenta sem ela.
      for (const thinking of m.startsWith('gemini-3') ? [true, false] : [false]) {
        const r = await fetch(urlFor(m), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 4096,
              ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
            },
          }),
          signal: ctrl.signal,
        });
        const body: any = await r.json().catch(() => ({}));
        if (r.ok) { data = body; model = m; break; }
        lastErr = `HTTP ${r.status} ${String(body?.error?.message || '').slice(0, 160)}`;
        if (r.status === 400 && thinking) continue;   // sem a opcao de raciocinio
        if (r.status === 404 || r.status === 400) break; // modelo seguinte
        throw new Error(lastErr);                      // 401/403/429/5xx: nao insiste
      }
      if (data) break;
    }
    if (!data) throw new Error(lastErr || 'sem modelo disponivel');
    lastModel = model;
    const usage = data?.usageMetadata || {};
    const tokensIn = Number(usage.promptTokenCount) || 0;
    const tokensOut = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
    const pin = Number(env('VERTEX_PRICE_IN')) || 0.50;
    const pout = Number(env('VERTEX_PRICE_OUT')) || 3.00;
    const usd = (tokensIn * pin + tokensOut * pout) / 1e6;
    vertexSpend();
    spend.usd += usd;
    spend.calls += 1;
    const text = (data?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || '').join('');
    const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    return { json: JSON.parse(clean || '{}'), usd, tokensIn, tokensOut, ms: Date.now() - t0, model };
  } finally {
    clearTimeout(timer);
  }
}
