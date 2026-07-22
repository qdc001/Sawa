import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { validatePassword, WeakPasswordError } from '../lib/passwordPolicy';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { verifyTotp } from '../lib/totp';
import { sendSystemEmail } from '../lib/mailer';

import prisma from '../lib/prisma';
const router = Router();

function parseDeviceInfo(ua?: string): string {
  if (!ua) return 'Desconhecido';
  let device = '';
  if (/Chrome/i.test(ua)) device = 'Chrome';
  else if (/Firefox/i.test(ua)) device = 'Firefox';
  else if (/Safari/i.test(ua)) device = 'Safari';
  else if (/Edg/i.test(ua)) device = 'Edge';
  else device = 'Browser';
  if (/Windows/i.test(ua)) device += ' (Windows)';
  else if (/Mac OS/i.test(ua)) device += ' (macOS)';
  else if (/Linux/i.test(ua)) device += ' (Linux)';
  else if (/Android/i.test(ua)) device += ' (Android)';
  else if (/iPhone|iPad/i.test(ua)) device += ' (iOS)';
  return device;
}

async function createSession(userId: string, token: string, req: Request) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '';
  const ua = req.headers['user-agent'] || '';
  await prisma.session.create({
    data: {
      token,
      userId,
      ip: ip.slice(0, 64),
      userAgent: ua.slice(0, 255),
      device: parseDeviceInfo(ua),
      expiresAt,
    },
  });
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response, next) => {
  try {
    const { name, email, password, workspaceName } = req.body;

    if (!name || !email || !password || !workspaceName) {
      throw new AppError('Todos os campos são obrigatórios', 400);
    }

    try { validatePassword(password, { email, name }); }
    catch (e: any) { if (e instanceof WeakPasswordError) throw new AppError(e.message, 400); throw e; }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email já registado', 409);

    const slug = workspaceName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    const hashedPassword = await bcrypt.hash(password, 12);

    // 1. Cria workspace + user primeiro
    const workspace = await prisma.workspace.create({
      data: {
        name: workspaceName,
        slug,
        // Trial de 7 dias com acesso ao plano Growth
        plan: 'GROWTH',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
    const { email, password, code } = req.body;

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

    // 2FA
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!code) {
        return res.status(206).json({ needs2FA: true, email });
      }
      if (!verifyTotp(user.twoFactorSecret, code)) {
        throw new AppError('Código 2FA invalido', 401);
      }
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

    await createSession(user.id, token, req);

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar },
      workspace: { id: user.workspace.id, name: user.workspace.name, slug: user.workspace.slug },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/forgot-password (público)
router.post('/forgot-password', async (req: Request, res: Response, next) => {
  try {
    const { email } = req.body;
    if (!email) throw new AppError('Email obrigatório', 400);
    const user = await prisma.user.findUnique({ where: { email } });
    // Resposta sempre 200 para não revelar se email existe
    if (!user) return res.json({ message: 'Se o email existir, será enviado um link.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(); expiresAt.setHours(expiresAt.getHours() + 1);
    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/reset-password/${token}`;
    const result = await sendSystemEmail(user.workspaceId, 'password_reset', user.email, {
      name: user.name, link,
    });

    res.json({
      message: 'Se o email existir, será enviado um link.',
      _debug: result.sent ? undefined : { reason: result.reason, link },
    });
  } catch (e) { next(e); }
});

// POST /api/auth/reset-password (público)
router.post('/reset-password', async (req: Request, res: Response, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) throw new AppError('Token e password obrigatórios', 400);

    const reset = await prisma.passwordResetToken.findUnique({ where: { token }, include: { user: { select: { email: true, name: true } } } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new AppError('Token invalido ou expirado', 400);
    }
    try { validatePassword(newPassword, { email: reset.user.email, name: reset.user.name }); }
    catch (e: any) { if (e instanceof WeakPasswordError) throw new AppError(e.message, 400); throw e; }
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: reset.userId }, data: { password: hash } });
    await prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    res.json({ message: 'Password redefinida' });
  } catch (e) { next(e); }
});

// GET /api/auth/invite/:token (público) - info do convite
router.get('/invite/:token', async (req: Request, res: Response, next) => {
  try {
    const invite = await prisma.inviteToken.findUnique({
      where: { token: req.params.token },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!invite || invite.usedAt) return res.status(404).json({ message: 'Convite invalido' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ message: 'Convite expirado' });
    res.json({ name: invite.user.name, email: invite.user.email });
  } catch (e) { next(e); }
});

// POST /api/auth/invite/:token/accept (público) - definir password
router.post('/invite/:token/accept', async (req: Request, res: Response, next) => {
  try {
    const { password } = req.body;
    if (!password) throw new AppError('Password obrigatoria', 400);
    const invite = await prisma.inviteToken.findUnique({ where: { token: req.params.token }, include: { user: { select: { email: true, name: true } } } });
    if (!invite || invite.usedAt) return res.status(404).json({ message: 'Convite invalido' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ message: 'Convite expirado' });
    try { validatePassword(password, { email: invite.user.email, name: invite.user.name }); }
    catch (e: any) { if (e instanceof WeakPasswordError) throw new AppError(e.message, 400); throw e; }
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: invite.userId }, data: { password: hash, isActive: true } });
    await prisma.inviteToken.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    res.json({ message: 'Conta activada. Pode fazer login.' });
  } catch (e) { next(e); }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        phone: true,
        role: true,
        isActive: true,
        workspaceId: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        workspace: true,
      },
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
    try { validatePassword(newPassword, { email: user.email, name: user.name }); }
    catch (e: any) { if (e instanceof WeakPasswordError) throw new AppError(e.message, 400); throw e; }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

    res.json({ message: 'Palavra-passe alterada com sucesso' });
  } catch (error) {
    next(error);
  }
});

export default router;
