import { Router, Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// Rotas autenticadas (montadas em /api/csat com authMiddleware)

// GET /api/csat?contactId=&leadId=
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: any = { workspaceId: req.user!.workspaceId };
    if (req.query.contactId) where.contactId = req.query.contactId;
    if (req.query.leadId) where.leadId = req.query.leadId;
    const items = await prisma.csatRequest.findMany({
      where,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        lead: { select: { id: true, title: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { sentAt: 'desc' },
    });
    res.json(items);
  } catch (e) { next(e); }
});

// POST /api/csat - criar pedido
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId, question } = req.body;
    if (!contactId && !leadId) throw new AppError('contactId ou leadId obrigatório', 400);
    const csat = await prisma.csatRequest.create({
      data: {
        workspaceId: req.user!.workspaceId,
        contactId: contactId || null,
        leadId: leadId || null,
        question: question || 'Como classificas o nosso atendimento?',
        createdById: req.user!.id,
      },
    });
    res.status(201).json(csat);
  } catch (e) { next(e); }
});

// GET /api/csat/stats - estatísticas
router.get('/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const items = await prisma.csatRequest.findMany({
      where: { workspaceId: req.user!.workspaceId, score: { not: null } },
      select: { score: true, respondedAt: true, sentAt: true },
    });
    const total = items.length;
    const avg = total > 0 ? items.reduce((a, b) => a + (b.score || 0), 0) / total : 0;
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    items.forEach((i) => { if (i.score) distribution[i.score]++; });
    const totalSent = await prisma.csatRequest.count({ where: { workspaceId: req.user!.workspaceId } });
    const responseRate = totalSent > 0 ? Math.round((total / totalSent) * 100) : 0;
    res.json({ total, totalSent, avg: Math.round(avg * 10) / 10, distribution, responseRate });
  } catch (e) { next(e); }
});

export default router;

// =============== Rotas publicas (sem auth) ===============
// Estas rotas são montadas separadamente em /api/csat-public no server.ts
export const publicRouter = Router();

publicRouter.get('/:token', async (req: Request, res: Response, next) => {
  try {
    const csat = await prisma.csatRequest.findUnique({
      where: { token: req.params.token },
      select: { id: true, question: true, score: true, respondedAt: true },
    });
    if (!csat) return res.status(404).json({ message: 'Pedido não encontrado' });
    res.json(csat);
  } catch (e) { next(e); }
});

publicRouter.post('/:token/respond', async (req: Request, res: Response, next) => {
  try {
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ message: 'Score deve ser 1-5' });
    }
    const existing = await prisma.csatRequest.findUnique({ where: { token: req.params.token } });
    if (!existing) return res.status(404).json({ message: 'Pedido não encontrado' });
    if (existing.respondedAt) return res.status(400).json({ message: 'Já respondido' });

    const updated = await prisma.csatRequest.update({
      where: { token: req.params.token },
      data: { score: Number(score), comment: comment || null, respondedAt: new Date() },
    });
    res.json({ message: 'Obrigado pela tua avaliação!', score: updated.score });
  } catch (e) { next(e); }
});
