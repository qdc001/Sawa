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

// ── Avaliar condições ─────────────────────────────────
function evaluateConditions(conditions: Condition[] | null | undefined, entity: any): { match: boolean; reason?: string } {
  if (!conditions || conditions.length === 0) return { match: true };

  for (const cond of conditions) {
    const actual = getField(entity, cond.field);
    let ok = false;
    switch (cond.op) {
      case 'equals':
        ok = String(actual) === String(cond.value);
        break;
      case 'not_equals':
        ok = String(actual) !== String(cond.value);
        break;
      case 'contains':
        ok = String(actual ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase());
        break;
      case 'greater_than':
        ok = Number(actual) > Number(cond.value);
        break;
      case 'less_than':
        ok = Number(actual) < Number(cond.value);
        break;
      case 'has_tag': {
        const tags = Array.isArray(entity?.tags) ? entity.tags : [];
        ok = tags.some((t: any) => t?.tag?.id === cond.value || t?.tagId === cond.value || t?.tag?.name === cond.value);
        break;
      }
      case 'is_empty':
        ok = actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0);
        break;
      case 'is_not_empty':
        ok = !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0));
        break;
    }
    if (!ok) return { match: false, reason: `falhou em ${cond.field} ${cond.op} ${cond.value}` };
  }
  return { match: true };
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

    for (const auto of matching) {
      const ctx: RuleContext = { workspaceId: event.workspaceId, event, entity, steps: [] };
      const condRes = evaluateConditions((auto.conditions as any) || [], entity);
      if (!condRes.match) {
        await prisma.automationRun.create({
          data: {
            automationId: auto.id, workspaceId: event.workspaceId,
            triggeredBy: event.type, entityType: event.entityType, entityId: event.entityId,
            status: 'SKIPPED', log: [{ at: new Date().toISOString(), action: 'skipped', detail: condRes.reason || '' }] as any,
          },
        });
        continue;
      }

      let status = 'OK';
      try {
        const actions = (auto.actions as any) || [];
        for (const action of actions) {
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
        data: {
          automationId: auto.id, workspaceId: event.workspaceId,
          triggeredBy: event.type, entityType: event.entityType, entityId: event.entityId,
          status, log: ctx.steps as any,
        },
      });
    }
  } catch (e) {
    console.error('triggerAutomations error:', e);
  }
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
