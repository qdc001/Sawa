import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const prisma = new PrismaClient();

// GET /api/workspaces/me - dados da workspace actual
router.get('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      include: { _count: { select: { users: true, leads: true, contacts: true } } },
    });
    if (!workspace) throw new AppError('Workspace nao encontrada', 404);
    res.json(workspace);
  } catch (e) { next(e); }
});

// PATCH /api/workspaces/me - actualizar (OWNER/ADMIN)
router.patch('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN podem editar a workspace', 403);
    }
    const { name, slug, logo, timezone, currency } = req.body;
    const workspace = await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data: {
        ...(name && { name }),
        ...(slug && { slug }),
        ...(logo !== undefined && { logo }),
        ...(timezone && { timezone }),
        ...(currency && { currency }),
      },
    });
    res.json(workspace);
  } catch (e) { next(e); }
});

export default router;
