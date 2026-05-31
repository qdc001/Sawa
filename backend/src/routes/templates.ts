import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// GET /api/templates?channel=&category=
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: any = { workspaceId: req.user!.workspaceId };
    if (req.query.channel) where.channel = req.query.channel;
    if (req.query.category) where.category = req.query.category;
    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    res.json(templates);
  } catch (e) { next(e); }
});

// POST /api/templates
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, content, category, channel, variables } = req.body;
    if (!name || !content || !category || !channel) {
      throw new AppError('Nome, conteudo, categoria e canal obrigatórios', 400);
    }
    const template = await prisma.messageTemplate.create({
      data: {
        name,
        content,
        category,
        channel,
        variables: Array.isArray(variables) ? variables : [],
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(template);
  } catch (e) { next(e); }
});

// PATCH /api/templates/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, content, category, channel, variables } = req.body;
    const template = await prisma.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(content && { content }),
        ...(category && { category }),
        ...(channel && { channel }),
        ...(variables && { variables }),
      },
    });
    res.json(template);
  } catch (e) { next(e); }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.messageTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Template eliminado' });
  } catch (e) { next(e); }
});

export default router;
