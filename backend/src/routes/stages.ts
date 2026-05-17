import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
const router = Router();

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, color, pipelineId, position } = req.body;
    const count = await prisma.stage.count({ where: { pipelineId } });
    const stage = await prisma.stage.create({ data: { name, color: color || '#6B7280', pipelineId, position: position ?? count } });
    res.status(201).json(stage);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const stage = await prisma.stage.update({ where: { id: req.params.id }, data: req.body });
    res.json(stage);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.stage.delete({ where: { id: req.params.id } });
    res.json({ message: 'Etapa eliminada' });
  } catch (e) { next(e); }
});

export default router;
