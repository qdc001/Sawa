import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

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
    const { name, slug, logo, timezone, currency, primaryColor, dateFormat, fiscalYearStartMonth } = req.body;
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

export default router;
