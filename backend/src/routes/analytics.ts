import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';

import prisma from '../lib/prisma';
const router = Router();

// Helpers para parsear filtros comuns
function getDateRange(req: AuthRequest): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const now = new Date();
  let from: Date;
  let to: Date = now;

  if (req.query.from && req.query.to) {
    from = new Date(req.query.from as string);
    to = new Date(req.query.to as string);
  } else if (req.query.period) {
    const p = req.query.period as string;
    if (p === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (p === '7d') {
      from = new Date(now); from.setDate(from.getDate() - 7);
    } else if (p === '30d') {
      from = new Date(now); from.setDate(from.getDate() - 30);
    } else if (p === '3m') {
      from = new Date(now); from.setMonth(from.getMonth() - 3);
    } else if (p === '6m') {
      from = new Date(now); from.setMonth(from.getMonth() - 6);
    } else if (p === '1y') {
      from = new Date(now); from.setFullYear(from.getFullYear() - 1);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const dur = to.getTime() - from.getTime();
  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - dur);

  return { from, to, prevFrom, prevTo };
}

function getFilters(req: AuthRequest): { pipelineId?: string; assignedToId?: string } {
  return {
    pipelineId: (req.query.pipelineId as string) || undefined,
    assignedToId: (req.query.assignedToId as string) || undefined,
  };
}

function buildLeadWhere(workspaceId: string, filters: any, dateField: string, from?: Date, to?: Date) {
  const where: any = { workspaceId };
  if (filters.pipelineId) where.pipelineId = filters.pipelineId;
  if (filters.assignedToId) where.assignedToId = filters.assignedToId;
  if (from && to) where[dateField] = { gte: from, lte: to };
  return where;
}

// GET /api/analytics/dashboard
router.get('/dashboard', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { from, to, prevFrom, prevTo } = getDateRange(req);
    const filters = getFilters(req);

    const baseWhere: any = { workspaceId };
    if (filters.pipelineId) baseWhere.pipelineId = filters.pipelineId;
    if (filters.assignedToId) baseWhere.assignedToId = filters.assignedToId;

    const [
      totalLeads, openLeads, wonLeads, lostLeads, totalContacts,
      periodLeadsCreated, prevLeadsCreated,
      periodWon, prevWon,
      periodRevenue, prevRevenue,
      tasksDue,
      leadsPerStage,
      recentActivities,
    ] = await Promise.all([
      prisma.lead.count({ where: baseWhere }),
      prisma.lead.count({ where: { ...baseWhere, status: 'OPEN' } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'WON' } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'LOST' } }),
      prisma.contact.count({ where: { workspaceId } }),
      prisma.lead.count({ where: { ...baseWhere, createdAt: { gte: from, lte: to } } }),
      prisma.lead.count({ where: { ...baseWhere, createdAt: { gte: prevFrom, lte: prevTo } } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'WON', closedAt: { gte: from, lte: to } } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'WON', closedAt: { gte: prevFrom, lte: prevTo } } }),
      prisma.lead.aggregate({ where: { ...baseWhere, status: 'WON', closedAt: { gte: from, lte: to } }, _sum: { value: true } }),
      prisma.lead.aggregate({ where: { ...baseWhere, status: 'WON', closedAt: { gte: prevFrom, lte: prevTo } }, _sum: { value: true } }),
      prisma.task.count({
        where: {
          assignedTo: { workspaceId, ...(filters.assignedToId && { id: filters.assignedToId }) },
          status: 'PENDING', dueAt: { lte: new Date() },
        },
      }),
      prisma.stage.findMany({
        where: {
          pipeline: { workspaceId, ...(filters.pipelineId && { id: filters.pipelineId }) },
        },
        // Conta TODOS os leads de cada etapa (nao so os OPEN), para a distribuicao
        // bater com o Pipeline: as etapas Ganho/Perdido tem leads WON/LOST e antes
        // apareciam a zero nas Analises.
        include: { _count: { select: { leads: true } } },
        orderBy: { position: 'asc' },
      }),
      prisma.activity.findMany({
        where: { lead: { workspaceId } },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          lead: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;
    const growth = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
    const rev = periodRevenue._sum.value || 0;
    const prevRev = prevRevenue._sum.value || 0;

    res.json({
      overview: {
        totalLeads, openLeads, wonLeads, lostLeads, totalContacts, conversionRate, tasksDue,
      },
      monthly: {
        leadsCreated: periodLeadsCreated,
        leadsCreatedGrowth: growth(periodLeadsCreated, prevLeadsCreated),
        leadsWon: periodWon,
        leadsWonGrowth: growth(periodWon, prevWon),
        revenue: rev,
        revenueGrowth: growth(rev, prevRev),
      },
      pipeline: leadsPerStage.map((s: any) => ({
        id: s.id, name: s.name, color: s.color, position: s.position, type: s.type,
        count: s._count.leads,
      })),
      recentActivities,
    });
  } catch (error) { next(error); }
});

// GET /api/analytics/revenue
// Responde ao filtro de periodo: dias para periodos curtos (today/7d/30d) e meses
// para os longos (3m/6m/1y); aceita tambem from/to (intervalo personalizado) e o
// legado `months`. Faz 1 query e agrupa por bucket no codigo (eficiente).
router.get('/revenue', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const filters = getFilters(req);
    const now = new Date();
    const period = (req.query.period as string) || '';

    type Bucket = { label: string; start: Date; end: Date };
    const buckets: Bucket[] = [];
    const dayLabel = (d: Date) => d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
    const monthLabel = (d: Date) => d.toLocaleString('pt-PT', { month: 'short' });
    const pushDays = (from: Date, n: number) => {
      for (let i = 0; i < n; i++) {
        const start = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
        const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i + 1);
        buckets.push({ label: dayLabel(start), start, end });
      }
    };
    const pushMonths = (n: number) => {
      for (let i = n - 1; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({ label: monthLabel(start), start, end });
      }
    };

    if (req.query.from && req.query.to) {
      const f = new Date(req.query.from as string);
      const t = new Date(req.query.to as string);
      const from = new Date(f.getFullYear(), f.getMonth(), f.getDate());
      const to = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      const diffDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      if (diffDays <= 62) {
        pushDays(from, diffDays);
      } else {
        let cur = new Date(from.getFullYear(), from.getMonth(), 1);
        const last = new Date(to.getFullYear(), to.getMonth(), 1);
        while (cur <= last) {
          const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
          buckets.push({ label: monthLabel(cur), start: new Date(cur), end });
          cur = end;
        }
      }
    } else if (period === 'today') {
      pushDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
    } else if (period === '7d') {
      pushDays(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), 7);
    } else if (period === '30d') {
      pushDays(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29), 30);
    } else if (period === '3m') {
      pushMonths(3);
    } else if (period === '6m') {
      pushMonths(6);
    } else if (period === '1y') {
      pushMonths(12);
    } else {
      pushMonths(parseInt((req.query.months as string) || '6', 10));
    }

    if (buckets.length === 0) { res.json([]); return; }

    const where: any = {
      workspaceId, status: 'WON',
      closedAt: { gte: buckets[0].start, lt: buckets[buckets.length - 1].end },
    };
    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    const won = await prisma.lead.findMany({ where, select: { value: true, closedAt: true } });

    const data = buckets.map((b) => {
      const inBucket = won.filter((l) => l.closedAt && l.closedAt >= b.start && l.closedAt < b.end);
      return {
        month: b.label,
        revenue: inBucket.reduce((s, l) => s + (l.value || 0), 0),
        deals: inBucket.length,
      };
    });
    res.json(data);
  } catch (error) { next(error); }
});

// GET /api/analytics/upcoming-tasks
router.get('/upcoming-tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const filters = getFilters(req);
    const tasks = await prisma.task.findMany({
      where: {
        assignedTo: {
          workspaceId: req.user!.workspaceId,
          ...(filters.assignedToId && { id: filters.assignedToId }),
        },
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

// GET /api/analytics/top-leads
router.get('/top-leads', async (req: AuthRequest, res: Response, next) => {
  try {
    const filters = getFilters(req);
    const where: any = { workspaceId: req.user!.workspaceId, status: 'OPEN', value: { not: null } };
    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;

    const leads = await prisma.lead.findMany({
      where,
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

// GET /api/analytics/team-performance
router.get('/team-performance', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { from, to } = getDateRange(req);
    const filters = getFilters(req);

    const users = await prisma.user.findMany({
      where: { workspaceId },
      select: { id: true, name: true, avatar: true },
    });

    const stats = await Promise.all(users.map(async (u) => {
      const leadWhere: any = { workspaceId, assignedToId: u.id };
      if (filters.pipelineId) leadWhere.pipelineId = filters.pipelineId;

      const [created, won, lost, revenue, openCount, openValue, tasksOpen] = await Promise.all([
        prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: from, lte: to } } }),
        prisma.lead.count({ where: { ...leadWhere, status: 'WON', closedAt: { gte: from, lte: to } } }),
        prisma.lead.count({ where: { ...leadWhere, status: 'LOST', closedAt: { gte: from, lte: to } } }),
        prisma.lead.aggregate({ where: { ...leadWhere, status: 'WON', closedAt: { gte: from, lte: to } }, _sum: { value: true } }),
        prisma.lead.count({ where: { ...leadWhere, status: 'OPEN' } }),
        prisma.lead.aggregate({ where: { ...leadWhere, status: 'OPEN' }, _sum: { value: true } }),
        prisma.task.count({ where: { assignedToId: u.id, status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
      ]);

      const totalClosed = won + lost;
      const winRate = totalClosed > 0 ? Math.round((won / totalClosed) * 100) : 0;
      return {
        id: u.id, name: u.name, avatar: u.avatar,
        created, won, lost, winRate,
        revenue: revenue._sum.value || 0,
        openCount, openValue: openValue._sum.value || 0,
        tasksOpen,
      };
    }));

    stats.sort((a, b) => b.revenue - a.revenue);
    res.json(stats);
  } catch (e) { next(e); }
});

// GET /api/analytics/lead-sources
router.get('/lead-sources', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { from, to } = getDateRange(req);
    const filters = getFilters(req);

    const where: any = { workspaceId, createdAt: { gte: from, lte: to } };
    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;

    const grouped = await prisma.lead.groupBy({
      by: ['source'],
      where,
      _count: true,
      _sum: { value: true },
    });

    const wonGrouped = await prisma.lead.groupBy({
      by: ['source'],
      where: { ...where, status: 'WON' },
      _count: true,
    });
    const wonMap: Record<string, number> = {};
    wonGrouped.forEach((g) => { wonMap[g.source || '__null__'] = g._count; });

    const result = grouped.map((g) => {
      const total = g._count;
      const won = wonMap[g.source || '__null__'] || 0;
      return {
        source: g.source || 'Sem origem',
        total,
        won,
        revenue: g._sum.value || 0,
        winRate: total > 0 ? Math.round((won / total) * 100) : 0,
      };
    }).sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/analytics/conversion-stats
router.get('/conversion-stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { from, to } = getDateRange(req);
    const filters = getFilters(req);

    const baseWhere: any = { workspaceId };
    if (filters.pipelineId) baseWhere.pipelineId = filters.pipelineId;
    if (filters.assignedToId) baseWhere.assignedToId = filters.assignedToId;

    // Tempo medio de conversao
    const wonLeads = await prisma.lead.findMany({
      where: { ...baseWhere, status: 'WON', closedAt: { not: null, gte: from, lte: to } },
      select: { createdAt: true, closedAt: true },
    });
    const days = wonLeads
      .map((l) => l.closedAt ? (new Date(l.closedAt).getTime() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 0)
      .filter((x) => x > 0);
    const avgConversionDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;

    // Forecast (soma de leads abertos com valor)
    const openAgg = await prisma.lead.aggregate({
      where: { ...baseWhere, status: 'OPEN', value: { not: null } },
      _sum: { value: true },
      _count: true,
    });
    // Win rate global
    const [allWon, allClosed] = await Promise.all([
      prisma.lead.count({ where: { ...baseWhere, status: 'WON' } }),
      prisma.lead.count({ where: { ...baseWhere, status: { in: ['WON', 'LOST'] } } }),
    ]);
    const winRateGlobal = allClosed > 0 ? allWon / allClosed : 0.3;
    const forecast = Math.round((openAgg._sum.value || 0) * winRateGlobal);

    // Leads parados (sem actividade ha > 14 dias e abertos)
    const stagnantThreshold = new Date(); stagnantThreshold.setDate(stagnantThreshold.getDate() - 14);
    const stagnantLeads = await prisma.lead.findMany({
      where: { ...baseWhere, status: 'OPEN', updatedAt: { lt: stagnantThreshold } },
      include: {
        stage: { select: { name: true, color: true } },
        pipeline: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    res.json({
      avgConversionDays,
      forecastValue: forecast,
      forecastBaseValue: openAgg._sum.value || 0,
      forecastOpenCount: openAgg._count,
      winRateGlobal: Math.round(winRateGlobal * 100),
      stagnantLeads,
    });
  } catch (e) { next(e); }
});

// GET /api/analytics/activity-heatmap - 90 dias, agrupado por dia
router.get('/activity-heatmap', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const days = parseInt((req.query.days as string) || '90', 10);
    const start = new Date(); start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    const activities = await prisma.activity.findMany({
      where: { lead: { workspaceId }, createdAt: { gte: start } },
      select: { createdAt: true },
    });

    // Agrupar por dia (YYYY-MM-DD)
    const byDay: Record<string, number> = {};
    activities.forEach((a) => {
      const k = a.createdAt.toISOString().slice(0, 10);
      byDay[k] = (byDay[k] || 0) + 1;
    });

    // Construir array com todos os dias (mesmo os zeros)
    const result: Array<{ date: string; count: number }> = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = d.toISOString().slice(0, 10);
      result.push({ date: k, count: byDay[k] || 0 });
    }

    res.json(result);
  } catch (e) { next(e); }
});

export default router;
