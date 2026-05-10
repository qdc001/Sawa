import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// GET /api/analytics/dashboard
router.get('/dashboard', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalLeads,
      openLeads,
      wonLeads,
      lostLeads,
      totalContacts,
      monthLeads,
      lastMonthLeads,
      wonThisMonth,
      wonLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      tasksDue,
      leadsPerStage,
      recentActivities,
    ] = await Promise.all([
      prisma.lead.count({ where: { workspaceId } }),
      prisma.lead.count({ where: { workspaceId, status: 'OPEN' } }),
      prisma.lead.count({ where: { workspaceId, status: 'WON' } }),
      prisma.lead.count({ where: { workspaceId, status: 'LOST' } }),
      prisma.contact.count({ where: { workspaceId } }),
      prisma.lead.count({ where: { workspaceId, createdAt: { gte: startOfMonth } } }),
      prisma.lead.count({ where: { workspaceId, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),
      prisma.lead.count({ where: { workspaceId, status: 'WON', closedAt: { gte: startOfMonth } } }),
      prisma.lead.count({ where: { workspaceId, status: 'WON', closedAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),
      prisma.lead.aggregate({ where: { workspaceId, status: 'WON', closedAt: { gte: startOfMonth } }, _sum: { value: true } }),
      prisma.lead.aggregate({ where: { workspaceId, status: 'WON', closedAt: { gte: startOfLastMonth, lte: endOfLastMonth } }, _sum: { value: true } }),
      prisma.task.count({ where: { assignedTo: { workspaceId }, status: 'PENDING', dueAt: { lte: new Date() } } }),
      prisma.stage.findMany({
        where: { pipeline: { workspaceId } },
        include: { _count: { select: { leads: { where: { status: 'OPEN' } } } } },
        orderBy: { position: 'asc' },
      }),
      prisma.activity.findMany({
        where: { lead: { workspaceId } },
        include: { user: { select: { id: true, name: true, avatar: true } }, lead: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

    res.json({
      overview: {
        totalLeads,
        openLeads,
        wonLeads,
        lostLeads,
        totalContacts,
        conversionRate,
        tasksDue,
      },
      monthly: {
        leadsCreated: monthLeads,
        leadsCreatedGrowth: lastMonthLeads > 0 ? Math.round(((monthLeads - lastMonthLeads) / lastMonthLeads) * 100) : 0,
        leadsWon: wonThisMonth,
        leadsWonGrowth: wonLastMonth > 0 ? Math.round(((wonThisMonth - wonLastMonth) / wonLastMonth) * 100) : 0,
        revenue: revenueThisMonth._sum.value || 0,
        revenueGrowth: (revenueLastMonth._sum.value || 0) > 0
          ? Math.round((((revenueThisMonth._sum.value || 0) - (revenueLastMonth._sum.value || 0)) / (revenueLastMonth._sum.value || 0)) * 100)
          : 0,
      },
      pipeline: leadsPerStage.map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        count: s._count.leads,
      })),
      recentActivities,
    });
  } catch (error) { next(error); }
});

// GET /api/analytics/upcoming-tasks - proximas tarefas pendentes
router.get('/upcoming-tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        assignedTo: { workspaceId: req.user!.workspaceId },
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        lead: { select: { id: true, title: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 6,
    });
    res.json(tasks);
  } catch (e) { next(e); }
});

// GET /api/analytics/top-leads - leads abertos com maior valor
router.get('/top-leads', async (req: AuthRequest, res: Response, next) => {
  try {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: req.user!.workspaceId, status: 'OPEN', value: { not: null } },
      include: {
        stage: true,
        pipeline: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: { value: 'desc' },
      take: 5,
    });
    res.json(leads);
  } catch (e) { next(e); }
});

// GET /api/analytics/revenue
router.get('/revenue', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const months = 6;
    const data = [];

    for (let i = months - 1; i >= 0; i--) {
      const date = new Date();
      const start = new Date(date.getFullYear(), date.getMonth() - i, 1);
      const end = new Date(date.getFullYear(), date.getMonth() - i + 1, 0);

      const result = await prisma.lead.aggregate({
        where: { workspaceId, status: 'WON', closedAt: { gte: start, lte: end } },
        _sum: { value: true },
        _count: true,
      });

      data.push({
        month: start.toLocaleString('pt', { month: 'short' }),
        revenue: result._sum.value || 0,
        deals: result._count,
      });
    }

    res.json(data);
  } catch (error) { next(error); }
});

export default router;
