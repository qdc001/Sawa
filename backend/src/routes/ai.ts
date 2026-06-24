import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getLimiterStats } from '../lib/groqLimiter';
import { callLlm, getLlmStats } from '../lib/llmProvider';

import prisma from '../lib/prisma';
const router = Router();

// IA via Groq (API compatível com OpenAI Chat Completions).
// Modelo default: llama-3.3-70b-versatile — alta qualidade e suporte multilingue (PT-MZ).
// Outros disponíveis: llama-3.1-8b-instant (rápido/barato), mixtral-8x7b-32768 (contexto grande), gemma2-9b-it.
// Override por env: GROQ_MODEL.
const AI_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const AI_API = 'https://api.groq.com/openai/v1/chat/completions';

function getAiKey(): string {
  // GROQ_API_KEY tem prioridade; aceita também ANTHROPIC_API_KEY como fallback
  // para não partir deploys antigos antes de mudar a env var no Easypanel.
  const key = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError('GROQ_API_KEY não configurada no backend', 500);
  return key;
}

// Voz/tom da marca do workspace, para a IA escrever de forma consistente.
async function brandVoiceClause(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, aiBrandVoice: true },
  });
  let clause = ws?.name ? `\n\nEmpresa/marca: ${ws.name}.` : '';
  if (ws?.aiBrandVoice && ws.aiBrandVoice.trim()) {
    clause += `\nEscreve SEMPRE nesta voz da marca: ${ws.aiBrandVoice.trim()}`;
  }
  return clause;
}

// Truncar texto para evitar passar do limite de tokens do modelo.
// Llama 3.3 70B aceita ~128k tokens contexto mas Groq tem limites por minuto (TPM)
// no plano gratuito que cortam pedidos grandes. Limite seguro: ~12000 chars por prompt.
function truncate(s: string, maxChars: number): string {
  if (!s || s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '\n[…truncado…]';
}

// Chamada genérica ao Groq. Aceita systemPrompt + 1 mensagem user (caso simples)
// ou systemPrompt + array completo de messages (caso com histórico).
// Passa pelo groqLimiter (rate limit + retry com backoff + cache LRU).
async function callGroq(
  systemPrompt: string,
  userMessageOrMessages: string | Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
  maxTokens = 1024,
  workspaceId?: string,
  feature: 'copilot' | 'other' = 'copilot',
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: truncate(systemPrompt, 6000) },
  ];
  if (typeof userMessageOrMessages === 'string') {
    messages.push({ role: 'user', content: truncate(userMessageOrMessages, 12000) });
  } else {
    messages.push(...userMessageOrMessages.map((m) => ({ role: m.role, content: truncate(m.content, 6000) })));
  }

  try {
    // Aceita Groq ou Gemini conforme a env LLM_PROVIDER (default groq).
    return await callLlm(null, messages as any, maxTokens, 0.7, { workspaceId, feature });
  } catch (e: any) {
    const status = e?.status || 502;
    const detail = e?.message || 'Erro desconhecido';
    console.error(`[ai] Groq falhou (${status}) modelo=${AI_MODEL}:`, detail);
    if (status === 401) throw new AppError('GROQ_API_KEY inválida ou revogada. Cria uma nova em console.groq.com.', 401);
    if (status === 404) throw new AppError(`Modelo "${AI_MODEL}" não existe na Groq. Define GROQ_MODEL com um modelo válido.`, 400);
    if (status === 429) throw new AppError('Servidor de IA muito ocupado. Espera ~30 segundos e tenta de novo.', 429);
    if (status === 413) throw new AppError('Contexto demasiado grande. Reduz a quantidade de mensagens.', 413);
    throw new AppError(`Groq: ${detail}`, 502);
  }
}

// ── GET lead context helper ───────────────────────────
async function getLeadContext(leadId: string, workspaceId: string) {
  return prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      contact: true,
      stage: true,
      pipeline: true,
      assignedTo: { select: { name: true } },
      notes: { orderBy: { createdAt: 'desc' }, take: 5 },
      tasks: { orderBy: { createdAt: 'desc' }, take: 5 },
      messages: { orderBy: { createdAt: 'desc' }, take: 20 },
      activities: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
}

// ── POST /api/ai/summarize ────────────────────────────
// Resumo completo do lead
router.post('/summarize', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId } = req.body;
    if (!leadId) throw new AppError('leadId é obrigatório', 400);

    const apiKey = getAiKey();

    const lead = await getLeadContext(leadId, req.user!.workspaceId);
    if (!lead) throw new AppError('Lead não encontrado', 404);

    const recentMessages = lead.messages
      .slice(0, 10)
      .map((m) => `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'} - ${m.channel}]: ${m.content}`)
      .join('\n');

    const notes = lead.notes.map((n) => `- ${n.content}`).join('\n');
    const tasks = lead.tasks.map((t) => `- ${t.title} (${t.status}${t.dueAt ? `, prazo: ${new Date(t.dueAt).toLocaleDateString('pt')}` : ''})`).join('\n');

    const summary = await callGroq(
      `Você é um assistente CRM profissional. Analisa dados de leads e fornece resumos claros e accionáveis em Português de Moçambique. Seja conciso e prático.`,
      `Cria um resumo executivo deste lead para o gestor de vendas:

LEAD: ${lead.title}
VALOR: ${lead.value ? `MZN ${lead.value.toLocaleString()}` : 'Não definido'}
ETAPA: ${lead.stage.name} (pipeline: ${lead.pipeline.name})
PRIORIDADE: ${lead.priority}
FONTE: ${lead.source || 'Desconhecida'}
RESPONSÁVEL: ${lead.assignedTo?.name || 'Não atribuído'}
CONTACTO: ${lead.contact?.firstName || ''} ${lead.contact?.lastName || ''} ${lead.contact?.company ? `(${lead.contact.company})` : ''}

ÚLTIMAS MENSAGENS:
${recentMessages || 'Sem mensagens'}

NOTAS:
${notes || 'Sem notas'}

TAREFAS:
${tasks || 'Sem tarefas'}

Fornece: 1) Resumo do estado actual (2-3 frases) 2) Próximas acções recomendadas 3) Riscos ou oportunidades identificados`,
      apiKey,
      512,
      req.user!.workspaceId
    );

    res.json({ summary });
  } catch (e) { next(e); }
});

// ── POST /api/ai/suggest-reply ────────────────────────
// Sugere resposta para uma mensagem recebida
router.post('/suggest-reply', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId, lastMessage, tone = 'profissional' } = req.body;

    const apiKey = getAiKey();

    const lead = await getLeadContext(leadId, req.user!.workspaceId);

    const context = lead
      ? `Lead: ${lead.title}, Etapa: ${lead.stage.name}, Contacto: ${lead.contact?.firstName || 'Cliente'}`
      : 'Contexto do lead não disponível';

    const voice = await brandVoiceClause(req.user!.workspaceId);
    const suggestions = await callGroq(
      `Você é um assistente de vendas experiente. Sugere respostas para mensagens de clientes. Responde em Português de Moçambique. Tom: ${tone}.${voice}`,
      `${context}

Mensagem do cliente: "${lastMessage}"

Sugere 3 respostas diferentes para esta mensagem. Numera cada uma (1, 2, 3). Cada resposta deve ser directa, profissional e adequada ao contexto de vendas. Separa cada resposta com uma linha em branco.`,
      apiKey,
      600,
      req.user!.workspaceId
    );

    // Parse into array
    const parsed = suggestions
      .split(/\n\s*\n/)
      .map((s) => s.replace(/^\d+\.\s*/, '').trim())
      .filter((s) => s.length > 10)
      .slice(0, 3);

    res.json({ suggestions: parsed });
  } catch (e) { next(e); }
});

// ── POST /api/ai/suggest-fields ───────────────────────
// Sugere valores para campos em branco com base nas mensagens
router.post('/suggest-fields', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId } = req.body;

    const apiKey = getAiKey();

    const lead = await getLeadContext(leadId, req.user!.workspaceId);
    if (!lead) throw new AppError('Lead não encontrado', 404);

    const messages = lead.messages
      .map((m) => `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'}]: ${m.content}`)
      .join('\n');

    const result = await callGroq(
      `Analisa conversas de vendas e extrai informações sobre o cliente. Responde APENAS em JSON válido.`,
      `Com base nesta conversa, extrai informações do cliente que possam estar em falta no CRM.

Conversa:
${messages || 'Sem mensagens disponíveis'}

Dados actuais:
- Nome: ${lead.contact?.firstName || 'Desconhecido'}
- Email: ${lead.contact?.email || 'Em falta'}
- Telefone: ${lead.contact?.phone || 'Em falta'}
- Empresa: ${lead.contact?.company || 'Em falta'}
- Cargo: ${lead.contact?.position || 'Em falta'}
- Valor do lead: ${lead.value || 'Em falta'}
- Fonte: ${lead.source || 'Em falta'}

Responde APENAS com JSON no formato:
{"suggestions": [{"field": "nome_do_campo", "value": "valor_sugerido", "confidence": 0.9, "reason": "porque extraí este valor"}]}

Só inclui campos com confiança > 0.6. Campos possíveis: email, phone, company, position, value, source, expectedCloseAt`,
      apiKey,
      400,
      req.user!.workspaceId
    );

    try {
      const clean = result.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      res.json(parsed);
    } catch {
      res.json({ suggestions: [] });
    }
  } catch (e) { next(e); }
});

// ── POST /api/ai/sentiment ────────────────────────────
// Analisa sentimento de uma mensagem
router.post('/sentiment', async (req: AuthRequest, res: Response, next) => {
  try {
    const { message } = req.body;

    const apiKey = getAiKey();

    const result = await callGroq(
      `Analisa o sentimento de mensagens de clientes. Responde APENAS em JSON.`,
      `Analisa o sentimento desta mensagem de cliente: "${message}"

Responde APENAS com JSON:
{"sentiment": "positivo|negativo|neutro|urgente|frustrado|satisfeito", "score": 0.85, "emoji": "😊", "guidance": "sugestão curta de como responder"}`,
      apiKey,
      150,
      req.user!.workspaceId
    );

    try {
      const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
      res.json(parsed);
    } catch {
      res.json({ sentiment: 'neutro', score: 0.5, emoji: '😐', guidance: 'Responda de forma profissional' });
    }
  } catch (e) { next(e); }
});

// ── POST /api/ai/improve-text ─────────────────────────
// Melhora ou reescreve um texto
router.post('/improve-text', async (req: AuthRequest, res: Response, next) => {
  try {
    const { text, action = 'improve', tone = 'profissional' } = req.body;
    // action: 'improve' | 'formal' | 'casual' | 'shorter' | 'correct-grammar'

    const apiKey = getAiKey();

    const actions: Record<string, string> = {
      improve: `Melhora este texto mantendo o significado. Tom: ${tone}.`,
      formal: 'Reescreve este texto de forma mais formal e profissional.',
      casual: 'Reescreve este texto de forma mais casual e amigável.',
      shorter: 'Reescreve este texto de forma mais concisa, mantendo os pontos principais.',
      'correct-grammar': 'Corrige apenas a gramática e ortografia, sem alterar o estilo.',
    };

    const instruction = actions[action] || actions.improve;

    const voice = await brandVoiceClause(req.user!.workspaceId);
    const result = await callGroq(
      `Você é um editor de texto profissional. Reescreve textos em Português de Moçambique. Responde APENAS com o texto melhorado, sem explicações.${voice}`,
      `${instruction}\n\nTexto original: "${text}"`,
      apiKey,
      300,
      req.user!.workspaceId
    );

    res.json({ result: result.trim() });
  } catch (e) { next(e); }
});

// ── POST /api/ai/chat ─────────────────────────────────
// Chat com o Copilot sobre qualquer questão do workspace
router.post('/chat', async (req: AuthRequest, res: Response, next) => {
  try {
    const { message, history = [] } = req.body;

    const apiKey = getAiKey();

    const workspaceStats = await Promise.all([
      prisma.lead.count({ where: { workspaceId: req.user!.workspaceId, status: 'OPEN' } }),
      prisma.lead.count({ where: { workspaceId: req.user!.workspaceId, status: 'WON' } }),
      prisma.contact.count({ where: { workspaceId: req.user!.workspaceId } }),
      prisma.task.count({ where: { assignedTo: { workspaceId: req.user!.workspaceId }, status: 'PENDING' } }),
    ]);

    const systemPrompt = `Você é o Copilot, assistente IA integrado no CRM M.E.T.A. Ajuda os utilizadores a gerir o seu negócio e responder perguntas sobre o sistema.

Dados actuais do workspace:
- Leads abertos: ${workspaceStats[0]}
- Leads ganhos: ${workspaceStats[1]}
- Contactos: ${workspaceStats[2]}
- Tarefas pendentes: ${workspaceStats[3]}

Responde em Português de Moçambique. Seja conciso, prático e amigável.`;

    const messages = [
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: message },
    ];

    const reply = await callGroq(systemPrompt, messages, apiKey, 1024, req.user!.workspaceId);
    res.json({ reply });
  } catch (e) { next(e); }
});

// ── POST /api/ai/summarize-conversation ──────────────────────────
// Resume uma conversa de mensagens (sem precisar de leadId)
router.post('/summarize-conversation', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId } = req.body;
    const apiKey = getAiKey();

    const where: any = { isInternal: false };
    if (contactId) where.contactId = contactId;
    if (leadId) where.leadId = leadId;
    if (!contactId && !leadId) throw new AppError('contactId ou leadId obrigatório', 400);

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { contact: { select: { firstName: true, lastName: true } } },
    });
    if (messages.length === 0) {
      return res.json({ summary: 'Sem mensagens para resumir.' });
    }

    const conv = messages.map((m: any) =>
      `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'} - ${m.channel}]: ${m.content}`
    ).join('\n');

    const summary = await callGroq(
      `Você é um assistente CRM. Resume conversas em Português de Moçambique de forma clara e prática.`,
      `Resume esta conversa em 3-5 frases. Inclui: 1) tópicos principais 2) próximos passos pendentes 3) sentimento do cliente.

Conversa:
${conv}`,
      apiKey,
      400,
      req.user!.workspaceId
    );

    res.json({ summary });
  } catch (e) { next(e); }
});

// ── POST /api/ai/agent-reply ──────────────────────────
// Resposta automática do agente IA para um lead
router.post('/agent-reply', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId, incomingMessage } = req.body;

    const apiKey = getAiKey();

    const lead = await getLeadContext(leadId, req.user!.workspaceId);
    if (!lead) throw new AppError('Lead não encontrado', 404);

    const workspace = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });

    const history = lead.messages
      .reverse()
      .slice(-10)
      .map((m) => ({
        role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      }));

    const messages = [...history, { role: 'user' as const, content: incomingMessage }];

    const reply = await callGroq(
      `Você é o assistente virtual de ${workspace?.name}. Responde a clientes potenciais de forma profissional, amigável e concisa. Qualifica leads e agenda reuniões quando adequado. Responde em Português de Moçambique. Não revelar que é IA a menos que perguntado directamente.${workspace?.aiBrandVoice ? ` Voz da marca: ${workspace.aiBrandVoice}` : ''}`,
      messages,
      apiKey,
      300,
      req.user!.workspaceId
    );
    res.json({ reply });
  } catch (e) { next(e); }
});

// ── GET /api/ai/status ────────────────────────────────
// Diagnóstico: confirma se a chave está configurada, qual o modelo activo
// e o estado do rate limiter interno.
// ── POST /api/ai/next-action ──────────────────────────
// Sugere a próxima melhor acção concreta para um lead
router.post('/next-action', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId } = req.body;
    if (!leadId) throw new AppError('leadId é obrigatório', 400);
    const apiKey = getAiKey();
    const lead = await getLeadContext(leadId, req.user!.workspaceId);
    if (!lead) throw new AppError('Lead não encontrado', 404);

    const recentMessages = lead.messages.slice(0, 8)
      .map((m) => `[${m.direction === 'INBOUND' ? 'Cliente' : 'Agente'}]: ${m.content}`).join('\n');
    const tasks = lead.tasks.map((t) => `- ${t.title} (${t.status})`).join('\n');

    const result = await callGroq(
      `És um coach de vendas. Indicas UMA próxima acção concreta e accionável por lead, em Português de Moçambique. Responde APENAS em JSON.`,
      `Qual é a próxima melhor acção para este lead?

LEAD: ${lead.title}
ETAPA: ${lead.stage.name} (pipeline ${lead.pipeline.name})
PRIORIDADE: ${lead.priority}
VALOR: ${lead.value ? `MZN ${lead.value}` : 'não definido'}
CONTACTO: ${lead.contact?.firstName || ''} ${lead.contact?.lastName || ''}
ÚLTIMAS MENSAGENS:
${recentMessages || 'sem mensagens'}
TAREFAS ABERTAS:
${tasks || 'sem tarefas'}

Responde APENAS em JSON: {"action":"a próxima acção concreta numa frase","why":"porquê, numa frase curta","type":"call|message|meeting|proposal|wait|other"}`,
      apiKey,
      220,
      req.user!.workspaceId
    );
    try {
      const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
      res.json(parsed);
    } catch {
      res.json({ action: result.trim(), why: '', type: 'other' });
    }
  } catch (e) { next(e); }
});

router.get('/status', (_req: AuthRequest, res: Response) => {
  const hasKey = !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
  res.json({
    configured: hasKey,
    llm: getLlmStats(),
  });
});

export default router;
