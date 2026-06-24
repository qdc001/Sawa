// Endpoints de consumo de tokens LLM e gestao de limites por plano.

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { getEffectiveLimits, getCurrentUsage, listPlanLimits, setPlanLimit } from '../lib/aiUsage';

const router = Router();

// Apenas o administrador da plataforma (email configurado em
// PLATFORM_ADMIN_EMAIL) pode mexer nos limites globais dos planos.
// OWNERs de workspaces clientes nao tem acesso.
function requirePlatformAdmin(req: AuthRequest) {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
  if (!adminEmail || req.user!.email.toLowerCase() !== adminEmail.toLowerCase()) {
    throw new AppError('Apenas o administrador da plataforma pode alterar os limites dos planos', 403);
  }
}

// GET /api/ai-usage/stats
// Estado do workspace actual: uso diario e mensal + limites efectivos.
router.get('/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const [usage, limits] = await Promise.all([
      getCurrentUsage(req.user!.workspaceId),
      getEffectiveLimits(req.user!.workspaceId),
    ]);
    res.json({
      planKey: limits.planKey,
      daily: {
        used: usage.daily,
        limit: limits.daily,
        unlimited: limits.daily === -1,
        percent: limits.daily === -1 ? 0 : Math.min(100, Math.round((usage.daily / limits.daily) * 100)),
        resetAt: usage.dailyResetAt,
      },
      monthly: {
        used: usage.monthly,
        limit: limits.monthly,
        unlimited: limits.monthly === -1,
        percent: limits.monthly === -1 ? 0 : Math.min(100, Math.round((usage.monthly / limits.monthly) * 100)),
        resetAt: usage.monthlyResetAt,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/ai-usage/breakdown?days=7
// Quebra de uso por feature/provider nos ultimos N dias.
router.get('/breakdown', async (req: AuthRequest, res: Response, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const rows = await prisma.aiUsageLog.groupBy({
      by: ['feature', 'provider'],
      where: { workspaceId: req.user!.workspaceId, createdAt: { gte: since } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      _count: { _all: true },
    });
    res.json({
      days,
      breakdown: rows.map((r) => ({
        feature: r.feature,
        provider: r.provider,
        totalTokens: r._sum.totalTokens || 0,
        promptTokens: r._sum.promptTokens || 0,
        completionTokens: r._sum.completionTokens || 0,
        callCount: r._count._all,
      })),
    });
  } catch (e) { next(e); }
});

// GET /api/ai-usage/plan-limits (so platform admin)
router.get('/plan-limits', async (req: AuthRequest, res: Response, next) => {
  try {
    requirePlatformAdmin(req);
    const list = await listPlanLimits();
    res.json({ planLimits: list });
  } catch (e) { next(e); }
});

// PATCH /api/ai-usage/plan-limits/:planKey (so platform admin)
router.patch('/plan-limits/:planKey', async (req: AuthRequest, res: Response, next) => {
  try {
    requirePlatformAdmin(req);
    const { dailyTokenLimit, monthlyTokenLimit } = req.body || {};
    if (!Number.isFinite(dailyTokenLimit) || !Number.isFinite(monthlyTokenLimit)) {
      throw new AppError('dailyTokenLimit e monthlyTokenLimit obrigatorios (numeros, -1 = ilimitado)', 400);
    }
    await setPlanLimit(req.params.planKey, Math.trunc(dailyTokenLimit), Math.trunc(monthlyTokenLimit));
    const list = await listPlanLimits();
    res.json({ planLimits: list });
  } catch (e) { next(e); }
});

export default router;
