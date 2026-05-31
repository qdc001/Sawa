import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { DEFAULT_TEMPLATES } from '../lib/mailer';

import prisma from '../lib/prisma';
const router = Router();

const TEMPLATE_TYPES = ['welcome', 'password_reset', 'invite', 'csat', 'lead_assigned', 'task_overdue'];

// GET /api/system-email-templates - lista todos (com defaults se não houver override)
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const overrides = await prisma.systemEmailTemplate.findMany({
      where: { workspaceId: req.user!.workspaceId },
    });
    const map: Record<string, any> = {};
    overrides.forEach((o) => { map[o.type] = o; });
    const result = TEMPLATE_TYPES.map((type) => {
      const def = (DEFAULT_TEMPLATES as any)[type];
      const ov = map[type];
      return {
        type,
        subject: ov?.subject ?? def?.subject ?? '',
        body: ov?.body ?? def?.body ?? '',
        enabled: ov?.enabled ?? true,
        isDefault: !ov,
        id: ov?.id,
      };
    });
    res.json(result);
  } catch (e) { next(e); }
});

// PUT /api/system-email-templates/:type - upsert
router.put('/:type', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { type } = req.params;
    if (!TEMPLATE_TYPES.includes(type)) throw new AppError('Tipo invalido', 400);
    const { subject, body, enabled } = req.body;
    if (!subject || !body) throw new AppError('Subject e body obrigatórios', 400);

    const existing = await prisma.systemEmailTemplate.findFirst({
      where: { workspaceId: req.user!.workspaceId, type },
    });
    let saved;
    if (existing) {
      saved = await prisma.systemEmailTemplate.update({
        where: { id: existing.id },
        data: { subject, body, enabled: enabled ?? true },
      });
    } else {
      saved = await prisma.systemEmailTemplate.create({
        data: { workspaceId: req.user!.workspaceId, type, subject, body, enabled: enabled ?? true },
      });
    }
    res.json(saved);
  } catch (e) { next(e); }
});

// DELETE /api/system-email-templates/:type - voltar ao default
router.delete('/:type', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    await prisma.systemEmailTemplate.deleteMany({
      where: { workspaceId: req.user!.workspaceId, type: req.params.type },
    });
    res.json({ message: 'Reposto ao padrao' });
  } catch (e) { next(e); }
});

export default router;
