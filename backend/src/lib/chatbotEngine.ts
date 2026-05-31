/**
 * Motor de execução de chatbots.
 *
 * Tipos de nó suportados:
 *   trigger    -> ponto de entrada, sem efeito
 *   message    -> envia texto. Pode esperar resposta (data.waitForReply).
 *   template   -> envia template aprovado WhatsApp Cloud com variáveis posicionais.
 *   media      -> envia imagem/video/audio/documento.
 *   buttons    -> envia interactive message com botões. Espera sempre resposta.
 *   condition  -> avalia contra a última mensagem ou variável; tem 2 handles (yes/no).
 *   action     -> executa acção interna (create_task, assign_user, change_stage, etc).
 *   handoff    -> transfere conversa para humano e termina o fluxo.
 *   delay      -> espera N segundos antes de continuar.
 *   ai         -> chama a Anthropic API com o histórico e envia a resposta.
 *   end        -> marca sessão como terminada.
 */

import prisma from './prisma';
import { getCreds, encryptForStore } from './integrationCrypto';

// ── Types ─────────────────────────────────────────────
type NodeType = 'trigger' | 'message' | 'template' | 'media' | 'buttons' | 'list' | 'condition' | 'switch' | 'action' | 'handoff' | 'delay' | 'ai' | 'set_var' | 'fetch_data' | 'subflow' | 'end';

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

interface LogEntry {
  at: string;
  nodeId: string;
  nodeType: string;
  action: string;
  detail?: string;
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
  steps: LogEntry[];
  contact: any;
  io?: any;
}

function recordStep(ctx: RunContext, node: FlowNode, action: string, detail?: string) {
  ctx.steps.push({
    at: new Date().toISOString(),
    nodeId: node.id,
    nodeType: node.type,
    action,
    detail,
  });
  ctx.log.push(`${node.type}: ${action}${detail ? ` (${detail})` : ''}`);
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

function conditionDescribe(node: FlowNode): string {
  const t = node.data?.conditionType || 'contains';
  const v = node.data?.conditionValue || '';
  return t === 'is_number' || t === 'has_email' || t === 'has_phone' ? t : `${t} "${v}"`;
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

// ── Envio WhatsApp (helpers) ──────────────────────────
async function getWhatsAppCreds(workspaceId: string): Promise<{ token: string; phoneId: string } | null> {
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WHATSAPP', isActive: true },
  });
  if (!integration) return null;
  const creds: any = getCreds(integration);
  if (!creds?.token || !creds?.phoneId) return null;
  return creds;
}

async function whatsappPost(creds: { token: string; phoneId: string }, payload: any): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Erro WhatsApp:', data);
      return null;
    }
    return data.messages?.[0]?.id || null;
  } catch (e) {
    console.error('Excepção WhatsApp:', e);
    return null;
  }
}

async function sendWhatsApp(workspaceId: string, to: string, text: string): Promise<string | null> {
  const creds = await getWhatsAppCreds(workspaceId);
  if (!creds) return null;
  return whatsappPost(creds, { to, type: 'text', text: { body: text } });
}

async function sendWhatsAppTemplateMsg(workspaceId: string, to: string, templateName: string, langCode: string, variables: string[]): Promise<string | null> {
  const creds = await getWhatsAppCreds(workspaceId);
  if (!creds) return null;
  const components = variables.length
    ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }]
    : [];
  return whatsappPost(creds, {
    to,
    type: 'template',
    template: { name: templateName, language: { code: langCode }, components },
  });
}

async function sendWhatsAppMediaMsg(workspaceId: string, to: string, mediaType: string, mediaUrl: string, caption?: string): Promise<string | null> {
  const creds = await getWhatsAppCreds(workspaceId);
  if (!creds) return null;
  const payload: any = { to, type: mediaType, [mediaType]: { link: mediaUrl } };
  if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    payload[mediaType].caption = caption;
  }
  return whatsappPost(creds, payload);
}

async function sendWhatsAppButtons(workspaceId: string, to: string, text: string, buttons: { id: string; label: string }[]): Promise<string | null> {
  const creds = await getWhatsAppCreds(workspaceId);
  if (!creds) return null;
  // WhatsApp limita a 3 botões interactive
  const items = buttons.slice(0, 3).map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.label.substring(0, 20) },
  }));
  return whatsappPost(creds, {
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: text.substring(0, 1024) },
      action: { buttons: items },
    },
  });
}

async function sendWhatsAppList(
  workspaceId: string,
  to: string,
  text: string,
  buttonLabel: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
): Promise<string | null> {
  const creds = await getWhatsAppCreds(workspaceId);
  if (!creds) return null;
  return whatsappPost(creds, {
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: text.substring(0, 1024) },
      action: {
        button: buttonLabel.substring(0, 20),
        sections: sections.map((s) => ({
          title: s.title.substring(0, 24),
          rows: s.rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.substring(0, 24),
            description: r.description ? r.description.substring(0, 72) : undefined,
          })),
        })),
      },
    },
  });
}

// ── Validação de input ────────────────────────────────
function validateInput(value: string, type: string, regex?: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  switch (type) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    case 'phone': return /\d{7,}/.test(v.replace(/\D/g, ''));
    case 'number': return /^\d+([.,]\d+)?$/.test(v);
    case 'url': return /^https?:\/\/\S+/.test(v);
    case 'regex':
      if (!regex) return true;
      try { return new RegExp(regex).test(v); } catch { return true; }
    default: return true;
  }
}

// ── Verificar horário comercial do flow ───────────────
function isWithinBusinessHours(flow: any, now: Date = new Date()): boolean {
  const start = flow.businessHoursStart;
  const end = flow.businessHoursEnd;
  const wd = flow.businessHoursWeekdays;
  if (start == null && end == null && !wd) return true;

  if (wd) {
    const jsDay = now.getDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    if (!String(wd).includes(String(isoDay))) return false;
  }
  if (start != null && end != null) {
    const hour = now.getHours();
    if (start <= end) {
      if (hour < start || hour >= end) return false;
    } else {
      if (hour < start && hour >= end) return false;
    }
  }
  return true;
}

// ── Chamada à API de IA (Groq, com rate limiter partilhado) ────────
import { callGroqWithLimiter } from './groqLimiter';
async function callAi(systemPrompt: string, history: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '[IA não configurada]';
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  try {
    return await callGroqWithLimiter(
      apiKey,
      model,
      [{ role: 'system', content: systemPrompt }, ...history],
      400,
      0.7,
    );
  } catch (e: any) {
    console.error('[chatbot ai] falhou:', e?.message || e);
    return '[Erro IA]';
  }
}
// Backwards-compat alias usado nos nós do chatbot.
const callClaude = callAi;

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

// ── Persiste mensagem em BD + emit socket (não envia via canal) ─
async function persistOutboundMessage(content: string, type: string, mediaUrl: string | undefined, externalId: string | null, ctx: RunContext) {
  const saved = await prisma.message.create({
    data: {
      content,
      type: type as any,
      direction: 'OUTBOUND',
      channel: ctx.channel as any,
      status: externalId ? 'SENT' : 'PENDING',
      externalId: externalId || undefined,
      mediaUrl,
      leadId: ctx.leadId || undefined,
      contactId: ctx.contactId,
    },
  });
  const io = ctx.io || (global as any).io;
  if (io) {
    io.to(`workspace:${ctx.workspaceId}`).emit('message:new', saved);
    if (ctx.leadId) io.to(`lead:${ctx.leadId}`).emit('message:new', saved);
  }
}

async function sendMessage(text: string, ctx: RunContext) {
  const interpolated = interpolate(text, ctx);

  if (ctx.dryRun) {
    ctx.log.push(`(simulado) message: ${interpolated}`);
    return;
  }

  let externalId: string | null = null;
  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;

  if (ctx.channel === 'WHATSAPP' && phone) {
    externalId = await sendWhatsApp(ctx.workspaceId, phone, interpolated);
  }

  await persistOutboundMessage(interpolated, 'TEXT', undefined, externalId, ctx);
  ctx.log.push(`message: ${interpolated.substring(0, 80)}`);
}

async function sendTemplate(node: FlowNode, ctx: RunContext) {
  const templateName = node.data?.templateName || '';
  const langCode = node.data?.langCode || 'pt_BR';
  const rawVars: string[] = Array.isArray(node.data?.variables) ? node.data.variables : [];
  const variables = rawVars.map((v) => interpolate(String(v), ctx));

  if (ctx.dryRun) {
    recordStep(ctx, node, 'template', `${templateName} (${langCode}) com ${variables.length} variáveis`);
    return;
  }

  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;
  let externalId: string | null = null;
  if (ctx.channel === 'WHATSAPP' && phone && templateName) {
    externalId = await sendWhatsAppTemplateMsg(ctx.workspaceId, phone, templateName, langCode, variables);
  }

  const summary = `[Template: ${templateName}]${variables.length ? ' ' + variables.join(' | ') : ''}`;
  await persistOutboundMessage(summary, 'TEMPLATE', undefined, externalId, ctx);
  recordStep(ctx, node, 'template', summary);
}

async function sendMedia(node: FlowNode, ctx: RunContext) {
  const mediaType = (node.data?.mediaType || 'image') as 'image' | 'video' | 'audio' | 'document';
  const mediaUrl = interpolate(node.data?.mediaUrl || '', ctx);
  const caption = node.data?.caption ? interpolate(node.data.caption, ctx) : undefined;

  if (!mediaUrl) {
    recordStep(ctx, node, 'media skip', 'sem URL');
    return;
  }

  if (ctx.dryRun) {
    recordStep(ctx, node, 'media', `${mediaType}: ${mediaUrl}`);
    return;
  }

  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;
  let externalId: string | null = null;
  if (ctx.channel === 'WHATSAPP' && phone) {
    externalId = await sendWhatsAppMediaMsg(ctx.workspaceId, phone, mediaType, mediaUrl, caption);
  }

  const upperType = mediaType.toUpperCase();
  const content = caption || `[${upperType}]`;
  await persistOutboundMessage(content, upperType, mediaUrl, externalId, ctx);
  recordStep(ctx, node, 'media', `${mediaType}: ${mediaUrl.substring(0, 60)}`);
}

async function sendButtons(node: FlowNode, ctx: RunContext) {
  const text = interpolate(node.data?.text || node.data?.label || 'Escolhe uma opção:', ctx);
  const rawButtons: any[] = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
  const buttons = rawButtons
    .filter((b) => b && b.label)
    .slice(0, 3)
    .map((b, i) => ({ id: String(b.id || `btn_${i}`), label: String(b.label) }));

  if (buttons.length === 0) {
    recordStep(ctx, node, 'buttons skip', 'sem botões');
    return;
  }

  if (ctx.dryRun) {
    recordStep(ctx, node, 'buttons', `${text} [${buttons.map((b) => b.label).join(' | ')}]`);
    return;
  }

  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;
  let externalId: string | null = null;
  if (ctx.channel === 'WHATSAPP' && phone) {
    externalId = await sendWhatsAppButtons(ctx.workspaceId, phone, text, buttons);
  }

  const summary = `${text}\n\n${buttons.map((b) => `[${b.label}]`).join(' ')}`;
  await persistOutboundMessage(summary, 'INTERACTIVE', undefined, externalId, ctx);
  recordStep(ctx, node, 'buttons', text.substring(0, 80));
}

async function executeHandoff(node: FlowNode, ctx: RunContext) {
  const userId = node.data?.userId || null;
  const teamId = node.data?.teamId || null;
  const farewell = node.data?.message ? interpolate(node.data.message, ctx) : '';

  // Mensagem opcional de transição ao cliente
  if (farewell) await sendMessage(farewell, ctx);

  if (ctx.dryRun) {
    recordStep(ctx, node, 'handoff', `userId=${userId} teamId=${teamId}`);
    return;
  }

  // Resolver utilizador final: se userId definido, usa-o. Senão, escolhe membro da equipa com menos conversas atribuídas.
  let assignTo = userId;
  if (!assignTo && teamId) {
    const teamUsers = await prisma.user.findMany({ where: { teamId, isActive: true }, select: { id: true } });
    if (teamUsers.length) {
      // Round-robin simples: escolhe o que tem menos conversas atribuídas
      const counts = await Promise.all(
        teamUsers.map(async (u) => ({
          id: u.id,
          n: await prisma.conversationMeta.count({ where: { assignedToId: u.id, isArchived: false } }),
        })),
      );
      counts.sort((a, b) => a.n - b.n);
      assignTo = counts[0]?.id || null;
    }
  }

  // Atribuir conversa via ConversationMeta (chave: workspace + contact + channel)
  if (assignTo) {
    const channel = ctx.channel;
    await prisma.conversationMeta.upsert({
      where: { workspaceId_contactId_channel: { workspaceId: ctx.workspaceId, contactId: ctx.contactId, channel } },
      create: { workspaceId: ctx.workspaceId, contactId: ctx.contactId, channel, assignedToId: assignTo },
      update: { assignedToId: assignTo },
    });

    // Notificar o agente
    await prisma.notification.create({
      data: {
        userId: assignTo,
        title: 'Conversa atribuída pelo chatbot',
        body: `${ctx.contact?.firstName || 'Cliente'} foi transferido para ti`,
        type: 'handoff',
        link: '/inbox',
      },
    }).catch(() => {});

    const io = ctx.io || (global as any).io;
    if (io) io.to(`user:${assignTo}`).emit('notification:new', { type: 'handoff' });

    recordStep(ctx, node, 'handoff', `atribuído a ${assignTo}`);
  } else {
    recordStep(ctx, node, 'handoff', 'sem agente disponível');
  }
}

async function sendListNode(node: FlowNode, ctx: RunContext) {
  const text = interpolate(node.data?.text || 'Escolhe uma opção:', ctx);
  const buttonLabel = node.data?.buttonLabel || 'Ver opções';
  const sections = Array.isArray(node.data?.sections) ? node.data.sections : [];

  const cleanSections = sections
    .filter((s: any) => s && Array.isArray(s.rows) && s.rows.length > 0)
    .map((s: any) => ({
      title: s.title || 'Opções',
      rows: s.rows.filter((r: any) => r && r.title).map((r: any, i: number) => ({
        id: String(r.id || `row_${i}`),
        title: String(r.title),
        description: r.description ? String(r.description) : undefined,
      })),
    }));

  if (cleanSections.length === 0) {
    recordStep(ctx, node, 'list skip', 'sem rows');
    return;
  }

  if (ctx.dryRun) {
    const total = cleanSections.reduce((acc: number, s: any) => acc + s.rows.length, 0);
    recordStep(ctx, node, 'list', `${total} opções`);
    return;
  }

  const phone = ctx.contact?.whatsapp || ctx.contact?.phone;
  let externalId: string | null = null;
  if (ctx.channel === 'WHATSAPP' && phone) {
    externalId = await sendWhatsAppList(ctx.workspaceId, phone, text, buttonLabel, cleanSections);
  }

  const summary = `${text}\n\n${cleanSections.map((s: any) => `[${s.title}: ${s.rows.map((r: any) => r.title).join(', ')}]`).join('\n')}`;
  await persistOutboundMessage(summary, 'INTERACTIVE', undefined, externalId, ctx);
  recordStep(ctx, node, 'list', text.substring(0, 60));
}

function evaluateSwitch(node: FlowNode, ctx: RunContext): string | null {
  // data.target: nome da variável a comparar (ou vazio = última mensagem)
  // data.cases: [{ value, handle }] - sourceHandle do edge
  // data.default: handle de fallback
  const targetVar = node.data?.target;
  const value = (targetVar ? String(ctx.vars[targetVar] || '') : ctx.lastMessage || '').toLowerCase().trim();
  const cases: any[] = Array.isArray(node.data?.cases) ? node.data.cases : [];
  for (const c of cases) {
    const expected = String(c.value || '').toLowerCase().trim();
    if (expected && value === expected) return c.handle || c.value;
  }
  return node.data?.default || null;
}

async function executeSetVar(node: FlowNode, ctx: RunContext) {
  const name = node.data?.varName;
  if (!name) { recordStep(ctx, node, 'set_var skip', 'sem nome'); return; }
  const value = interpolate(node.data?.varValue || '', ctx);
  ctx.vars[name] = value;
  recordStep(ctx, node, 'set_var', `${name}=${value.substring(0, 40)}`);
}

async function executeFetchData(node: FlowNode, ctx: RunContext) {
  const url = interpolate(node.data?.url || '', ctx);
  const method = node.data?.method || 'GET';
  const saveAs = node.data?.saveAs || 'response';
  if (!url) { recordStep(ctx, node, 'fetch_data skip', 'sem url'); return; }

  if (ctx.dryRun) {
    recordStep(ctx, node, 'fetch_data', `(simulado) ${method} ${url}`);
    return;
  }

  try {
    const headers: any = { 'Content-Type': 'application/json' };
    if (node.data?.headers) {
      try { Object.assign(headers, JSON.parse(interpolate(node.data.headers, ctx))); } catch {}
    }
    const init: any = { method, headers };
    if (method !== 'GET' && node.data?.body) {
      init.body = interpolate(node.data.body, ctx);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch {}

    // Se utilizador especificou um path, extrair
    if (node.data?.path && typeof parsed === 'object') {
      ctx.vars[saveAs] = (node.data.path as string).split('.').reduce((acc: any, k: string) => acc?.[k], parsed) ?? parsed;
    } else {
      ctx.vars[saveAs] = parsed;
    }
    recordStep(ctx, node, 'fetch_data', `${method} ${url} → ${saveAs}`);
  } catch (e: any) {
    recordStep(ctx, node, 'fetch_data fail', e.message);
  }
}

async function executeSubflow(node: FlowNode, ctx: RunContext) {
  const flowId = node.data?.flowId;
  if (!flowId) { recordStep(ctx, node, 'subflow skip', 'sem flowId'); return; }
  if (ctx.dryRun) {
    recordStep(ctx, node, 'subflow', `(simulado) ${flowId}`);
    return;
  }
  try {
    const subCtx = await buildContext(flowId, {
      workspaceId: ctx.workspaceId,
      contactId: ctx.contactId,
      leadId: ctx.leadId,
      message: ctx.lastMessage,
      channel: ctx.channel,
      dryRun: false,
      io: ctx.io,
    });
    if (!subCtx) { recordStep(ctx, node, 'subflow skip', 'flow não encontrado'); return; }
    subCtx.vars = { ...ctx.vars };
    await executeFromNode(null, subCtx, null);
    // Importar variáveis criadas no subflow
    Object.assign(ctx.vars, subCtx.vars);
    recordStep(ctx, node, 'subflow', flowId);
  } catch (e: any) {
    recordStep(ctx, node, 'subflow fail', e.message);
  }
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
        recordStep(ctx, node, 'message sent', (node.data?.text || '').substring(0, 80));
        if (node.data?.waitForReply) {
          sessionId = await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'template': {
        await sendTemplate(node, ctx);
        if (node.data?.waitForReply) {
          sessionId = await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'media': {
        await sendMedia(node, ctx);
        if (node.data?.waitForReply) {
          sessionId = await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'buttons': {
        await sendButtons(node, ctx);
        // Botões esperam sempre resposta
        sessionId = await persistSession(ctx, node.id, sessionId);
        return;
      }

      case 'list': {
        await sendListNode(node, ctx);
        sessionId = await persistSession(ctx, node.id, sessionId);
        return;
      }

      case 'condition': {
        const branch = evaluateCondition(node, ctx);
        recordStep(ctx, node, `condition: ${branch}`, conditionDescribe(node));
        currentId = nextNodeId(node.id, ctx.edges, branch);
        break;
      }

      case 'switch': {
        const handle = evaluateSwitch(node, ctx);
        recordStep(ctx, node, `switch`, handle || 'default');
        currentId = nextNodeId(node.id, ctx.edges, handle || 'default');
        break;
      }

      case 'set_var': {
        await executeSetVar(node, ctx);
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'fetch_data': {
        await executeFetchData(node, ctx);
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'subflow': {
        await executeSubflow(node, ctx);
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'action': {
        await executeAction(node, ctx);
        recordStep(ctx, node, `action ${node.data?.actionType || ''}`);
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'handoff': {
        await executeHandoff(node, ctx);
        if (sessionId) {
          await prisma.chatbotSession.update({
            where: { id: sessionId },
            data: { isFinished: true, currentNodeId: node.id, log: ctx.steps as any },
          });
        }
        return;
      }

      case 'delay': {
        const seconds = Number(node.data?.delaySeconds) || 60;
        const resumeAt = new Date(Date.now() + seconds * 1000);
        recordStep(ctx, node, 'delay', `${seconds}s`);
        sessionId = await persistSession(ctx, node.id, sessionId, resumeAt);

        if (!ctx.dryRun && sessionId) {
          const sid = sessionId;
          setTimeout(() => {
            resumeChatbotSession(sid, ctx.flowId).catch((e) => console.error('resume error:', e));
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
        recordStep(ctx, node, 'ai reply', reply.substring(0, 80));

        if (node.data?.waitForReply) {
          sessionId = await persistSession(ctx, node.id, sessionId);
          return;
        }
        currentId = nextNodeId(node.id, ctx.edges);
        break;
      }

      case 'end': {
        recordStep(ctx, node, 'end', 'fluxo terminado');
        if (sessionId) {
          await prisma.chatbotSession.update({
            where: { id: sessionId },
            data: { isFinished: true, currentNodeId: node.id, log: ctx.steps as any },
          });
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
        log: ctx.steps as any,
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
      log: ctx.steps as any,
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
    dryRun: !!opts.dryRun,
    log: [],
    steps: [],
    contact,
    io: opts.io,
  };
}

// ── Entry-point: corre um fluxo específico (modo teste) ─
export async function runChatbotById(
  flowId: string,
  opts: { workspaceId: string; contactId: string; message?: string; dryRun?: boolean; io?: any },
): Promise<{ log: string[]; steps: LogEntry[] }> {
  const ctx = await buildContext(flowId, { ...opts, dryRun: opts.dryRun !== false });
  if (!ctx) return { log: ['Fluxo ou contacto não encontrado'], steps: [] };
  await executeFromNode(null, ctx, null);
  return { log: ctx.log, steps: ctx.steps };
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
    ctx.steps = (session.log as any) || [];

    const currentNode = ctx.nodes.find((n) => n.id === session.currentNodeId);

    // Validação opcional do input
    if (currentNode?.data?.validate) {
      const valid = validateInput(message, currentNode.data.validate, currentNode.data.validateRegex);
      if (!valid) {
        const errMsg = currentNode.data?.validateError || 'Resposta inválida. Por favor tenta de novo.';
        await sendMessage(errMsg, ctx);
        ctx.steps.push({
          at: new Date().toISOString(), nodeId: currentNode.id, nodeType: currentNode.type,
          action: 'validation failed', detail: message.substring(0, 60),
        });
        await prisma.chatbotSession.update({
          where: { id: session.id },
          data: { log: ctx.steps as any, variables: ctx.vars },
        });
        return; // fica no mesmo nó à espera de outra resposta
      }
    }

    // Capturar resposta na variável definida pelo nó actual (se tiver saveAs)
    if (currentNode?.data?.saveAs) {
      ctx.vars[currentNode.data.saveAs] = message;
    }
    if (currentNode) {
      ctx.steps.push({
        at: new Date().toISOString(),
        nodeId: currentNode.id,
        nodeType: currentNode.type,
        action: 'reply received',
        detail: message.substring(0, 80),
      });
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

    // Verificar horário comercial; fora de horas envia mensagem opcional e não corre o fluxo
    if (!isWithinBusinessHours(flow)) {
      if (flow.outOfHoursMessage) {
        const phone = (await prisma.contact.findUnique({ where: { id: contactId } }))?.whatsapp
          || (await prisma.contact.findUnique({ where: { id: contactId } }))?.phone;
        if (phone) await sendWhatsApp(workspaceId, phone, flow.outOfHoursMessage);
      }
      continue;
    }

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
  ctx.steps = (session.log as any) || [];

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
