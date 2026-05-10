import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const { name, email, password, workspaceName } = req.body;

    if (!name || !email || !password || !workspaceName) {
      throw new AppError('Todos os campos são obrigatórios', 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email já registado', 409);

    const slug = workspaceName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    const hashedPassword = await bcrypt.hash(password, 12);

    // 1. Cria workspace + user primeiro
    const workspace = await prisma.workspace.create({
      data: {
        name: workspaceName,
        slug,
        users: {
          create: {
            name,
            email,
            password: hashedPassword,
            role: 'OWNER',
          },
        },
      },
      include: { users: true },
    });

    const user = workspace.users[0];

    // 2. Cria pipeline padrao com createdById valido
    await prisma.pipeline.create({
      data: {
        name: 'Pipeline Principal',
        isDefault: true,
        color: '#6366F1',
        position: 0,
        workspaceId: workspace.id,
        createdById: user.id,
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

    const token = jwt.sign(
      { userId: user.id, workspaceId: workspace.id },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
    );

    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email e palavra-passe são obrigatórios', 400);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { workspace: true },
    });

    if (!user || !await bcrypt.compare(password, user.password)) {
      throw new AppError('Credenciais inválidas', 401);
    }

    if (!user.isActive) {
      throw new AppError('Conta desactivada', 403);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = jwt.sign(
      { userId: user.id, workspaceId: user.workspaceId },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as any
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar },
      workspace: { id: user.workspace.id, name: user.workspace.name, slug: user.workspace.slug },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { workspace: true },
      omit: { password: true },
    });

    if (!user) throw new AppError('Utilizador não encontrado', 404);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

    if (!user || !await bcrypt.compare(currentPassword, user.password)) {
      throw new AppError('Palavra-passe actual incorrecta', 400);
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ message: 'Palavra-passe alterada com sucesso' });
  } catch (error) {
    next(error);
  }
});

export default router;
