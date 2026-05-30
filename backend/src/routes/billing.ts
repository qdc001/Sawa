import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
import { PLANS, getPlan } from '../lib/plans';

const router = Router();

// GET /api/billing/catalog — todos os planos (para a página comparar)
router.get('/catalog', (_req: AuthRequest, res: Response) => {
  res.json(Object.values(PLANS));
});

// GET /api/billing/me — plano actual + limites + consumo ao vivo
router.get('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const wsId = req.user!.workspaceId;
    const ws = await prisma.workspace.findUnique({
      where: { id: wsId },
      select: { plan: true, trialEndsAt: true },
    });
    const plan = getPlan(ws?.plan);

    const [users, contacts, automations, whatsapp] = await Promise.all([
      prisma.user.count({ where: { workspaceId: wsId } }),
      prisma.contact.count({ where: { workspaceId: wsId } }),
      prisma.automation.count({ where: { workspaceId: wsId, isActive: true } }),
      prisma.integration.count({ where: { workspaceId: wsId, type: 'WHATSAPP', isActive: true } }),
    ]);

    const trialActive = ws?.trialEndsAt ? new Date(ws.trialEndsAt) > new Date() : false;

    res.json({
      plan: plan.key,
      planLabel: plan.label,
      priceUsd: plan.priceUsd,
      limits: plan.limits,
      features: plan.features,
      trialEndsAt: ws?.trialEndsAt || null,
      trialActive,
      isPlatformAdmin: !!(process.env.PLATFORM_ADMIN_EMAIL && req.user!.email.toLowerCase() === process.env.PLATFORM_ADMIN_EMAIL.toLowerCase()),
      usage: { users, contacts, automations, whatsapp },
    });
  } catch (e) { next(e); }
});

// POST /api/billing/set-plan { plan, workspaceId? } — só o administrador da plataforma
router.post('/set-plan', async (req: AuthRequest, res: Response, next) => {
  try {
    const adminEmail = process.env.PLATFORM_ADMIN_EMAIL;
    if (!adminEmail || req.user!.email.toLowerCase() !== adminEmail.toLowerCase()) {
      throw new AppError('Apenas o administrador da plataforma pode alterar planos', 403);
    }
    const { plan, workspaceId } = req.body;
    if (!PLANS[plan]) throw new AppError('Plano invalido', 400);
    const target = workspaceId || req.user!.workspaceId;
    const ws = await prisma.workspace.update({ where: { id: target }, data: { plan } });
    res.json({ message: `Plano definido para ${PLANS[plan].label}`, plan: ws.plan });
  } catch (e) { next(e); }
});

export default router;
