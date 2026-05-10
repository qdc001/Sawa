/**
 * Motor de execução de chatbots.
 *
 * Conceito:
 * - Um ChatbotFlow tem um array de `nodes` e `edges` (gerados pelo React Flow no frontend).
 * - O motor recebe uma mensagem entrada de um contacto e:
 *     1. Verifica se há sessão activa para esse contacto. Se houver, retoma o fluxo.
 *     2. Se não houver, procura fluxos cujo trigger active (first_message / keyword / always).
 *     3. Percorre os nós seguindo as edges, executando cada um, até encontrar:
 *           - um nó que pede resposta (waitForReply) -> guarda sessão e pára
 *           - um nó "delay" -> agenda retomada e pára
 *           - um nó "end" -> finaliza
 *
 * Tipos de nó suportados:
 *   trigger    -> ponto de entrada, sem efeito
 *   message    -> envia texto via canal (WhatsApp). Pode esperar resposta (data.waitForReply).
 *   condition  -> avalia contra a última mensagem ou variável; tem 2 handles (yes/no).
 *   action     -> executa acção interna (create_task, assign_user, change_stage, add_tag, webhook, set_priority, create_lead).
 *   delay      -> espera N segundos antes de continuar.
 *   ai         -> chama a Anthropic API com o histórico e envia a resposta.
 *   end        -> marca sessão como terminada.
 *
 * Variáveis disponíveis nos textos com {{ }} :
 *   {{contact.firstName}}, {{contact.phone}}, {{contact.company}}, etc.
 *   {{message}}            -> última mensagem recebida
 *   {{vars.<nome>}}        -> variáveis capturadas com data.saveAs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Types ─────────────────────────────────────────────
type NodeType = 'trigger' | 'message' | 'condition' | 'action' | 'delay' | 'ai' | 'end';

interface FlowNode {
  id: string;
  type: NodeType;
  data: any;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

interface RunContext {
  workspaceId: string;
  contactId: string;
  leadId?: string | null;
  flowId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  vars: Record<string, any>;
  lastMessage: string;
  channel: string;
  dryRun: boolean;
  log: string[];
  contact: any;
  io?: any;
}

// ── Interpolação de variáveis ─────────────────────────
function interpolate(template: string, ctx: RunContext): string {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const trimmed = path.trim();
    if (trimmed === 'message') return ctx.lastMessage || '';
    if (trimmed.startsWith('contact.')) {
      const key = trimmed.slice('contact.'.length);
      return ctx.contact?.[key] ?? '';
    }
    if (trimmed.startsWith('vars.')) {
      const key = trimmed.slice('vars.'.length);
      return ctx.vars[key] ?? '';
    }
    return '';
  });
}

// ── Helpers de grafo ──────────────────────────────────
function findStartNode(nodes: FlowNode[]): FlowNode | null {
  return nodes.find((n) => n.type === 'trigger') || nodes[0] || null;
}

function nextNodeId(currentId: string, edges: FlowEdge[], sourceHandle?: string): string | null {
  const candidates = edges.filter((e) => e.source === currentId);
  if (sourceHandle) {
    const match = candidates.find((e) => e.sourceHandle === sourceHandle);
    if (match) return match.target;
  }
  // Sem sourceHandle ou não encontrou: pega no primeiro
  return candidates[0]?.target || null;
}

// ── Avaliação de condições ────────────────────────────
function evaluateCondition(node: FlowNode, ctx: RunContext): 'yes' | 'no' {
  const t = node.data?.conditionType || 'contains';
  const expected = String(node.data?.conditionValue || '').toLowerCase().trim();
  const targetVar = node.data?.conditionTarget;
  const actual = (targetVar ? String(ctx.vars[targetVar] || '') : ctx.lastMessage || '')
    .toLowerCase()
    .trim();

  let result = false;
  switch (t) {
    case 'contains':
      result = expected ? actual.includes(expected) : false;
      break;
    case 'equals':
      result = actual === expected;
      break;
    case 'starts_with':
      result = expected ? actual.startsWith(expected) : false;
      break;
    case 'is_number':
      result = /^\d+([.,]\d+)?$/.test(actual);
      break;
    case 'has_email':
      result = /\S+@\S+\.\S+/.test(actual);
      break;
    case 'has_phone':
      result = /\d{7,}/.test(actual.replace(/\D/g, ''));
      break;
    default:
      result = false;
  }
  return result ? 'yes' : 'no';
}

// ── Envio real de mensagem WhatsApp ───────────────────
async function sendWhatsApp(workspaceId: string, to: string, text: string): Promise<string | null> {
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WHATSAPP', isActive: true },
  });
  if (!integration) return null;
  const creds: any = integration.credentials;
  if (!creds?.token || !creds?.phoneId) return null;

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Erro a enviar WhatsApp do chatbot:', data);
      return null;
    }
    return data.messages?.[0]?.id || null;
  } catch (e) {
    console.error('Excepção ao enviar WhatsApp do chatbot:', e);
    return null;
  }
}

// ── Chamada à Anthropic API ───────────────────────────
async function callClaude(systemPrompt: string, history: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '[IA não configurada]';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: systemPrompt,
        messages: history,
      }),
    });
    if (!res.ok) return '[Erro IA]';
    const data = await res.json();
    return data.content?.[0]?.text || '';
  } catch {
    return '[Erro IA]';
  }
}

// ── Execução de acções internas ───────────────────────
async function executeAction(node: FlowNode, ctx: RunContext) {
  const action = node.data?.actionType;
  const params = node.data?.actionParams || {};

  switch (action) {
    case 'create_task': {
      // Precisa de um responsável; se nada for passado, usa primeiro OWNER do workspace
      const assigneeId = params.assignedToId || (await prisma.user.findFirst({
        where: { workspaceId: ctx.workspaceId, role: 'OWNER' },
        select: { id: true },
      }))?.id;
      if (!assigneeId) { ctx.log.push('action create_task: sem responsável disponível'); return; }

      await prisma.task.create({
        data: {
          title: interpolate(params.title || 'Nova tarefa do chatbot', ctx),
          description: interpolate(params.description || '', ctx),
          type: params.type || 'FOLLOW_UP',
          priority: params.priority || 'MEDIUM',
          dueAt: params.dueInHours ? new Date(Date.now() + Number(params.dueInHours) * 3600000) : null,
          leadId: ctx.leadId || null,
          assignedToId: assigneeId,
        },
      });
      ctx.log.push(`action create_task: tarefa criada`);
      break;
    }

    case 'assign_user': {
      if (!ctx.leadId) { ctx.log.push('action assign_user: sem lead'); return; }
      if (!params.userId) { ctx.log.push('action assign_user: sem userId'); return; }
      await prisma.lead.update({ where: { id: ctx.leadId }, data: { assignedToId: params.userId } });
      ctx.log.push(`action assign_user: lead atribuído a ${params.userId}`);
      break;
    }

    case 'change_stage': {
      if (!ctx.leadId) { ctx.log.push('action change_stage: sem lead'); return; }
      if (!params.stageId) { ctx.log.push('action change_stage: sem stageId'); return; }
      const stage = await prisma.stage.findUnique({ where: { id: params.stageId } });
      if (!stage) { ctx.log.push('action change_stage: etapa não existe'); return; }
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: {
          stageId: stage.id,
          pipelineId: stage.pipelineId,
          status: stage.type === 'WON' ? 'WON' : stage.type === 'LOST' ? 'LOST' : 'OPEN',
          closedAt: stage.type !== 'REGULAR' ? new Date() : null,
        },
      });
      ctx.log.push(`action change_stage: etapa alterada para ${stage.name}`);
      break;
    }

    case 'add_tag': {
      if (!params.tagId) { ctx.log.push('action add_tag: sem tagId'); return; }
      const target = params.entity || 'contact';
      try {
        if (target === 'lead' && ctx.leadId) {
          await prisma.tagOnLead.create({ data: { leadId: ctx.leadId, tagId: params.tagId } });
        } else if (target === 'contact') {
          await prisma.tagOnContact.create({ data: { contactId: ctx.contactId, tagId: params.tagId } });
        }
        ctx.log.push(`action add_tag: tag ${params.tagId} adicionada a ${target}`);
      } catch {
        // já existe ou erro silencioso
      }
      break;
    }

    case 'webhook': {
      if (!params.url) { ctx.log.push('action webhook: sem url'); return; }
      try {
        await fetch(params.url, {
          method: params.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: ctx.workspaceId,
            contactId: ctx.contactId,
            leadId: ctx.leadId,
            message: ctx.lastMessage,
            vars: ctx.vars,
            payload: params.payload || {},
          }),
        });
        ctx.log.push(`action webhook: chamado ${params.url}`);
      } catch (e: any) {
        ctx.log.push(`action webhook: erro ${e.message}`);
      }
      break;
    }

    case 'set_priority': {
      if (!ctx.leadId) { ctx.log.push('action set_priority: sem lead'); return; }
      if (!params.priority) return;
      await prisma.lead.update({ where: { id: ctx.leadId }, data: { priority: params.priority } });
      ctx.log.push(`action set_priority: prioridade ${params.priority}`);
      break;
    }

    case 'create_lead': {
      if (ctx.leadId) { ctx.log.push('action create_lead: já existe lead'); return; }
      const pipeline = await prisma.pipeline.findFirst({
        where: { workspaceId: ctx.workspaceId, ...(params.pipelineId ? { id: params.pipelineId } : { isDefault: true }) },
        include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
      });
      const stageId = params.stageId || pipeline?.stages[0]?.id;
      if (!pipeline || !stageId) { ctx.log.push('action create_lead: sem pipeline'); return; }
      const owner = await prisma.user.findFirst({ where: { workspaceId: ctx.workspaceId, role: 'OWNER' }, select: { id: true } });
      if (!owner) return;
      const lead = await prisma.lead.create({
        data: {
          title: interpolate(params.title || `Lead via chatbot - ${ctx.contact?.firstName || ''}`, ctx),
          source: params.source || 'Chatbot',
          workspaceId: ctx.workspaceId,
          pipelineId: pipeline.id,
          stageId,
          contactId: ctx.contactId,
          createdById: owner.id,
          priority: params.priority || 'MEDIUM',
        },
      });
      ctx.leadId = lead.id;
      ctx.log.push(`action create_lead: lead ${lead.id} criado`);
      break;
    }

    default:
      ctx.log.push(`action desconhecida: ${action}`);
  }
}

// ── Envia mensagem (com persistência na BD e via canal) ───
async function sendMessage(text: string, ctx: RunContext) {
  const interpolated = interpolate(text, ctx);

  if (ctx.dryRun) {
    ctx.log.push(`(simulado) message: ${interpolated}`);
    return;
  }

  // Persiste em BD
  let externalId: string | null = null;
  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;

  if (ctx.channel === 'WHATSAPP' && phone) {
    externalId = await sendWhatsApp(ctx.workspaceId, phone, interpolated);
  }

  const saved = await prisma.message.create({
    data: {
      content: interpolated,
      type: 'TEXT',
      direction: 'OUTBOUND',
      channel: ctx.channel as any,
      status: externalId ? 'SENT' : 'PENDING',
      externalId: externalId || undefined,
      leadId: ctx.leadId || undefined,
      contactId: ctx.contactId,
    },
  });

  // Emit via socket
  const io = ctx.io || (global as any).io;
  if (io) {
    io.to(`workspace:${ctx.workspaceId}`).emit('message:new', saved);
    if (ctx.leadId) io.to(`lead:${ctx.leadId}`).emit('message:new', saved);
  }

  ctx.log.push(`message: ${interpolated.substring(0, 80)}`);
}

// ── Loop principal de execução ────────────────────────
// startNodeId pode ser null (começa do trigger) ou um nó específico (retomar de sessão)
async function executeFromNode(
  startNodeId: string | null,
  ctx: RunContext,
  sessionId: string | null,
): Promise<void> {
  const start = startNodeId ? ctx.nodes.find((n) => n.id === startNodeId) : findStartNode(ctx.nodes);
  if (!start) { ctx.log.push('sem nó inicial'); return; }

  // Se começamos do trigger, avançamos para o próximo
  let currentId: string | null = start.type === 'trigger' ? nextNodeId(start.id, ctx.edges) : start.id;
  let safety = 0;

  while (currentId && safety < 100) {
    safety++;
    const node: FlowNode | undefined = ctx.nodes.find((n) => n.id === currentId);
    if (!node) break;

    switch (node.type) {
      case 'message': {
        await sendMessage(node.data?.text || node.data?.label || '', ctx);

        // Se este nó espera resposta, paramos aqui e guardamos sessão
        if (node.data?.waitForReply) {
          await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'condition': {
        const branch = evaluateCondition(node, ctx);
        ctx.log.push(`condition: ${branch}`);
        currentId = nextNodeId(node.id, ctx.edges, branch);
        break;
      }

      case 'action': {
        await executeAction(node, ctx);
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'delay': {
        const seconds = Number(node.data?.delaySeconds) || 60;
        const resumeAt = new Date(Date.now() + seconds * 1000);
        ctx.log.push(`delay: a aguardar ${seconds}s`);
        await persistSession(ctx, node.id, sessionId, resumeAt);

        // Agenda retoma in-memory (em produção devia usar cron, mas para v1 chega)
        if (!ctx.dryRun) {
          setTimeout(() => {
            resumeChatbotSession(sessionId || '', ctx.flowId).catch((e) => console.error('resume error:', e));
          }, seconds * 1000);
        }
        return;
      }

      case 'ai': {
        const lead = ctx.leadId
          ? await prisma.lead.findUnique({
              where: { id: ctx.leadId },
              include: { messages: { orderBy: { createdAt: 'desc' }, take: 10 } },
            })
          : null;

        const history = (lead?.messages || [])
          .reverse()
          .map((m) => ({ role: m.direction === 'INBOUND' ? 'user' : 'assistant', content: m.content }));

        if (ctx.lastMessage) history.push({ role: 'user', content: ctx.lastMessage });

        const workspace = await prisma.workspace.findUnique({ where: { id: ctx.workspaceId } });
        const systemPrompt = interpolate(
          node.data?.aiPrompt ||
          `És o assistente virtual de ${workspace?.name || 'nossa empresa'}. Responde a clientes de forma profissional, concisa e em Português de Moçambique.`,
          ctx,
        );

        const reply = await callClaude(systemPrompt, history);
        await sendMessage(reply, ctx);

        if (node.data?.waitForReply) {
          await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'end': {
        ctx.log.push('end: fluxo terminado');
        if (sessionId) {
          await prisma.chatbotSession.update({ where: { id: sessionId }, data: { isFinished: true, currentNodeId: node.id } });
        }
        return;
      }

      default: {
        ctx.log.push(`nó desconhecido: ${node.type}`);
        currentId = nextNodeId(node.id, ctx.edges);
      }
    }
  }

  // Se sai do loop sem encontrar end, marca sessão como terminada na mesma
  if (sessionId) {
    await prisma.chatbotSession.update({ where: { id: sessionId }, data: { isFinished: true } }).catch(() => {});
  }
}

// ── Persiste/cria sessão ──────────────────────────────
async function persistSession(
  ctx: RunContext,
  currentNodeId: string,
  existingSessionId: string | null,
  resumeAt?: Date,
): Promise<string> {
  if (ctx.dryRun) return existingSessionId || '';
  if (existingSessionId) {
    await prisma.chatbotSession.update({
      where: { id: existingSessionId },
      data: {
        currentNodeId,
        variables: ctx.vars,
        leadId: ctx.leadId || null,
        resumeAt: resumeAt || null,
      },
    });
    return existingSessionId;
  }
  const created = await prisma.chatbotSession.create({
    data: {
      flowId: ctx.flowId,
      workspaceId: ctx.workspaceId,
      contactId: ctx.contactId,
      leadId: ctx.leadId || null,
      currentNodeId,
      variables: ctx.vars,
      resumeAt: resumeAt || null,
    },
  });
  return created.id;
}

// ── Carrega flow + monta contexto ─────────────────────
async function buildContext(
  flowId: string,
  opts: { workspaceId: string; contactId: string; message?: string; leadId?: string | null; channel?: string; dryRun?: boolean; io?: any },
): Promise<RunContext | null> {
  const flow = await prisma.chatbotFlow.findUnique({ where: { id: flowId } });
  if (!flow) return null;

  const contact = await prisma.contact.findUnique({ where: { id: opts.contactId } });
  if (!contact) return null;

  return {
    workspaceId: opts.workspaceId,
    contactId: opts.contactId,
    leadId: opts.leadId || null,
    flowId,
    nodes: (flow.nodes as any) as FlowNode[],
    edges: (flow.edges as any) as FlowEdge[],
    vars: {},
    lastMessage: opts.message || '',
    channel: opts.channel || flow.channel || 'WHATSAPP',
    dryRun: opts.dryRun !== false ? !!opts.dryRun : false,
    log: [],
    contact,
    io: opts.io,
  };
}

// ── Entry-point: corre um fluxo específico (modo teste) ─
export async function runChatbotById(
  flowId: string,
  opts: { workspaceId: string; contactId: string; message?: string; dryRun?: boolean; io?: any },
): Promise<string[]> {
  const ctx = await buildContext(flowId, { ...opts, dryRun: opts.dryRun !== false });
  if (!ctx) return ['Fluxo ou contacto não encontrado'];
  await executeFromNode(null, ctx, null);
  return ctx.log;
}

// ── Entry-point: chamado pelo webhook quando chega mensagem ─
export async function runChatbotForMessage(opts: {
  workspaceId: string;
  contactId: string;
  leadId?: string | null;
  message: string;
  channel: string;
  io?: any;
}): Promise<void> {
  const { workspaceId, contactId, leadId, message, channel } = opts;

  // 1. Verificar se há sessão activa pendente para este contacto
  const session = await prisma.chatbotSession.findFirst({
    where: { workspaceId, contactId, isFinished: false, resumeAt: null },
    orderBy: { updatedAt: 'desc' },
  });

  if (session) {
    // Retomar fluxo: o nó actual é tipicamente um message com waitForReply
    const ctx = await buildContext(session.flowId, {
      workspaceId,
      contactId,
      leadId: leadId ?? session.leadId,
      message,
      channel,
      dryRun: false,
      io: opts.io,
    });
    if (!ctx) return;
    ctx.vars = (session.variables as any) || {};

    // Capturar resposta na variável definida pelo nó actual (se tiver saveAs)
    const currentNode = ctx.nodes.find((n) => n.id === session.currentNodeId);
    if (currentNode?.data?.saveAs) {
      ctx.vars[currentNode.data.saveAs] = message;
    }

    // Avança para o próximo nó depois do nó actual
    const nextId = nextNodeId(session.currentNodeId, ctx.edges);
    if (!nextId) {
      await prisma.chatbotSession.update({ where: { id: session.id }, data: { isFinished: true } });
      return;
    }

    await prisma.chatbotFlow.update({ where: { id: ctx.flowId }, data: { runCount: { increment: 1 } } });
    await executeFromNode(nextId, ctx, session.id);
    return;
  }

  // 2. Sem sessão: procurar fluxos activos cujo trigger active
  const flows = await prisma.chatbotFlow.findMany({
    where: { workspaceId, isActive: true, channel },
    orderBy: { createdAt: 'asc' },
  });

  // Verificar se é primeira mensagem
  const inboundCount = await prisma.message.count({
    where: { contactId, direction: 'INBOUND' },
  });
  const isFirstMessage = inboundCount <= 1; // a mensagem actual já foi guardada

  for (const flow of flows) {
    let triggers = false;
    if (flow.trigger === 'always') {
      triggers = true;
    } else if (flow.trigger === 'first_message') {
      triggers = isFirstMessage;
    } else if (flow.trigger === 'keyword') {
      const kw = (flow.triggerValue || '').toLowerCase().trim();
      triggers = !!kw && message.toLowerCase().includes(kw);
    }

    if (!triggers) continue;

    const ctx = await buildContext(flow.id, {
      workspaceId,
      contactId,
      leadId,
      message,
      channel,
      dryRun: false,
      io: opts.io,
    });
    if (!ctx) continue;

    await prisma.chatbotFlow.update({
      where: { id: flow.id },
      data: { runCount: { increment: 1 }, leadCount: leadId ? { increment: 1 } : undefined },
    });

    await executeFromNode(null, ctx, null);
    // Só executa o primeiro fluxo que activa, para não duplicar respostas
    return;
  }
}

// ── Retomar uma sessão (chamado por delay setTimeout) ─
async function resumeChatbotSession(sessionId: string, flowId: string): Promise<void> {
  if (!sessionId) return;
  const session = await prisma.chatbotSession.findUnique({ where: { id: sessionId } });
  if (!session || session.isFinished) return;

  const ctx = await buildContext(session.flowId, {
    workspaceId: session.workspaceId,
    contactId: session.contactId,
    leadId: session.leadId,
    message: '',
    channel: 'WHATSAPP',
    dryRun: false,
  });
  if (!ctx) return;
  ctx.vars = (session.variables as any) || {};

  const nextId = nextNodeId(session.currentNodeId, ctx.edges);
  if (!nextId) {
    await prisma.chatbotSession.update({ where: { id: sessionId }, data: { isFinished: true } });
    return;
  }

  await prisma.chatbotSession.update({ where: { id: sessionId }, data: { resumeAt: null } });
  await executeFromNode(nextId, ctx, sessionId);
}

// ── Cron-friendly: processa todas as sessões com resumeAt expirado ─
// Pode ser chamado por endpoint ou setInterval no startup do servidor.
export async function processExpiredDelays(): Promise<number> {
  const now = new Date();
  const sessions = await prisma.chatbotSession.findMany({
    where: { isFinished: false, resumeAt: { lte: now, not: null } },
    take: 50,
  });

  let processed = 0;
  for (const s of sessions) {
    try {
      await resumeChatbotSession(s.id, s.flowId);
      processed++;
    } catch (e) {
      console.error('Erro a retomar sessão', s.id, e);
    }
  }
  return processed;
}
