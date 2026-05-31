import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    let pipelines = await prisma.pipeline.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
      orderBy: { position: 'asc' },
    });

    // Auto-criar pipeline se nenhum existir
    if (pipelines.length === 0) {
      await prisma.pipeline.create({
        data: {
          name: 'Pipeline Principal',
          isDefault: true,
          color: '#6366F1',
          position: 0,
          workspaceId: req.user!.workspaceId,
          createdById: req.user!.id,
          stages: {
            create: [
              { name: 'Novo Lead', color: '#6B7280', position: 0 },
              { name: 'Em Contacto', color: '#3B82F6', position: 1 },
              { name: 'Proposta Enviada', color: '#8B5CF6', position: 2 },
              { name: 'Negociacao', color: '#F59E0B', position: 3 },
              { name: 'Ganho', color: '#10B981', position: 4, type: 'WON' },
              { name: 'Perdido', color: '#EF4444', position: 5, type: 'LOST' },
            ],
          },
        },
      });

      pipelines = await prisma.pipeline.findMany({
        where: { workspaceId: req.user!.workspaceId },
        include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
        orderBy: { position: 'asc' },
      });
    }

    res.json(pipelines);
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, color } = req.body;
    if (!name) throw new AppError('Nome e obrigatório', 400);
    const count = await prisma.pipeline.count({ where: { workspaceId: req.user!.workspaceId } });
    const pipeline = await prisma.pipeline.create({
      data: {
        name, description, color: color || '#3B82F6', position: count,
        workspaceId: req.user!.workspaceId, createdById: req.user!.id,
        stages: { create: [
          { name: 'Novo', color: '#6B7280', position: 0 },
          { name: 'Em Progresso', color: '#3B82F6', position: 1 },
          { name: 'Ganho', color: '#10B981', position: 2, type: 'WON' },
          { name: 'Perdido', color: '#EF4444', position: 3, type: 'LOST' },
        ]},
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    res.status(201).json(pipeline);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, color } = req.body;
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id }, data: { name, description, color }, include: { stages: true }
    });
    res.json(pipeline);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.pipeline.delete({ where: { id: req.params.id } });
    res.json({ message: 'Pipeline eliminado' });
  } catch (e) { next(e); }
});

export default router;