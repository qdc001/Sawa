// users.ts
import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const router = Router();

const userSelect = {
  id: true, name: true, email: true, avatar: true, phone: true,
  role: true, isActive: true, workspaceId: true, lastLoginAt: true,
  createdAt: true, updatedAt: true,
};

// GET /api/users
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { workspaceId: req.user!.workspaceId },
      select: userSelect,
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (e) { next(e); }
});

// PATCH /api/users/me - actualizar perfil pessoal
router.patch('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, phone, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { ...(name && { name }), ...(phone !== undefined && { phone }), ...(avatar !== undefined && { avatar }) },
      select: userSelect,
    });
    res.json(user);
  } catch (e) { next(e); }
});

// POST /api/users/me/change-password
router.post('/me/change-password', async (req: AuthRequest, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) throw new AppError('Passwords obrigatorias', 400);
    if (newPassword.length < 6) throw new AppError('Nova password tem de ter pelo menos 6 caracteres', 400);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError('Utilizador nao encontrado', 404);
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new AppError('Password actual incorrecta', 400);
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
    res.json({ message: 'Password alterada' });
  } catch (e) { next(e); }
});

// POST /api/users - convidar novo membro (OWNER/ADMIN)
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN podem convidar', 403);
    }
    const { name, email, role, password } = req.body;
    if (!name || !email || !password) throw new AppError('Nome, email e password obrigatorios', 400);
    if (password.length < 6) throw new AppError('Password tem de ter pelo menos 6 caracteres', 400);
    if (role && !['ADMIN', 'MANAGER', 'AGENT'].includes(role)) {
      throw new AppError('Role invalida (so OWNER pode definir OWNER)', 400);
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email ja registado', 409);
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name, email, password: hash,
        role: role || 'AGENT',
        workspaceId: req.user!.workspaceId,
      },
      select: userSelect,
    });
    res.status(201).json(user);
  } catch (e) { next(e); }
});

// PATCH /api/users/:id - actualizar membro (OWNER/ADMIN)
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new AppError('Utilizador nao encontrado', 404);
    if (target.workspaceId !== req.user!.workspaceId) throw new AppError('Acesso negado', 403);
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN podem editar membros', 403);
    }
    const { role, isActive, name } = req.body;
    // Apenas OWNER pode promover a OWNER
    if (role === 'OWNER' && req.user!.role !== 'OWNER') {
      throw new AppError('Apenas OWNER pode promover outro a OWNER', 403);
    }
    // Nao deixar despromover o ultimo OWNER
    if (target.role === 'OWNER' && role && role !== 'OWNER') {
      const owners = await prisma.user.count({ where: { workspaceId: req.user!.workspaceId, role: 'OWNER' } });
      if (owners <= 1) throw new AppError('Tem de existir pelo menos um OWNER', 400);
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(role && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(name && { name }),
      },
      select: userSelect,
    });
    res.json(user);
  } catch (e) { next(e); }
});

// POST /api/users/:id/reset-password (OWNER/ADMIN)
router.post('/:id/reset-password', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.workspaceId !== req.user!.workspaceId) throw new AppError('Utilizador nao encontrado', 404);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) throw new AppError('Nova password tem de ter pelo menos 6 caracteres', 400);
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: target.id }, data: { password: hash } });
    res.json({ message: 'Password actualizada' });
  } catch (e) { next(e); }
});

// DELETE /api/users/:id (OWNER apenas)
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    if (req.user!.role !== 'OWNER') throw new AppError('Apenas OWNER pode eliminar membros', 403);
    if (req.params.id === req.user!.id) throw new AppError('Nao podes eliminar-te a ti proprio', 400);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.workspaceId !== req.user!.workspaceId) throw new AppError('Utilizador nao encontrado', 404);
    if (target.role === 'OWNER') {
      const owners = await prisma.user.count({ where: { workspaceId: req.user!.workspaceId, role: 'OWNER' } });
      if (owners <= 1) throw new AppError('Tem de existir pelo menos um OWNER', 400);
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'Utilizador eliminado' });
  } catch (e) { next(e); }
});

export default router;
