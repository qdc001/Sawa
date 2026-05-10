/**
 * Motor de automações: rule-based, event-driven.
 *
 * Estrutura de uma Automation:
 *   trigger     -> { type: 'lead_created'|'lead_stage_changed'|'lead_won'|'lead_lost'|'lead_assigned'
 *                    |'task_created'|'task_completed'|'task_overdue'
 *                    |'message_received'|'tag_added'|'contact_created', params?: {...} }
 *   conditions  -> [{ field, op, value }]   (AND lógico entre todas)
 *   actions     -> [{ type, params }]       (executadas em sequência)
 *
 * Eventos disparados pelos endpoints (chamando triggerAutomations):
 *   - leads.ts (POST/PATCH/move) -> lead_created, lead_stage_changed, lead_won, lead_lost, lead_assigned
 *   - tasks.ts (POST/PATCH)      -> task_created, task_completed
 *   - messages.ts                -> message_received
 *   - contacts.ts (POST)         -> contact_created
 *   - cron interno               -> task_overdue
 *
 * Acções (similar ao chatbotEngine, mas independente):
 *   send_message, send_template, create_task, assign_user, change_stage,
 *   add_tag, set_priority, send_email, webhook, send_notification
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TriggerEvent {
  type: string;
  workspaceId: string;
  entityType?: 'lead' | 'task' | 'message' | 'contact';
  entityId?: string;
  payload?: any;          // dados do recurso afectado (lead completo, task completa, etc)
  triggeredBy?: string;   // id do user que causou o evento
}

interface Condition {
  field: string;   // ex: "priority", "stage.type", "value", "contact.country", "tags"
  op: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'has_tag' | 'is_empty' | 'is_not_empty';
  value?: any;
}

interface Action {
  type: string;
  params: Record<string, any>;
}

interface RuleContext {
  workspaceId: string;
  event: TriggerEvent;
  entity: any;     // resource principal (lead/task/message/contact)
  steps: { at: string; action: string; detail?: string }[];
  io?: any;
}

// ── Helpers ───────────────────────────────────────────
function getField(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function interpolate(template: string, ctx: RuleContext): string {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const v = getField(ctx.entity, path.trim());
    return v == null ? '' : String(v);
  });
}

function record(ctx: RuleContext, action: string, detail?: string) {
  ctx.steps.push({ at: new Date().toISOString(), action, detail });
}

// ── Avaliar uma condição individual ───────────────────
function evalSingle(cond: Condition, entity: any): boolean {
  const actual = getField(entity, cond.field);
  switch (cond.op) {
    case 'equals': return String(actual) === String(cond.value);
    case 'not_equals': return String(actual) !== String(cond.value);
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase());
    case 'greater_than': return Number(actual) > Number(cond.value);
    case 'less_than': return Number(actual) < Number(cond.value);
    case 'has_tag': {
      const tags = Array.isArray(entity?.tags) ? entity.tags : [];
      return tags.some((t: any) => t?.tag?.id === cond.value || t?.tagId === cond.value || t?.tag?.name === cond.value);
    }
    case 'is_empty': return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'is_not_empty': return !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0));
  }
  return false;
}

// ── Avaliar condições com suporte a OR/AND (estrutura nested ou array legado) ───
function evaluateConditions(conditions: any, entity: any): { match: boolean; reason?: string } {
  if (!conditions) return { match: true };

  // Formato novo: { op: 'AND'|'OR', items: [...] }
  if (!Array.isArray(conditions) && typeof conditions === 'object' && conditions.items) {
    const items = conditions.items as Condition[];
    if (items.length === 0) return { match: true };
    if (conditions.op === 'OR') {
      const ok = items.some((c) => evalSingle(c, entity));
      return ok ? { match: true } : { match: false, reason: 'nenhuma condição OR satisfeita' };
    }
    // AND default
    for (const c of items) {
      if (!evalSingle(c, entity)) return { match: false, reason: `falhou em ${c.field} ${c.op} ${c.value}` };
    }
    return { match: true };
  }

  // Formato legado: array directo (AND)
  if (Array.isArray(conditions)) {
    if (conditions.length === 0) return { match: true };
    for (const c of conditions) {
      if (!evalSingle(c, entity)) return { match: false, reason: `falhou em ${c.field} ${c.op} ${c.value}` };
    }
    return { match: true };
  }

  return { match: true };
}

// ── Verificar horário activo ──────────────────────────
function isWithinActiveHours(auto: any, now: Date = new Date()): boolean {
  const start = auto.activeHoursStart;
  const end = auto.activeHoursEnd;
  const wd = auto.activeWeekdays;

  if (start == null && end == null && !wd) return true;

  // Dia da semana (1=Segunda...7=Domingo, JS: 0=Domingo...6=Sábado)
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
      // intervalo que cruza meia-noite
      if (hour < start && hour >= end) return false;
    }
  }
  return true;
}

// ── Verificar limites de execução ─────────────────────
async function isWithinRunLimits(auto: any, contactId: string | null): Promise<{ ok: boolean; reason?: string }> {
  const now = Date.now();
  const window = (auto.runLimitWindow || 24) * 3600000;
  const cutoff = new Date(now - window);

  if (auto.runLimitPerContact && contactId) {
    const count = await prisma.automationRun.count({
      where: { automationId: auto.id, contactId, status: 'OK', createdAt: { gte: cutoff } },
    });
    if (count >= auto.runLimitPerContact) return { ok: false, reason: `limite por contacto (${auto.runLimitPerContact}) atingido` };
  }

  if (auto.runLimitTotal) {
    const count = await prisma.automationRun.count({
      where: { automationId: auto.id, status: 'OK', createdAt: { gte: cutoff } },
    });
    if (count >= auto.runLimitTotal) return { ok: false, reason: `limite total (${auto.runLimitTotal}) atingido` };
  }

  return { ok: true };
}

// ── WhatsApp helper (reuso simplificado do chatbotEngine) ───
async function sendWhatsAppText(workspaceId: string, to: string, text: string): Promise<boolean> {
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WHATSAPP', isActive: true },
  });
  if (!integration) return false;
  const creds: any = integration.credentials;
  if (!creds?.token || !creds?.phoneId) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    return res.ok;
  } catch { return false; }
}

async function sendEmailAction(workspaceId: string, to: string, subject: string, body: string): Promise<boolean> {
  try {
    const { sendEmail } = await import('./mailer');
    const result = await sendEmail({ workspaceId, to, subject, html: body });
    return result.sent;
  } catch (e) {
    console.error('Erro a importar mailer:', e);
    return false;
  }
}

// ── Executar uma acção ────────────────────────────────
async function executeAction(action: Action, ctx: RuleContext): Promise<void> {
  const params = action.params || {};
  const entity = ctx.entity || {};
  const leadId = entity?.id && ctx.event.entityType === 'lead' ? entity.id : entity?.leadId || null;
  const contactId = entity?.contactId || entity?.contact?.id || (ctx.event.entityType === 'contact' ? entity.id : null);

  switch (action.type) {
    case 'send_message': {
      const text = interpolate(params.text || '', ctx);
      const phone = entity?.contact?.whatsapp || entity?.contact?.phone || entity?.whatsapp || entity?.phone;
      if (!text || !phone) { record(ctx, 'send_message skip', 'sem texto ou telefone'); return; }
      const ok = await sendWhatsAppText(ctx.workspaceId, phone, text);
      // Persistir mensagem
      if (ok) {
        await prisma.message.create({
          data: {
            content: text,
            type: 'TEXT',
            direction: 'OUTBOUND',
            channel: 'WHATSAPP',
            status: 'SENT',
            leadId: leadId || undefined,
            contactId: contactId || undefined,
          },
        });
      }
      record(ctx, 'send_message', ok ? `enviado a ${phone}` : 'falhou');
      break;
    }

    case 'create_task': {
      const assigneeId = params.assignedToId
        || entity?.assignedToId
        || (await prisma.user.findFirst({ where: { workspaceId: ctx.workspaceId, role: 'OWNER' }, select: { id: true } }))?.id;
      if (!assigneeId) { record(ctx, 'create_task skip', 'sem responsável'); return; }
      await prisma.task.create({
        data: {
          title: interpolate(params.title || 'Nova tarefa automática', ctx),
          description: interpolate(params.description || '', ctx),
          type: params.taskType || 'FOLLOW_UP',
          priority: params.priority || 'MEDIUM',
          dueAt: params.dueInHours ? new Date(Date.now() + Number(params.dueInHours) * 3600000) : null,
          leadId: leadId || undefined,
          assignedToId: assigneeId,
        },
      });
      record(ctx, 'create_task', params.title);
      break;
    }

    case 'assign_user': {
      if (!leadId) { record(ctx, 'assign_user skip', 'sem lead'); return; }
      if (!params.userId) { record(ctx, 'assign_user skip', 'sem userId'); return; }
      await prisma.lead.update({ where: { id: leadId }, data: { assignedToId: params.userId } });
      record(ctx, 'assign_user', params.userId);
      break;
    }

    case 'change_stage': {
      if (!leadId) { record(ctx, 'change_stage skip', 'sem lead'); return; }
      if (!params.stageId) { record(ctx, 'change_stage skip', 'sem stageId'); return; }
      const stage = await prisma.stage.findUnique({ where: { id: params.stageId } });
      if (!stage) { record(ctx, 'change_stage skip', 'etapa inexistente'); return; }
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          stageId: stage.id,
          pipelineId: stage.pipelineId,
          status: stage.type === 'WON' ? 'WON' : stage.type === 'LOST' ? 'LOST' : 'OPEN',
          closedAt: stage.type !== 'REGULAR' ? new Date() : null,
        },
      });
      record(ctx, 'change_stage', stage.name);
      break;
    }

    case 'add_tag': {
      if (!params.tagId) { record(ctx, 'add_tag skip', 'sem tagId'); return; }
      const target = params.entity || (leadId ? 'lead' : 'contact');
      try {
        if (target === 'lead' && leadId) {
          await prisma.tagOnLead.create({ data: { leadId, tagId: params.tagId } });
        } else if (target === 'contact' && contactId) {
          await prisma.tagOnContact.create({ data: { contactId, tagId: params.tagId } });
        }
        record(ctx, 'add_tag', `${target}/${params.tagId}`);
      } catch { /* já existe */ }
      break;
    }

    case 'set_priority': {
      if (!leadId) { record(ctx, 'set_priority skip', 'sem lead'); return; }
      if (!params.priority) return;
      await prisma.lead.update({ where: { id: leadId }, data: { priority: params.priority } });
      record(ctx, 'set_priority', params.priority);
      break;
    }

    case 'send_email': {
      const to = interpolate(params.to || '{{contact.email}}', ctx);
      const subject = interpolate(params.subject || '', ctx);
      const body = interpolate(params.body || '', ctx);
      if (!to || !subject) { record(ctx, 'send_email skip', 'sem to/subject'); return; }
      const ok = await sendEmailAction(ctx.workspaceId, to, subject, body);
      record(ctx, 'send_email', ok ? `enviado a ${to}` : 'falhou');
      break;
    }

    case 'webhook': {
      if (!params.url) { record(ctx, 'webhook skip', 'sem url'); return; }
      try {
        await fetch(params.url, {
          method: params.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: ctx.event.type,
            workspaceId: ctx.workspaceId,
            entityType: ctx.event.entityType,
            entityId: ctx.event.entityId,
            entity: ctx.entity,
          }),
        });
        record(ctx, 'webhook', params.url);
      } catch (e: any) {
        record(ctx, 'webhook fail', e.message);
      }
      break;
    }

    case 'send_notification': {
      const userId = params.userId || entity?.assignedToId;
      if (!userId) { record(ctx, 'send_notification skip', 'sem userId'); return; }
      await prisma.notification.create({
        data: {
          userId,
          title: interpolate(params.title || 'Notificação automática', ctx),
          body: interpolate(params.body || '', ctx),
          type: 'automation',
          link: params.link || (leadId ? `/leads?leadId=${leadId}` : '/'),
        },
      });
      const io = ctx.io || (global as any).io;
      if (io) io.to(`user:${userId}`).emit('notification:new', { type: 'automation' });
      record(ctx, 'send_notification', userId);
      break;
    }

    case 'remove_tag': {
      if (!params.tagId) { record(ctx, 'remove_tag skip', 'sem tagId'); return; }
      const target = params.entity || (leadId ? 'lead' : 'contact');
      try {
        if (target === 'lead' && leadId) {
          await prisma.tagOnLead.delete({ where: { leadId_tagId: { leadId, tagId: params.tagId } } });
        } else if (target === 'contact' && contactId) {
          await prisma.tagOnContact.delete({ where: { contactId_tagId: { contactId, tagId: params.tagId } } });
        }
        record(ctx, 'remove_tag', `${target}/${params.tagId}`);
      } catch { /* não existia */ }
      break;
    }

    case 'update_lead': {
      if (!leadId) { record(ctx, 'update_lead skip', 'sem lead'); return; }
      const data: any = {};
      if (params.title) data.title = interpolate(params.title, ctx);
      if (params.value !== undefined && params.value !== '') data.value = Number(params.value);
      if (params.source) data.source = interpolate(params.source, ctx);
      if (params.priority) data.priority = params.priority;
      if (params.expectedCloseInDays) data.expectedCloseAt = new Date(Date.now() + Number(params.expectedCloseInDays) * 86400000);
      if (Object.keys(data).length === 0) { record(ctx, 'update_lead skip', 'sem campos'); return; }
      await prisma.lead.update({ where: { id: leadId }, data });
      record(ctx, 'update_lead', Object.keys(data).join(','));
      break;
    }

    case 'update_contact': {
      if (!contactId) { record(ctx, 'update_contact skip', 'sem contacto'); return; }
      const data: any = {};
      if (params.firstName) data.firstName = interpolate(params.firstName, ctx);
      if (params.lastName) data.lastName = interpolate(params.lastName, ctx);
      if (params.email) data.email = interpolate(params.email, ctx);
      if (params.company) data.company = interpolate(params.company, ctx);
      if (params.position) data.position = interpolate(params.position, ctx);
      if (params.country) data.country = interpolate(params.country, ctx);
      if (params.city) data.city = interpolate(params.city, ctx);
      if (Object.keys(data).length === 0) { record(ctx, 'update_contact skip', 'sem campos'); return; }
      await prisma.contact.update({ where: { id: contactId }, data });
      record(ctx, 'update_contact', Object.keys(data).join(','));
      break;
    }

    case 'run_chatbot': {
      if (!params.flowId) { record(ctx, 'run_chatbot skip', 'sem flowId'); return; }
      if (!contactId) { record(ctx, 'run_chatbot skip', 'sem contacto'); return; }
      try {
        const { runChatbotById } = await import('./chatbotEngine');
        await runChatbotById(params.flowId, {
          workspaceId: ctx.workspaceId,
          contactId,
          message: params.message || '',
          dryRun: false,
        });
        record(ctx, 'run_chatbot', params.flowId);
      } catch (e: any) {
        record(ctx, 'run_chatbot fail', e.message);
      }
      break;
    }

    default:
      record(ctx, `acção desconhecida: ${action.type}`);
  }
}

// ── Carregar entidade completa para a regra ───────────
async function loadEntity(event: TriggerEvent): Promise<any | null> {
  if (!event.entityId) return event.payload || null;
  switch (event.entityType) {
    case 'lead':
      return prisma.lead.findUnique({
        where: { id: event.entityId },
        include: {
          stage: true, pipeline: true, contact: true,
          assignedTo: { select: { id: true, name: true } },
          tags: { include: { tag: true } },
        },
      });
    case 'task':
      return prisma.task.findUnique({
        where: { id: event.entityId },
        include: { lead: true, assignedTo: { select: { id: true, name: true } }, tags: { include: { tag: true } } },
      });
    case 'message':
      return prisma.message.findUnique({
        where: { id: event.entityId },
        include: { contact: true, lead: { include: { stage: true, pipeline: true } } },
      });
    case 'contact':
      return prisma.contact.findUnique({
        where: { id: event.entityId },
        include: { tags: { include: { tag: true } } },
      });
    default:
      return event.payload || null;
  }
}

// ── Entry-point: chamar depois de cada evento ─────────
export async function triggerAutomations(event: TriggerEvent): Promise<void> {
  try {
    const automations = await prisma.automation.findMany({
      where: { workspaceId: event.workspaceId, isActive: true },
    });

    if (automations.length === 0) return;

    const matching = automations.filter((a: any) => {
      const trig = a.trigger || {};
      if (trig.type !== event.type) return false;

      // Filtros específicos do trigger
      if (event.type === 'lead_stage_changed' && trig.params?.stageId && event.payload?.newStageId !== trig.params.stageId) return false;
      if (event.type === 'tag_added' && trig.params?.tagId && event.payload?.tagId !== trig.params.tagId) return false;

      return true;
    });

    if (matching.length === 0) return;

    const entity = await loadEntity(event);
    const contactId = entity?.contactId || entity?.contact?.id || (event.entityType === 'contact' ? entity?.id : null) || null;
    const leadId = (event.entityType === 'lead' ? entity?.id : entity?.leadId) || null;

    for (const auto of matching) {
      const baseRunData: any = {
        automationId: auto.id, workspaceId: event.workspaceId,
        triggeredBy: event.type, entityType: event.entityType, entityId: event.entityId,
        contactId, leadId,
      };

      // Active hours
      if (!isWithinActiveHours(auto)) {
        await prisma.automationRun.create({
          data: { ...baseRunData, status: 'SKIPPED',
            log: [{ at: new Date().toISOString(), action: 'skipped', detail: 'fora do horário activo' }] as any },
        });
        continue;
      }

      // Limits
      const limit = await isWithinRunLimits(auto, contactId);
      if (!limit.ok) {
        await prisma.automationRun.create({
          data: { ...baseRunData, status: 'SKIPPED',
            log: [{ at: new Date().toISOString(), action: 'skipped', detail: limit.reason || 'limite atingido' }] as any },
        });
        continue;
      }

      const ctx: RuleContext = { workspaceId: event.workspaceId, event, entity, steps: [] };
      const condRes = evaluateConditions((auto.conditions as any) || [], entity);
      if (!condRes.match) {
        await prisma.automationRun.create({
          data: { ...baseRunData, status: 'SKIPPED',
            log: [{ at: new Date().toISOString(), action: 'skipped', detail: condRes.reason || '' }] as any },
        });
        continue;
      }

      let status = 'OK';
      try {
        const actions = (auto.actions as any) || [];
        for (const action of actions) {
          if (action.delaySeconds && Number(action.delaySeconds) > 0) {
            const ms = Number(action.delaySeconds) * 1000;
            record(ctx, 'delay', `${action.delaySeconds}s antes de ${action.type}`);
            await new Promise((r) => setTimeout(r, Math.min(ms, 60_000))); // cap a 60s para não bloquear webhooks
          }
          await executeAction(action, ctx);
        }
      } catch (e: any) {
        status = 'FAILED';
        record(ctx, 'erro', e.message || String(e));
      }

      await prisma.automation.update({
        where: { id: auto.id },
        data: { runCount: { increment: 1 }, lastRunAt: new Date() },
      });

      await prisma.automationRun.create({
        data: { ...baseRunData, status, log: ctx.steps as any },
      });
    }
  } catch (e) {
    console.error('triggerAutomations error:', e);
  }
}

// ── Cron: triggers de schedule (every_X_minutes/daily_at/weekly_at/monthly_at) ───
// Verifica todas as automações com trigger schedule e dispara as que devem correr neste minuto
export async function processScheduledAutomations(): Promise<number> {
  const now = new Date();
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
  });
  let triggered = 0;

  for (const auto of automations) {
    const trig: any = auto.trigger;
    if (trig?.type !== 'schedule') continue;
    const params = trig.params || {};
    const mode = params.mode || 'every_X_minutes';

    let shouldFire = false;
    const last = auto.lastRunAt ? new Date(auto.lastRunAt) : null;

    if (mode === 'every_X_minutes') {
      const interval = Math.max(1, Number(params.minutes || 60));
      if (!last || (now.getTime() - last.getTime()) >= interval * 60_000 - 30_000) shouldFire = true;
    } else if (mode === 'daily_at') {
      const hour = Number(params.hour ?? 9);
      const minute = Number(params.minute ?? 0);
      if (now.getHours() === hour && now.getMinutes() === minute) {
        if (!last || (now.getTime() - last.getTime()) > 90_000) shouldFire = true;
      }
    } else if (mode === 'weekly_at') {
      const weekday = Number(params.weekday ?? 1); // 1=Seg...7=Dom
      const hour = Number(params.hour ?? 9);
      const minute = Number(params.minute ?? 0);
      const isoDay = now.getDay() === 0 ? 7 : now.getDay();
      if (isoDay === weekday && now.getHours() === hour && now.getMinutes() === minute) {
        if (!last || (now.getTime() - last.getTime()) > 90_000) shouldFire = true;
      }
    } else if (mode === 'monthly_at') {
      const day = Number(params.day ?? 1);
      const hour = Number(params.hour ?? 9);
      const minute = Number(params.minute ?? 0);
      if (now.getDate() === day && now.getHours() === hour && now.getMinutes() === minute) {
        if (!last || (now.getTime() - last.getTime()) > 90_000) shouldFire = true;
      }
    }

    if (shouldFire) {
      await triggerAutomations({
        type: 'schedule', workspaceId: auto.workspaceId, entityType: undefined, entityId: undefined,
      });
      triggered++;
    }
  }
  return triggered;
}

// ── Cron: leads sem resposta ──────────────────────────
// Disparar trigger 'no_response' quando uma conversa fica sem resposta há X horas/minutos
export async function checkNoResponseConversations(): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
  });
  const noRespAutos = automations.filter((a: any) => a.trigger?.type === 'no_response');
  if (noRespAutos.length === 0) return 0;

  let processed = 0;

  for (const auto of noRespAutos) {
    const trig: any = auto.trigger;
    const minutesThreshold = Math.max(1, Number(trig.params?.minutes || 60));
    const cutoff = new Date(Date.now() - minutesThreshold * 60_000);
    // janela: conversa onde a última mensagem é INBOUND e foi há mais que cutoff e há menos que 2x cutoff
    const olderCutoff = new Date(Date.now() - minutesThreshold * 2 * 60_000);

    // Procurar contactos com última mensagem INBOUND nessa janela
    const recentMessages = await prisma.message.findMany({
      where: {
        direction: 'INBOUND',
        contact: { workspaceId: auto.workspaceId },
        createdAt: { lt: cutoff, gte: olderCutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { contact: true },
    });

    const seenContacts = new Set<string>();
    for (const msg of recentMessages) {
      if (!msg.contactId || seenContacts.has(msg.contactId)) continue;
      seenContacts.add(msg.contactId);

      // Verificar que não há mensagem outbound mais recente
      const newer = await prisma.message.findFirst({
        where: { contactId: msg.contactId, createdAt: { gt: msg.createdAt } },
      });
      if (newer && newer.direction === 'OUTBOUND') continue;

      // Verificar se já disparou para este contacto recentemente (1h)
      const alreadyRun = await prisma.automationRun.findFirst({
        where: { automationId: auto.id, contactId: msg.contactId, createdAt: { gt: new Date(Date.now() - 3600_000) } },
      });
      if (alreadyRun) continue;

      await triggerAutomations({
        type: 'no_response', workspaceId: auto.workspaceId,
        entityType: 'message', entityId: msg.id,
      });
      processed++;
    }
  }
  return processed;
}

// ── Cron: leads parados em etapas ─────────────────────
export async function checkStagnantLeads(): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
  });
  const stagAutos = automations.filter((a: any) => a.trigger?.type === 'lead_stagnant');
  if (stagAutos.length === 0) return 0;

  let processed = 0;
  for (const auto of stagAutos) {
    const trig: any = auto.trigger;
    const days = Math.max(1, Number(trig.params?.days || 7));
    const cutoff = new Date(Date.now() - days * 86400000);
    const stageId = trig.params?.stageId || null;

    const where: any = {
      workspaceId: auto.workspaceId,
      status: 'OPEN',
      updatedAt: { lt: cutoff },
    };
    if (stageId) where.stageId = stageId;

    const leads = await prisma.lead.findMany({ where, take: 50 });
    for (const lead of leads) {
      // Verificar se já disparou nas últimas 24h
      const alreadyRun = await prisma.automationRun.findFirst({
        where: { automationId: auto.id, leadId: lead.id, createdAt: { gt: new Date(Date.now() - 86400000) } },
      });
      if (alreadyRun) continue;

      await triggerAutomations({
        type: 'lead_stagnant', workspaceId: auto.workspaceId,
        entityType: 'lead', entityId: lead.id,
      });
      processed++;
    }
  }
  return processed;
}

// ── Cron: tarefas atrasadas ───────────────────────────
// Executado periodicamente para disparar trigger task_overdue
export async function checkOverdueTasks(): Promise<number> {
  const now = new Date();

  // Tarefas que ficaram atrasadas há menos de 5 minutos (para não disparar repetidamente)
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const overdue = await prisma.task.findMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      dueAt: { lt: now, gte: cutoff },
    },
    include: { assignedTo: { select: { workspaceId: true } } },
    take: 50,
  });

  for (const task of overdue) {
    if (!task.assignedTo?.workspaceId) continue;
    await triggerAutomations({
      type: 'task_overdue',
      workspaceId: task.assignedTo.workspaceId,
      entityType: 'task',
      entityId: task.id,
    });
    // Notificação por email opt-in
    try {
      const { notifyTaskOverdue } = await import('./notify');
      await notifyTaskOverdue(task.id);
    } catch (e) { console.error('notifyTaskOverdue error:', e); }
  }
  return overdue.length;
}

// ── Modo teste (dry-run): executar uma automation manualmente ─
export async function testAutomation(automationId: string, sampleEntityId?: string): Promise<{ matched: boolean; reason?: string; steps: any[] }> {
  const auto = await prisma.automation.findUnique({ where: { id: automationId } });
  if (!auto) return { matched: false, reason: 'Automation não encontrada', steps: [] };

  const triggerType = (auto.trigger as any)?.type || '';
  const entityType: any = triggerType.startsWith('lead_') ? 'lead'
    : triggerType.startsWith('task_') ? 'task'
    : triggerType.startsWith('message_') ? 'message'
    : triggerType.startsWith('contact_') ? 'contact'
    : 'lead';

  let entity: any = null;
  if (sampleEntityId) {
    entity = await loadEntity({ type: triggerType, workspaceId: auto.workspaceId, entityType, entityId: sampleEntityId });
  } else {
    // Pega na primeira entity disponível para amostra
    if (entityType === 'lead') {
      entity = await prisma.lead.findFirst({
        where: { workspaceId: auto.workspaceId },
        include: { stage: true, pipeline: true, contact: true, assignedTo: true, tags: { include: { tag: true } } },
      });
    } else if (entityType === 'task') {
      entity = await prisma.task.findFirst({ where: { assignedTo: { workspaceId: auto.workspaceId } }, include: { lead: true, assignedTo: true } });
    } else if (entityType === 'contact') {
      entity = await prisma.contact.findFirst({ where: { workspaceId: auto.workspaceId }, include: { tags: { include: { tag: true } } } });
    }
  }

  if (!entity) return { matched: false, reason: 'Sem entidade de exemplo para testar', steps: [] };

  const condRes = evaluateConditions((auto.conditions as any) || [], entity);
  if (!condRes.match) return { matched: false, reason: condRes.reason, steps: [] };

  // Em modo teste, simula sem executar acções reais
  const steps: any[] = [];
  const actions = (auto.actions as any) || [];
  for (const a of actions) {
    steps.push({
      at: new Date().toISOString(),
      action: `(simulado) ${a.type}`,
      detail: JSON.stringify(a.params || {}).substring(0, 200),
    });
  }
  return { matched: true, steps };
}
