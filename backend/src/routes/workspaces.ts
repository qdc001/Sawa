import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { runDigestForWorkspace, previewDigestForUser, DEFAULT_DIGEST_TEMPLATE, notifyWhatsAppAssignment, testAssignmentNotifyForUser } from '../lib/dailyTaskDigest';

const router = Router();
const prisma = new PrismaClient();

// GET /api/workspaces/me
router.get('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      include: { _count: { select: { users: true, leads: true, contacts: true } } },
    });
    if (!workspace) throw new AppError('Workspace nao encontrada', 404);
    res.json(workspace);
  } catch (e) { next(e); }
});

// PATCH /api/workspaces/me
router.patch('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { name, slug, logo, timezone, currency, primaryColor, dateFormat, fiscalYearStartMonth, autoAssignEnabled, taskTypes, taskPriorities, taskStatuses, taskRecurrences, taskTitles, taskFieldLabels, dailyDigestEnabled, dailyDigestHour, dailyDigestMinute, dailyDigestTemplate, dailyDigestWeekdays, assignmentNotifyEnabled } = req.body;
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

export default router;
