import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// GET /api/goals?month=&year=&userId=
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: any = { workspaceId: req.user!.workspaceId };
    if (req.query.month) where.month = parseInt(req.query.month as string, 10);
    if (req.query.year) where.year = parseInt(req.query.year as string, 10);
    if (req.query.userId) where.userId = req.query.userId === 'workspace' ? null : (req.query.userId as string);
    const goals = await prisma.goal.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(goals);
  } catch (e) { next(e); }
});

// POST /api/goals
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { type, target, month, year, userId } = req.body;
    if (!type || target === undefined || target === null || !month || !year) {
      throw new AppError('Tipo, alvo, mês e ano são obrigatórios', 400);
    }
    const finalUserId = userId || null;
    // findFirst + create/update porque upsert com userId NULL falha em Postgres
    const existing = await prisma.goal.findFirst({
      where: {
        workspaceId: req.user!.workspaceId,
        type, month: Number(month), year: Number(year),
        userId: finalUserId,
      },
    });
    if (existing) {
      const goal = await prisma.goal.update({
        where: { id: existing.id },
        data: { target: Number(target) },
      });
      return res.status(200).json(goal);
    }
    const goal = await prisma.goal.create({
      data: {
        type, target: Number(target),
        month: Number(month), year: Number(year),
        workspaceId: req.user!.workspaceId,
        userId: finalUserId,
      },
    });
    res.status(201).json(goal);
  } catch (e: any) {
    console.error('POST /goals error:', e);
    next(e);
  }
});

// PATCH /api/goals/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const goal = await prisma.goal.update({
      where: { id: req.params.id },
      data: { target: Number(req.body.target) },
    });
    res.json(goal);
  } catch (e) { next(e); }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.goal.delete({ where: { id: req.params.id } });
    res.json({ message: 'Meta eliminada' });
  } catch (e) { next(e); }
});

// GET /api/goals/progress?month=&year=&userId=
router.get('/progress', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1), 10);
    const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);
    const userId = req.query.userId && req.query.userId !== 'workspace' ? (req.query.userId as string) : null;

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const goalWhere: any = { workspaceId, month, year, userId };
    const goals = await prisma.goal.findMany({ where: goalWhere });

    const baseLead: any = { workspaceId };
    if (userId) baseLead.assignedToId = userId;

    const [leadsCreated, leadsWon, revenue, tasksCompleted] = await Promise.all([
      prisma.lead.count({ where: { ...baseLead, createdAt: { gte: start, lte: end } } }),
      prisma.lead.count({ where: { ...baseLead, status: 'WON', closedAt: { gte: start, lte: end } } }),
      prisma.lead.aggregate({ where: { ...baseLead, status: 'WON', closedAt: { gte: start, lte: end } }, _sum: { value: true } }),
      prisma.task.count({
        where: {
          assignedTo: { workspaceId, ...(userId && { id: userId }) },
          status: 'COMPLETED',
          completedAt: { gte: start, lte: end },
        },
      }),
    ]);

    const currentMap: Record<string, number> = {
      leads_created: leadsCreated,
      leads_won: leadsWon,
      revenue: revenue._sum.value || 0,
      tasks_completed: tasksCompleted,
    };

    const result = goals.map((g) => ({
      ...g,
      current: currentMap[g.type] || 0,
      percent: g.target > 0 ? Math.min(100, Math.round(((currentMap[g.type] || 0) / g.target) * 100)) : 0,
    }));

    res.json(result);
  } catch (e) { next(e); }
});

export default router;
