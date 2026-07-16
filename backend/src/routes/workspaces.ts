import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { runDigestForWorkspace, previewDigestForUser, DEFAULT_DIGEST_TEMPLATE, notifyWhatsAppAssignment, testAssignmentNotifyForUser } from '../lib/dailyTaskDigest';
import { PRESETS } from '../lib/workspacePresets';

import prisma from '../lib/prisma';
const router = Router();

// GET /api/workspaces/me
router.get('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      include: { _count: { select: { users: true, leads: true, contacts: true } } },
    });
    if (!workspace) throw new AppError('Workspace não encontrada', 404);
    res.json(workspace);
  } catch (e) { next(e); }
});

// PATCH /api/workspaces/me
router.patch('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { name, slug, logo, timezone, currency, primaryColor, dateFormat, fiscalYearStartMonth, autoAssignEnabled, taskTypes, taskPriorities, taskStatuses, taskRecurrences, taskTitles, taskFieldLabels, dailyDigestEnabled, dailyDigestHour, dailyDigestMinute, dailyDigestTemplate, dailyDigestWeekdays, assignmentNotifyEnabled, aiBrandVoice, contactLabelSingular, contactLabelPlural, appointmentLabelSingular, appointmentLabelPlural, appointmentTypes, appointmentReminderEnabled, appointmentReminderHours, appointmentReminderTemplate, reactivationEnabled, reactivationDaysThreshold, birthdayGreetingEnabled, birthdayGreetingHour, birthdayGreetingTemplate, postConsultFollowupEnabled, postConsultFollowupDays, postConsultFollowupTemplate } = req.body;
    const workspace = await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data: {
        ...(name && { name }),
        ...(slug && { slug }),
        ...(logo !== undefined && { logo }),
        ...(timezone && { timezone }),
        ...(currency && { currency }),
        ...(primaryColor && { primaryColor }),
        ...(dateFormat && { dateFormat }),
        ...(fiscalYearStartMonth !== undefined && { fiscalYearStartMonth: Number(fiscalYearStartMonth) }),
        ...(autoAssignEnabled !== undefined && { autoAssignEnabled: !!autoAssignEnabled }),
        ...(taskTypes !== undefined && { taskTypes }),
        ...(taskPriorities !== undefined && { taskPriorities }),
        ...(taskStatuses !== undefined && { taskStatuses }),
        ...(taskRecurrences !== undefined && { taskRecurrences }),
        ...(taskTitles !== undefined && { taskTitles }),
        ...(taskFieldLabels !== undefined && { taskFieldLabels }),
        ...(dailyDigestEnabled !== undefined && { dailyDigestEnabled: !!dailyDigestEnabled }),
        ...(dailyDigestHour !== undefined && { dailyDigestHour: Math.max(0, Math.min(23, Number(dailyDigestHour) || 0)) }),
        ...(dailyDigestMinute !== undefined && { dailyDigestMinute: Math.max(0, Math.min(59, Number(dailyDigestMinute) || 0)) }),
        ...(dailyDigestTemplate !== undefined && { dailyDigestTemplate }),
        ...(dailyDigestWeekdays !== undefined && { dailyDigestWeekdays }),
        ...(assignmentNotifyEnabled !== undefined && { assignmentNotifyEnabled: !!assignmentNotifyEnabled }),
        ...(aiBrandVoice !== undefined && { aiBrandVoice: aiBrandVoice || null }),
        ...(contactLabelSingular !== undefined && { contactLabelSingular: String(contactLabelSingular).trim() || 'Contacto' }),
        ...(contactLabelPlural !== undefined && { contactLabelPlural: String(contactLabelPlural).trim() || 'Contactos' }),
        ...(appointmentLabelSingular !== undefined && { appointmentLabelSingular: String(appointmentLabelSingular).trim() || 'Marcação' }),
        ...(appointmentLabelPlural !== undefined && { appointmentLabelPlural: String(appointmentLabelPlural).trim() || 'Marcações' }),
        ...(appointmentTypes !== undefined && { appointmentTypes }),
        ...(appointmentReminderEnabled !== undefined && { appointmentReminderEnabled: !!appointmentReminderEnabled }),
        ...(appointmentReminderHours !== undefined && { appointmentReminderHours: Math.max(1, Math.min(168, Number(appointmentReminderHours) || 24)) }),
        ...(appointmentReminderTemplate !== undefined && { appointmentReminderTemplate: appointmentReminderTemplate || null }),
        ...(reactivationEnabled !== undefined && { reactivationEnabled: !!reactivationEnabled }),
        ...(reactivationDaysThreshold !== undefined && { reactivationDaysThreshold: Math.max(30, Math.min(730, Number(reactivationDaysThreshold) || 180)) }),
        ...(birthdayGreetingEnabled !== undefined && { birthdayGreetingEnabled: !!birthdayGreetingEnabled }),
        ...(birthdayGreetingHour !== undefined && { birthdayGreetingHour: Math.max(0, Math.min(23, Number(birthdayGreetingHour) || 9)) }),
        ...(birthdayGreetingTemplate !== undefined && { birthdayGreetingTemplate: birthdayGreetingTemplate || null }),
        ...(postConsultFollowupEnabled !== undefined && { postConsultFollowupEnabled: !!postConsultFollowupEnabled }),
        ...(postConsultFollowupDays !== undefined && { postConsultFollowupDays: Math.max(1, Math.min(30, Number(postConsultFollowupDays) || 3)) }),
        ...(postConsultFollowupTemplate !== undefined && { postConsultFollowupTemplate: postConsultFollowupTemplate || null }),
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId: req.user!.workspaceId,
        userId: req.user!.id,
        action: 'UPDATE', entity: 'workspace',
        description: `Workspace actualizada por ${req.user!.email}`,
      },
    });

    // Notificar todos os membros via socket para que vejam as alterações sem precisar
    // de fazer logout/login. Cada cliente actualiza o store local.
    const io = (global as any).io;
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('workspace:updated', workspace);

    res.json(workspace);
  } catch (e) { next(e); }
});

// POST /api/workspaces/me/apply-preset
// Body: { preset: 'clinic' }
// Aplica um preset vertical completo ao workspace: terminologia, sector,
// persona IA, tipos de tarefa, config de auto-tarefa, tipos de consulta,
// templates de mensagem e campos personalizados de Contact.
// Non-destrutivo para templates/customFields: skip se ja existir com o
// mesmo nome/key. Sobrescreve terminologia e configs porque essas sao
// escalares unicas.
router.post('/me/apply-preset', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN pode aplicar presets', 403);
    }
    const { preset: presetKey } = req.body || {};
    const preset = PRESETS[presetKey];
    if (!preset) throw new AppError('Preset invalido', 400);

    const workspaceId = req.user!.workspaceId;

    // 1. Actualizar campos escalares do workspace
    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        contactLabelSingular: preset.contactLabelSingular,
        contactLabelPlural: preset.contactLabelPlural,
        appointmentLabelSingular: preset.appointmentLabelSingular,
        appointmentLabelPlural: preset.appointmentLabelPlural,
        appointmentTypes: preset.appointmentTypes as any,
        sector: preset.sector,
        aiAgentName: preset.aiAgentName,
        aiAgentRole: preset.aiAgentRole,
        aiAgentInstructions: preset.aiAgentInstructions,
        aiBrandVoice: preset.aiBrandVoice,
        taskTypes: preset.taskTypes as any,
        autoTaskConfig: {
          workTypes: preset.autoTaskWorkTypes,
          subjects: preset.autoTaskSubjects,
          announceTemplate: preset.autoTaskAnnounceTemplate,
          deliverTemplate: preset.autoTaskDeliverTemplate,
          announceTaskTitleTemplate: preset.autoTaskAnnounceTaskTitleTemplate,
          followupTitleTemplate: preset.autoTaskFollowupTitleTemplate,
          followupDays: 3,
        } as any,
      },
    });

    // 2. Criar templates de mensagem (skip se ja existir com o mesmo nome)
    let templatesCreated = 0;
    for (const tpl of preset.messageTemplates) {
      const existing = await prisma.messageTemplate.findFirst({
        where: { workspaceId, name: tpl.name },
      });
      if (existing) continue;
      // Extrair variaveis {xxx} do content
      const variables = Array.from(new Set((tpl.content.match(/\{(\w+)\}/g) || []).map((v) => v.slice(1, -1))));
      await prisma.messageTemplate.create({
        data: {
          workspaceId,
          name: tpl.name,
          content: tpl.content,
          category: tpl.category as any,
          channel: tpl.channel as any,
          variables,
        },
      });
      templatesCreated++;
    }

    // 3. Criar campos personalizados de Contact (skip se ja existir com o mesmo key)
    let customFieldsCreated = 0;
    for (const cf of preset.customFields) {
      const existing = await prisma.customField.findFirst({
        where: { workspaceId, entity: cf.entity, key: cf.key },
      });
      if (existing) continue;
      await prisma.customField.create({
        data: {
          workspaceId,
          entity: cf.entity,
          name: cf.name,
          key: cf.key,
          type: cf.type as any,
          options: cf.options || [],
          position: cf.position,
        },
      });
      customFieldsCreated++;
    }

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: req.user!.id,
        action: 'UPDATE',
        entity: 'workspace',
        description: `Preset '${preset.label}' aplicado por ${req.user!.email}. Templates novos: ${templatesCreated}, campos personalizados novos: ${customFieldsCreated}.`,
      },
    });

    const io = (global as any).io;
    if (io) io.to(`workspace:${workspaceId}`).emit('workspace:updated', workspace);

    res.json({
      workspace,
      templatesCreated,
      customFieldsCreated,
      preset: preset.label,
    });
  } catch (e) { next(e); }
});

// GET /api/workspaces/audit-logs
router.get('/audit-logs', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const limit = parseInt((req.query.limit as string) || '100', 10);
    const logs = await prisma.auditLog.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // anexar info do user
    const userIds = Array.from(new Set(logs.map((l) => l.userId).filter(Boolean) as string[]));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userMap: Record<string, string> = {};
    users.forEach((u) => { userMap[u.id] = u.name; });
    res.json(logs.map((l) => ({ ...l, userName: l.userId ? userMap[l.userId] || null : null })));
  } catch (e) { next(e); }
});

// GET /api/workspaces/export - exportar tudo da workspace em JSON
router.get('/export', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const wsId = req.user!.workspaceId;
    const [workspace, users, pipelines, stages, leads, contacts, tasks, messages, tags, customFields, goals, teams] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: wsId } }),
      prisma.user.findMany({ where: { workspaceId: wsId }, select: { id: true, name: true, email: true, role: true, isActive: true, status: true, teamId: true } }),
      prisma.pipeline.findMany({ where: { workspaceId: wsId } }),
      prisma.stage.findMany({ where: { pipeline: { workspaceId: wsId } } }),
      prisma.lead.findMany({ where: { workspaceId: wsId } }),
      prisma.contact.findMany({ where: { workspaceId: wsId } }),
      prisma.task.findMany({ where: { assignedTo: { workspaceId: wsId } } }),
      prisma.message.findMany({ where: { OR: [{ contact: { workspaceId: wsId } }, { lead: { workspaceId: wsId } }] }, take: 5000 }),
      prisma.tag.findMany({ where: { workspaceId: wsId } }),
      prisma.customField.findMany({ where: { workspaceId: wsId } }),
      prisma.goal.findMany({ where: { workspaceId: wsId } }),
      prisma.team.findMany({ where: { workspaceId: wsId } }),
    ]);
    res.json({
      exportedAt: new Date().toISOString(),
      workspace, users, pipelines, stages, leads, contacts, tasks, messages, tags, customFields, goals, teams,
    });
  } catch (e) { next(e); }
});

// POST /api/workspaces/me/daily-digest/test
// Dispara o digest diário manualmente para o workspace actual (para teste).
router.post('/me/daily-digest/test', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const result = await runDigestForWorkspace(req.user!.workspaceId);
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/workspaces/me/daily-digest/preview
// Gera o texto da mensagem (sem enviar) para mostrar na UI das Definições.
// Body opcional: { template: { header, ... } } — usa esse template em vez do guardado.
router.post('/me/daily-digest/preview', async (req: AuthRequest, res: Response, next) => {
  try {
    const message = await previewDigestForUser(req.user!.workspaceId, req.user!.id, req.body?.template);
    res.json({ message });
  } catch (e) { next(e); }
});

// GET /api/workspaces/me/daily-digest/defaults
// Devolve o template default (para o botão "Repor padrão").
router.get('/me/daily-digest/defaults', async (_req: AuthRequest, res: Response) => {
  res.json({ template: DEFAULT_DIGEST_TEMPLATE });
});

// POST /api/workspaces/me/assignment-notify/test
// Envia uma notificação de atribuição de exemplo ao utilizador autenticado.
router.post('/me/assignment-notify/test', async (req: AuthRequest, res: Response, next) => {
  try {
    const result = await testAssignmentNotifyForUser(req.user!.workspaceId, req.user!.id);
    if (!result.ok) return res.status(400).json({ message: result.reason });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/workspaces/reset/messages
// Apaga TODAS as conversas e mensagens do workspace (mantém leads, contactos e tudo o resto).
// OWNER/ADMIN. Exige { confirm: true } no body para evitar chamadas acidentais.
router.post('/reset/messages', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    if (req.body?.confirm !== true) {
      throw new AppError('Confirmação em falta', 400);
    }
    const wsId = req.user!.workspaceId;
    const msgWhere = { OR: [{ contact: { workspaceId: wsId } }, { lead: { workspaceId: wsId } }] };
    const deleted = await prisma.$transaction(async (tx) => {
      // Limpa as auto-referências (replyTo) antes de eliminar em massa.
      await tx.message.updateMany({ where: msgWhere, data: { replyToId: null } });
      const del = await tx.message.deleteMany({ where: msgWhere });
      await tx.conversationMeta.deleteMany({ where: { workspaceId: wsId } });
      return del.count;
    }, { timeout: 60000 });

    await prisma.auditLog.create({
      data: {
        workspaceId: wsId, userId: req.user!.id,
        action: 'DELETE', entity: 'message',
        description: `Reset de conversas e mensagens (${deleted}) por ${req.user!.email}`,
      },
    });
    const io = (global as any).io;
    if (io) io.to(`workspace:${wsId}`).emit('workspace:reset', { scope: 'messages' });
    res.json({ messages: deleted });
  } catch (e) { next(e); }
});

// POST /api/workspaces/reset/data
// Repoe TODOS os dados operacionais do workspace (mensagens, conversas, leads, contactos,
// tarefas, propostas, broadcasts, metas, CSAT, notas, ficheiros, actividades e históricos
// de automação/chatbot). Preserva conta/equipa, integrações, definições e a estrutura
// (pipelines, etapas, tags, campos personalizados, produtos, automações e chatbots).
// Apenas OWNER. Exige { confirmation: <nome exacto do workspace> }.
router.post('/reset/data', async (req: AuthRequest, res: Response, next) => {
  try {
    if (req.user!.role !== 'OWNER') {
      throw new AppError('Apenas o OWNER pode repor todos os dados', 403);
    }
    const wsId = req.user!.workspaceId;
    const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { name: true } });
    if (!ws) throw new AppError('Workspace não encontrada', 404);
    if (String(req.body?.confirmation || '').trim() !== ws.name) {
      throw new AppError('Confirmação invalida: escreve o nome exacto do workspace', 400);
    }

    const counts: Record<string, number> = {};
    await prisma.$transaction(async (tx) => {
      const msgWhere = { OR: [{ contact: { workspaceId: wsId } }, { lead: { workspaceId: wsId } }] };
      await tx.message.updateMany({ where: msgWhere, data: { replyToId: null } });
      counts.messages = (await tx.message.deleteMany({ where: msgWhere })).count;
      counts.conversations = (await tx.conversationMeta.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.csat = (await tx.csatRequest.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.quotes = (await tx.quote.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.broadcasts = (await tx.broadcast.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.automationRuns = (await tx.automationRun.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.chatbotSessions = (await tx.chatbotSession.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.goals = (await tx.goal.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.notifications = (await tx.notification.deleteMany({ where: { user: { workspaceId: wsId } } })).count;
      counts.files = (await tx.file.deleteMany({ where: { lead: { workspaceId: wsId } } })).count;
      counts.notes = (await tx.note.deleteMany({ where: { lead: { workspaceId: wsId } } })).count;
      counts.activities = (await tx.activity.deleteMany({ where: { OR: [{ lead: { workspaceId: wsId } }, { user: { workspaceId: wsId } }] } })).count;
      counts.tasks = (await tx.task.deleteMany({ where: { assignedTo: { workspaceId: wsId } } })).count;
      counts.leads = (await tx.lead.deleteMany({ where: { workspaceId: wsId } })).count;
      counts.contacts = (await tx.contact.deleteMany({ where: { workspaceId: wsId } })).count;
    }, { timeout: 60000 });

    await prisma.auditLog.create({
      data: {
        workspaceId: wsId, userId: req.user!.id,
        action: 'DELETE', entity: 'workspace',
        description: `Reset total dos dados por ${req.user!.email}`,
        metadata: counts as any,
      },
    });
    const io = (global as any).io;
    if (io) io.to(`workspace:${wsId}`).emit('workspace:reset', { scope: 'data' });
    res.json({ ok: true, counts });
  } catch (e) { next(e); }
});

export default router;
