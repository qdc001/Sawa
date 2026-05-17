import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { notifyMentions } from '../lib/notify';
import prisma from '../lib/prisma';
const router = Router();

router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId } = req.query;
    const notes = await prisma.note.findMany({ where: { leadId: leadId as string }, include: { createdBy: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'desc' } });
    res.json(notes);
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const note = await prisma.note.create({ data: { ...req.body, createdById: req.user!.id }, include: { createdBy: { select: { id: true, name: true, avatar: true } } } });
    if (note.leadId) await prisma.activity.create({ data: { type: 'NOTE_ADDED', description: 'Nota adicionada', leadId: note.leadId, userId: req.user!.id } });
    notifyMentions(note.content || '', req.user!.workspaceId, { type: 'note', entityId: note.id }).catch(() => {});
    res.status(201).json(note);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const note = await prisma.note.update({ where: { id: req.params.id }, data: req.body });
    res.json(note);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.note.delete({ where: { id: req.params.id } });
    res.json({ message: 'Nota eliminada' });
  } catch (e) { next(e); }
});

export default router;
