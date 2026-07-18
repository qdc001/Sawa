// Servico da IA Vendedora (Fase 3, parte 1).
//
// Responsabilidade: dado um contacto/lead com uma conversa em curso,
// produzir uma sugestao de resposta estruturada e persisti-la como
// AiSalesSuggestion (estado PENDING em modo supervisionado).
//
// Quem chama este servico:
//   - Endpoint POST /api/sales-agent/suggest (modo manual, para testes
//     e botao "Sugerir resposta" no Inbox)
//   - Webhook do Inbox quando aiSalesEnabled (ou conversa especifica)
//     esta ligado (a ligar na parte 2 desta fase)
//
// Nao envia nada para o WhatsApp por si proprio. O envio depende do
// modo (supervised vs auto) e e feito pelo endpoint de aprovacao.

import prisma from './prisma';
import { buildSalesSystemPrompt } from './buildSalesSystemPrompt';
import { buildPatientContextBlock } from './aiPatientContext';
import { retrieveRelevantKnowledge } from './aiKnowledgeRetrieval';
import { callLlmJson, getActiveLlmProvider } from './llmProvider';
import { SALES_PRINCIPLES, DEFAULT_ACTIVE_PRINCIPLES } from '../data/salesKnowledge';
import { selectRelevantRules, markRulesApplied } from './aiCoach';

const MAX_HISTORY = 30; // ultimas N mensagens a incluir no prompt (era 15)
const MAX_INTERNAL_NOTES = 10; // notas internas mais recentes a injectar como contexto
const MAX_PRODUCTS_IN_CATALOG = 30; // truncar catalogo para nao estourar tokens

// Marker que serve de "ponto de reset" da memoria contextual da IA.
// Quando este endpoint reset-context e chamado, gravamos uma Message com
// isInternal=true e content=AI_RESET_MARKER. Em geracoes seguintes, a IA
// so ve mensagens criadas DEPOIS do marker mais recente (como se a
// conversa comecasse do zero). Util para testes e para recomecar do zero
// sem apagar dados de auditoria.
export const AI_RESET_MARKER = '__AI_CONTEXT_RESET__';

export type GenerateOptions = {
  workspaceId: string;
  contactId: string;
  // Lead opcional: se vier, a IA tem acesso a titulo e valor.
  leadId?: string | null;
  // Mensagem inbound que disparou a geracao (id). Opcional: se omitido,
  // usa a ultima mensagem inbound do contacto.
  triggerMessageId?: string | null;
  // Chaves de principios a forcar. Se vazio, usa o default do workspace.
  activePrincipleKeys?: string[];
  // Forca o modelo Groq. Se omitido, usa GROQ_MODEL ou llama-3.3-70b.
  model?: string;
};

export type AgentAppointmentPayload = {
  title: string;
  startsAtISO: string;
  durationMin: number;
  notes?: string | null;
};

export type AgentTaskPayload = {
  title: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueInDays?: number;
};

export type AgentSuggestion = {
  action: 'send_text' | 'send_product' | 'book_appointment' | 'create_task' | 'handoff' | 'wait';
  parts: string[];
  productId: string | null;
  appointment: AgentAppointmentPayload | null;
  task: AgentTaskPayload | null;
  principlesUsed: string[];
  reasoning: string;
};

export class AgentError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

// Limpa datas verbosas nas mensagens que a Leizy envia ao paciente.
// LLMs (incluindo Gemini flash-lite) tendem a acrescentar a data completa
// mesmo instruidos a dizer so "hoje"/"amanha"/dia da semana. Este sanitizer
// e a segunda linha de defesa: apanha padroes tipicos e limpa.
export function sanitizeDateMentions(text: string): string {
  if (!text) return text;
  let out = text;
  // Padrao 1: "hoje/amanha/dia-semana, [dia] X de mes[ de ano]" -> "hoje/amanha/dia-semana"
  //   Ex: "amanha, dia 18 de julho" -> "amanha"
  //   Ex: "hoje, 17 de julho de 2026" -> "hoje"
  //   Ex: "segunda-feira, 20 de julho" -> "segunda-feira"
  const dayWords = '(hoje|amanhã|amanha|ontem|segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado|domingo)';
  const months = '(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
  const re1 = new RegExp(`\\b${dayWords},\\s*(?:dia\\s+)?\\d{1,2}\\s+de\\s+${months}(?:\\s+de\\s+\\d{4})?`, 'gi');
  out = out.replace(re1, (_m, day) => day);
  // Padrao 2: ano solto ", de 2026" ou " de 2026" -> remover
  out = out.replace(/,?\s+de\s+20\d{2}\b/g, '');
  // Padrao 3: hora "15:00:00" ou "15:00" -> "15h00" (formato pedido)
  out = out.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/g, '$1h$2');
  // Normalizar espacos duplicados e pontuacao pendurada
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1').trim();
  return out;
}

// Garante que um startsAtISO tem timezone. LLMs frequentemente devolvem
// "2026-07-18T10:00:00" sem sufixo, o que new Date() interpreta como UTC
// e resulta em consulta 2h no futuro para Africa/Maputo. Adicionamos o
// offset padrao +02:00 (Maputo nao tem DST) se estiver em falta.
export function ensureTimezone(iso: string): string {
  if (!iso) return iso;
  // Ja tem Z ou +hh:mm/-hh:mm no fim?
  if (/(Z|[+\-]\d{2}:?\d{2})$/.test(iso)) return iso;
  return iso + '+02:00';
}

// Sanitiza o JSON devolvido pela LLM para a forma estavel que esperamos.
function normalizeSuggestion(raw: any, maxParts: number): AgentSuggestion {
  const allowedActions = new Set(['send_text', 'send_product', 'book_appointment', 'create_task', 'handoff', 'wait']);
  const action = allowedActions.has(raw?.action) ? raw.action : 'send_text';

  const partsRaw = Array.isArray(raw?.parts) ? raw.parts : (Array.isArray(raw?.messages) ? raw.messages : []);
  const parts = partsRaw
    .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
    .map((p: string) => sanitizeDateMentions(p.trim()))
    .slice(0, Math.max(1, maxParts));

  const productId = typeof raw?.productId === 'string' && raw.productId.trim() ? raw.productId.trim() : null;

  // Appointment payload
  let appointment: AgentAppointmentPayload | null = null;
  if (raw?.appointment && typeof raw.appointment === 'object') {
    const a = raw.appointment;
    const startsAtISO = typeof a.startsAtISO === 'string' && !isNaN(new Date(a.startsAtISO).getTime()) ? ensureTimezone(a.startsAtISO) : null;
    const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 200) : null;
    const durationMin = Number.isFinite(a.durationMin) ? Math.max(5, Math.min(240, Math.trunc(a.durationMin))) : 30;
    if (startsAtISO && title) {
      appointment = { title, startsAtISO, durationMin, notes: typeof a.notes === 'string' ? a.notes.slice(0, 500) : null };
    }
  }

  // Task payload
  let task: AgentTaskPayload | null = null;
  if (raw?.task && typeof raw.task === 'object') {
    const t = raw.task;
    const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 200) : null;
    if (title) {
      const p = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(t.priority) ? t.priority : 'MEDIUM';
      const dueInDays = Number.isFinite(t.dueInDays) ? Math.max(0, Math.min(30, Math.trunc(t.dueInDays))) : 1;
      task = { title, description: typeof t.description === 'string' ? t.description.slice(0, 1000) : '', priority: p, dueInDays };
    }
  }

  const principlesRaw = Array.isArray(raw?.principlesUsed) ? raw.principlesUsed : [];
  const principlesUsed = principlesRaw
    .filter((k: any) => typeof k === 'string' && SALES_PRINCIPLES[k])
    .slice(0, 8);

  const reasoning = typeof raw?.reasoning === 'string' ? raw.reasoning.trim().slice(0, 500) : '';

  // send_text e send_product precisam de parts; outras actions podem ter parts vazio.
  if ((action === 'send_text' || action === 'send_product') && parts.length === 0) {
    throw new AgentError('IA devolveu resposta sem mensagens utilizaveis', 502);
  }
  if (action === 'send_product' && !productId) {
    return { action: 'send_text', parts, productId: null, appointment: null, task: null, principlesUsed, reasoning };
  }
  // book_appointment sem payload valido: degrade para send_text pedindo horario
  if (action === 'book_appointment' && !appointment) {
    if (parts.length === 0) parts.push('Pode confirmar o dia e a hora que prefere?');
    return { action: 'send_text', parts, productId: null, appointment: null, task: null, principlesUsed, reasoning };
  }
  // create_task sem payload valido: degrade para send_text
  if (action === 'create_task' && !task) {
    if (parts.length === 0) parts.push('Combinado, vou pedir a equipa para tratar disso.');
    return { action: 'send_text', parts, productId: null, appointment: null, task: null, principlesUsed, reasoning };
  }

  return { action, parts, productId, appointment, task, principlesUsed, reasoning };
}

export async function generateSalesSuggestion(opts: GenerateOptions) {
  // Provider e modelo sao determinados pela camada llmProvider.
  // Aceita override de modelo via opts.model; senao usa o default activo.
  const model = opts.model || null;
  const providerLabel = getActiveLlmProvider();

  // 0. Verificar se ha um marker de reset de contexto. Se sim, a IA so
  //    considera mensagens e notas criadas DEPOIS desse marker (como se
  //    a conversa comecasse do zero a partir desse ponto).
  const resetMarker = await prisma.message.findFirst({
    where: {
      contactId: opts.contactId,
      isInternal: true,
      content: AI_RESET_MARKER,
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const sinceFilter = resetMarker ? { gt: resetMarker.createdAt } : undefined;

  // 1. Carrega contexto: workspace, contacto (com tags), lead, ultimas mensagens
  //    publicas (que foram para o WhatsApp), notas internas da equipa e produtos.
  //    Separar mensagens de notas internas evita que a IA confunda observacoes
  //    privadas com texto trocado com o lead.
  const [workspace, contact, lead, messages, internalNotes, products] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: opts.workspaceId } }),
    prisma.contact.findUnique({
      where: { id: opts.contactId },
      include: { tags: { include: { tag: true } } },
    }),
    opts.leadId ? prisma.lead.findUnique({
      where: { id: opts.leadId },
      include: {
        pipeline: { select: { name: true } },
        stage: { select: { name: true, position: true } },
      },
    }) : Promise.resolve(null),
    // Mensagens "publicas" (efectivamente trocadas com o lead)
    prisma.message.findMany({
      where: {
        contactId: opts.contactId,
        ...(opts.leadId ? { OR: [{ leadId: opts.leadId }, { leadId: null }] } : {}),
        type: { in: ['TEXT', 'TEMPLATE', 'IMAGE', 'AUDIO', 'DOCUMENT', 'INTERACTIVE'] as any },
        isInternal: false,
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
      include: { sentBy: { select: { name: true } } },
    }),
    // Notas internas que a equipa deixou sobre esta conversa
    // (exclui o proprio marker de reset para nao poluir o contexto)
    prisma.message.findMany({
      where: {
        contactId: opts.contactId,
        ...(opts.leadId ? { OR: [{ leadId: opts.leadId }, { leadId: null }] } : {}),
        isInternal: true,
        content: { not: AI_RESET_MARKER },
        ...(sinceFilter ? { createdAt: sinceFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_INTERNAL_NOTES,
      include: { sentBy: { select: { name: true } } },
    }),
    prisma.product.findMany({
      where: { workspaceId: opts.workspaceId, isActive: true },
      include: { _count: { select: { files: true } } },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PRODUCTS_IN_CATALOG,
    }),
  ]);

  if (!workspace) throw new AgentError('Workspace nao encontrado', 404);
  if (!contact) throw new AgentError('Contacto nao encontrado', 404);

  if (messages.length === 0) {
    throw new AgentError('Sem historico de conversa para basear a sugestao', 400);
  }

  // 2. Determina a mensagem trigger.
  let triggerMessageId = opts.triggerMessageId || null;
  if (!triggerMessageId) {
    const lastInbound = messages.find((m) => m.direction === 'INBOUND');
    triggerMessageId = lastInbound?.id || null;
  }

  // 3. Constroi o system prompt com catalogo + persona + principios + sector.
  const maxParts = Math.max(1, Math.min(workspace.aiSalesMaxParts || 4, 6));
  const activeKeys = (opts.activePrincipleKeys && opts.activePrincipleKeys.length > 0)
    ? opts.activePrincipleKeys
    : DEFAULT_ACTIVE_PRINCIPLES;

  // Regras situacionais ensinadas pelo coach ou auto-aprendidas. Seleccionamos
  // as mais relevantes para a ultima mensagem do lead, para nao estourar tokens.
  const lastInboundMsg = messages.find((m) => m.direction === 'INBOUND');
  const lastInboundText = lastInboundMsg?.content || lastInboundMsg?.transcription || '';
  const coachingRules = await selectRelevantRules(opts.workspaceId, lastInboundText, 20).catch(() => []);

  // Sprint 1 do cumprimento do manual: contexto do paciente (alergias,
  // idade, historico de consultas, volume de comunicacao).
  const patientCtx = await buildPatientContextBlock(opts.workspaceId, opts.contactId, opts.leadId)
    .catch((e) => { console.error('[aiSalesAgent] patient context erro:', e.message); return { block: '', hasCriticalInfo: false, pipelineInstructions: undefined as string | undefined }; });

  // Sprint 4: chunks da base de conhecimento relevantes para a ultima mensagem.
  const kbChunks = await retrieveRelevantKnowledge(opts.workspaceId, lastInboundText, 3)
    .catch((e) => { console.error('[aiSalesAgent] knowledge retrieval erro:', e.message); return []; });

  const systemPrompt = buildSalesSystemPrompt(workspace, {
    activePrincipleKeys: activeKeys,
    maxFragments: maxParts,
    productCatalog: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      unitPrice: p.unitPrice,
      currency: p.currency,
      fileCount: (p as any)._count?.files || 0,
    })),
    coachingRules: coachingRules.map((r) => ({
      situation: r.situation,
      recommendedAction: r.recommendedAction,
      tone: r.tone,
      category: r.category,
      examples: Array.isArray(r.examples) ? (r.examples as any[]).filter((e) => e && e.leadMessage && e.aiResponse) : [],
    })),
    patientContext: patientCtx.block,
    hasCriticalPatientInfo: patientCtx.hasCriticalInfo,
    pipelineInstructions: patientCtx.pipelineInstructions,
    knowledgeChunks: kbChunks,
  });

  // 4. Monta o historico (ordem cronologica, mais antigo primeiro).
  // As mensagens OUTBOUND podem ter sido enviadas por agentes humanos OU por
  // sugestoes anteriores da IA. Marcamos com [<nome>] quando ha sentBy para a
  // IA perceber o tom usado por outros e nao se repetir.
  const history = messages.slice().reverse().map((m) => {
    const role = m.direction === 'INBOUND' ? 'user' : 'assistant';
    let content = m.content || '';
    if (!content && m.type === 'AUDIO') content = m.transcription || '[audio]';
    if (!content && m.type === 'IMAGE') content = '[imagem enviada]';
    if (!content && m.type === 'DOCUMENT') content = '[documento enviado]';
    if (!content) content = `[${m.type}]`;
    // Prefixo curto para outbound de agentes humanos (ajuda a IA a perceber
    // que ja respondeu alguem e a nao repetir).
    if (m.direction === 'OUTBOUND' && (m as any).sentBy?.name) {
      content = `(${(m as any).sentBy.name}) ${content}`;
    }
    return { role, content: content.slice(0, 2000) };
  });

  // 5. Bloco de contexto sobre contacto, lead, tags e notas internas.
  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const leadContext: string[] = [];
  leadContext.push(`Contacto: ${contactName || 'sem nome'}${contact.company ? ` (${contact.company})` : ''}.`);
  if ((contact as any).email) leadContext.push(`Email: ${(contact as any).email}.`);
  const tagsArr = ((contact as any).tags || []).map((t: any) => t.tag?.name).filter(Boolean);
  if (tagsArr.length > 0) leadContext.push(`Etiquetas: ${tagsArr.join(', ')}.`);
  if (lead) {
    leadContext.push(`Lead aberto: "${lead.title}"${lead.value ? `, valor estimado ${lead.value} ${lead.currency}` : ''}, prioridade ${lead.priority}, estado ${lead.status}.`);
    // Pipeline + etapa actual. Permite ao admin escrever instrucoes
    // condicionais por etapa (ex: "leads em Negociacao devem receber...")
    // e a IA respeitar essa logica.
    const pipelineName = (lead as any).pipeline?.name;
    const stageName = (lead as any).stage?.name;
    if (pipelineName || stageName) {
      leadContext.push(`Pipeline: ${pipelineName || 'sem nome'} / Etapa actual: ${stageName || 'sem nome'}. Adapta o tom e o conteudo ao momento do funil em que este lead se encontra.`);
    }
  }
  if (internalNotes.length > 0) {
    const notesLines = internalNotes.slice().reverse().map((n) => {
      const who = (n as any).sentBy?.name || 'Equipa';
      const when = new Date(n.createdAt).toLocaleDateString('pt-PT');
      return `- (${when}, ${who}) ${String(n.content || '').slice(0, 300)}`;
    });
    leadContext.push(`Notas internas da equipa sobre este contacto (privadas, NUNCA mencionar ao lead):\n${notesLines.join('\n')}`);
  }
  const contextMessage = {
    role: 'system',
    content: `Contexto desta conversa:\n${leadContext.join('\n')}`,
  };

  // 6. Chama o LLM activo (Groq ou Gemini) em modo JSON.
  let groqResult: { json: any; raw: string; promptTokens?: number; completionTokens?: number };
  try {
    groqResult = await callLlmJson(
      model,
      [
        { role: 'system', content: systemPrompt },
        contextMessage as any,
        ...history as any,
      ],
      800,
      0.5,
      { workspaceId: opts.workspaceId, feature: 'sales' },
    );
  } catch (e: any) {
    throw new AgentError(`${providerLabel.toUpperCase()} falhou: ${e?.message || e}`, e?.status || 502);
  }

  // 7. Normaliza e persiste.
  const suggestion = normalizeSuggestion(groqResult.json, maxParts);

  // Marca as regras de coaching que foram alimentadas ao prompt como aplicadas
  // (so para o painel "regras mais usadas"; nao bloqueia em caso de erro)
  if (coachingRules.length > 0) {
    markRulesApplied(coachingRules.map((r) => r.id)).catch(() => {});
  }

  // Serializar payload da accao concreta se aplicavel
  const actionPayload =
    suggestion.action === 'book_appointment' && suggestion.appointment ? { ...suggestion.appointment }
    : suggestion.action === 'create_task' && suggestion.task ? { ...suggestion.task }
    : null;

  const saved = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      triggerMessageId: triggerMessageId,
      parts: suggestion.parts as any,
      action: suggestion.action,
      productId: suggestion.productId,
      productFileIds: [] as any,
      actionPayload: actionPayload as any,
      reasoning: suggestion.reasoning,
      principlesUsed: suggestion.principlesUsed as any,
      modelUsed: `${providerLabel}:${model || 'default'}`,
      promptTokens: groqResult.promptTokens || null,
      completionTokens: groqResult.completionTokens || null,
      status: 'PENDING',
    },
  });

  // Se a accao for handoff, ja anotamos. Em supervised, o humano confirma.
  // Se a accao for send_product, vamos descobrir que ficheiros enviar.
  if (suggestion.action === 'send_product' && suggestion.productId) {
    const files = await prisma.file.findMany({
      where: { productId: suggestion.productId },
      select: { id: true },
    });
    if (files.length > 0) {
      await prisma.aiSalesSuggestion.update({
        where: { id: saved.id },
        data: { productFileIds: files.map((f) => f.id) as any },
      });
      (saved as any).productFileIds = files.map((f) => f.id);
    }
  }

  return { suggestion: saved, normalized: suggestion };
}

// Verifica se uma mensagem do lead contem alguma palavra-chave de handoff
// definida pelo workspace. Comparacao case-insensitive e match em qualquer
// posicao da string. Devolve a palavra encontrada (para auditoria) ou null.
function detectHandoffTrigger(messageContent: string, triggers: string[]): string | null {
  if (!messageContent || triggers.length === 0) return null;
  const text = messageContent.toLowerCase();
  for (const t of triggers) {
    const w = String(t).toLowerCase().trim();
    if (w && text.includes(w)) return w;
  }
  return null;
}

// Cria uma sugestao curto-circuito de handoff sem chamar a Groq. Util quando
// o lead usa uma palavra-chave que o owner definiu como gatilho imediato.
async function createHandoffShortCircuit(opts: {
  workspaceId: string;
  contactId: string;
  leadId?: string | null;
  triggerMessageId?: string | null;
  triggerWord: string;
}) {
  return prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      triggerMessageId: opts.triggerMessageId || null,
      parts: ['Vou passar a um colega humano agora mesmo.'] as any,
      action: 'handoff',
      productId: null,
      productFileIds: [] as any,
      reasoning: `Palavra-chave "${opts.triggerWord}" disparou handoff imediato (sem consultar IA).`,
      principlesUsed: [] as any,
      modelUsed: 'handoff-rule',
      promptTokens: null,
      completionTokens: null,
      status: 'PENDING',
    },
  });
}

// Helper para os webhooks de WhatsApp (Evolution + Cloud). Verifica se a
// IA Vendedora esta activa para o contacto/workspace e, em caso afirmativo,
// gera a sugestao em background e emite o evento socket aiSales:suggestion
// para o frontend a actualizar sem polling. Nao lanca: erros sao loggados.
//
// Em modo autonomo (aiSalesMode='auto'), aprova e despoleta o envio
// automaticamente quando a accao for send_text ou send_product. Handoff
// e wait ficam sempre PENDING para o humano confirmar (preservar controlo).
export async function maybeTriggerSalesSuggestion(opts: {
  workspaceId: string;
  contactId: string;
  leadId?: string | null;
  triggerMessageId?: string | null;
  triggerMessageContent?: string | null;
  io?: any;
}): Promise<void> {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: opts.workspaceId },
      select: { aiSalesEnabled: true, aiSalesEnabledConversationIds: true, aiSalesMode: true, aiSalesHandoffTriggers: true },
    });
    if (!ws) return;
    const enabledIds = Array.isArray(ws.aiSalesEnabledConversationIds)
      ? (ws.aiSalesEnabledConversationIds as any[]).filter((x) => typeof x === 'string')
      : [];
    const active = ws.aiSalesEnabled || enabledIds.includes(opts.contactId);
    if (!active) return;

    // Filtro por pipeline: se ha lead associado, verificar se o pipeline
    // desse lead tem Leizy activa. Se nao, sair silenciosamente.
    // Se nao ha lead, usa o lead OPEN mais recente do contacto (mesma
    // logica do aiPatientContext) para nao deixar contactos sem lead
    // ficarem sem cobertura.
    const leadForCheck = opts.leadId
      ? await prisma.lead.findFirst({
          where: { id: opts.leadId, workspaceId: opts.workspaceId },
          select: { pipeline: { select: { aiEnabled: true, name: true } } },
        })
      : await prisma.lead.findFirst({
          where: { workspaceId: opts.workspaceId, contactId: opts.contactId, status: 'OPEN' },
          orderBy: { updatedAt: 'desc' },
          select: { pipeline: { select: { aiEnabled: true, name: true } } },
        });
    if (leadForCheck && leadForCheck.pipeline.aiEnabled === false) {
      console.log(`[aiSales] skip contact=${opts.contactId}: pipeline "${leadForCheck.pipeline.name}" tem Leizy desactivada`);
      return;
    }

    // Guarda contra corrida: se a ultima mensagem nao-interna da conversa ja
    // for OUTBOUND (humano respondeu, ou IA acabou de enviar em modo auto),
    // nao geramos nova sugestao. So sugerimos quando a bola esta do nosso lado.
    const lastMsg = await prisma.message.findFirst({
      where: {
        contactId: opts.contactId,
        ...(opts.leadId ? { OR: [{ leadId: opts.leadId }, { leadId: null }] } : {}),
        isInternal: false,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, direction: true },
    });
    if (lastMsg && lastMsg.direction === 'OUTBOUND') {
      console.log(`[aiSales] skip contact=${opts.contactId}: ultima mensagem ja e OUTBOUND`);
      return;
    }

    // Curto-circuito: palavras de handoff disparam imediatamente, sem Groq.
    const handoffTriggers = Array.isArray(ws.aiSalesHandoffTriggers)
      ? (ws.aiSalesHandoffTriggers as any[]).filter((x) => typeof x === 'string')
      : [];
    const triggerWord = opts.triggerMessageContent
      ? detectHandoffTrigger(opts.triggerMessageContent, handoffTriggers)
      : null;
    if (triggerWord) {
      const sug = await createHandoffShortCircuit({
        workspaceId: opts.workspaceId,
        contactId: opts.contactId,
        leadId: opts.leadId || null,
        triggerMessageId: opts.triggerMessageId || null,
        triggerWord,
      });
      if (opts.io) {
        opts.io.to(`workspace:${opts.workspaceId}`).emit('aiSales:suggestion', sug);
      }
      return;
    }

    const { suggestion, normalized } = await generateSalesSuggestion({
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      triggerMessageId: opts.triggerMessageId || null,
    });

    if (opts.io) {
      opts.io.to(`workspace:${opts.workspaceId}`).emit('aiSales:suggestion', suggestion);
    }

    // Modo autonomo: aprova e despacha automaticamente accoes nao-criticas.
    // Handoff e wait nao sao auto-despachados: humano deve confirmar.
    // book_appointment e create_task sao auto-despachados: sao accoes concretas
    // com trace clara (aparecem no Appointment / Task com createdByAi=true).
    const autoDispatchable = new Set(['send_text', 'send_product', 'book_appointment', 'create_task']);
    if (ws.aiSalesMode === 'auto' && autoDispatchable.has(normalized.action)) {
      try {
        const { autoDispatchSuggestion } = await import('./autoDispatchSalesSuggestion');
        await autoDispatchSuggestion(suggestion.id, opts.io);
      } catch (e: any) {
        console.error('[aiSales] auto-dispatch failed:', e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[aiSales] maybeTriggerSalesSuggestion failed:', e?.message || e);
  }
}
