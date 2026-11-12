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
    const cur = await prisma.stage.findFirst({ where: { id: req.params.id, pipeline: { workspaceId: req.user!.workspaceId } }, select: { id: true } });
    if (!cur) return res.status(404).json({ message: 'Etapa não encontrada' });
    const data: any = {};
    for (const k of ['name', 'color', 'position', 'type']) if (req.body?.[k] !== undefined) data[k] = req.body[k];
    if (req.body?.moveMessage !== undefined) {
      data.moveMessage = typeof req.body.moveMessage === 'string' ? req.body.moveMessage.trim().slice(0, 2000) || null : null;
    }
    const stage = await prisma.stage.update({ where: { id: cur.id }, data });
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
