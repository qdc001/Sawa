import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// GET /api/tags
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const tags = await prisma.tag.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { leads: true, contacts: true } } },
    });
    res.json(tags);
  } catch (e) { next(e); }
});

// POST /api/tags
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, color } = req.body;
    if (!name) throw new AppError('Nome da tag obrigatório', 400);
    const tag = await prisma.tag.create({
      data: {
        name: name.trim(),
        color: color || '#6B7280',
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(tag);
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Tag com este nome já existe' });
    next(e);
  }
});

// PATCH /api/tags/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, color } = req.body;
    const tag = await prisma.tag.update({
      where: { id: req.params.id },
      data: { ...(name && { name }), ...(color && { color }) },
    });
    res.json(tag);
  } catch (e) { next(e); }
});

// DELETE /api/tags/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.tag.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tag eliminada' });
  } catch (e) { next(e); }
});

export default router;
