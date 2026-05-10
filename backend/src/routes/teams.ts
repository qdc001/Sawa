import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

// GET /api/teams
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: {
        members: { select: { id: true, name: true, avatar: true, role: true } },
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(teams);
  } catch (e) { next(e); }
});

// POST /api/teams
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { name, description, color } = req.body;
    if (!name) throw new AppError('Nome obrigatorio', 400);
    const team = await prisma.team.create({
      data: {
        name, description, color: color || '#6366F1',
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(team);
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Equipa com este nome ja existe' });
    next(e);
  }
});

// PATCH /api/teams/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(team);
  } catch (e) { next(e); }
});

// DELETE /api/teams/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    await prisma.team.delete({ where: { id: req.params.id } });
    res.json({ message: 'Equipa eliminada' });
  } catch (e) { next(e); }
});

// POST /api/teams/:id/members - adicionar membro
router.post('/:id/members', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { userId } = req.body;
    if (!userId) throw new AppError('userId obrigatorio', 400);
    await prisma.user.update({ where: { id: userId }, data: { teamId: req.params.id } });
    res.json({ message: 'Adicionado' });
  } catch (e) { next(e); }
});

// DELETE /api/teams/:id/members/:userId - remover membro
router.delete('/:id/members/:userId', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    await prisma.user.update({ where: { id: req.params.userId }, data: { teamId: null } });
    res.json({ message: 'Removido' });
  } catch (e) { next(e); }
});

export default router;
