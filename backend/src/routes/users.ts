// users.ts
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateSecret, otpauthUrl, verifyTotp } from '../lib/totp';
import { sendSystemEmail } from '../lib/mailer';

import prisma from '../lib/prisma';
const router = Router();

const userSelect = {
  id: true, name: true, email: true, avatar: true, phone: true,
  digestGroupJid: true,
  role: true, isActive: true, status: true, internalNotes: true,
  viewOnlyOwn: true, teamId: true,
  twoFactorEnabled: true, language: true, emailPreferences: true,
  workspaceId: true, lastLoginAt: true,
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
    const { name, phone, avatar, status, language, emailPreferences } = req.body;
    if (status && !['ONLINE', 'AWAY', 'BUSY', 'DND', 'OFFLINE'].includes(status)) {
      throw new AppError('Status invalido', 400);
    }
    if (language && !['pt', 'en'].includes(language)) {
      throw new AppError('Idioma invalido', 400);
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(name && { name }),
        ...(phone !== undefined && { phone }),
        ...(avatar !== undefined && { avatar }),
        ...(status && { status }),
        ...(language && { language }),
        ...(emailPreferences && { emailPreferences }),
      },
      select: userSelect,
    });
    res.json(user);
  } catch (e) { next(e); }
});

// =============== Sessions ===============

// GET /api/users/me/sessions
router.get('/me/sessions', async (req: AuthRequest, res: Response, next) => {
  try {
    const currentToken = req.headers.authorization?.replace('Bearer ', '');
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, device: true, lastUsedAt: true, createdAt: true, expiresAt: true, token: true },
    });
    // mascarar token mas indicar se e a sessao actual
    const result = sessions.map((s) => ({
      ...s,
      isCurrent: s.token === currentToken,
      token: undefined,
    }));
    res.json(result);
  } catch (e) { next(e); }
});

// DELETE /api/users/me/sessions/:id
router.delete('/me/sessions/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session || session.userId !== req.user!.id) throw new AppError('Sessao nao encontrada', 404);
    await prisma.session.delete({ where: { id: session.id } });
    res.json({ message: 'Sessao terminada' });
  } catch (e) { next(e); }
});

// POST /api/users/me/sessions/revoke-others - terminar todas excepto a actual
router.post('/me/sessions/revoke-others', async (req: AuthRequest, res: Response, next) => {
  try {
    const currentToken = req.headers.authorization?.replace('Bearer ', '');
    const result = await prisma.session.deleteMany({
      where: { userId: req.user!.id, token: { not: currentToken } },
    });
    res.json({ revoked: result.count });
  } catch (e) { next(e); }
});

// =============== 2FA TOTP ===============

// POST /api/users/me/2fa/setup - gera secret e otpauth url (nao activa ainda)
router.post('/me/2fa/setup', async (req: AuthRequest, res: Response, next) => {
  try {
    const secret = generateSecret();
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError('Utilizador nao encontrado', 404);
    // Guardar secret temporario (mas nao activar ate verify)
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: false },
    });
    const url = otpauthUrl(secret, user.email, 'KommoCRM');
    res.json({ secret, otpauthUrl: url });
  } catch (e) { next(e); }
});

// POST /api/users/me/2fa/enable - verificar codigo e activar
router.post('/me/2fa/enable', async (req: AuthRequest, res: Response, next) => {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.twoFactorSecret) throw new AppError('Configura primeiro (setup)', 400);
    if (!verifyTotp(user.twoFactorSecret, code)) throw new AppError('Codigo invalido', 400);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    res.json({ message: '2FA activada' });
  } catch (e) { next(e); }
});

// POST /api/users/me/2fa/disable - desactivar (precisa password)
router.post('/me/2fa/disable', async (req: AuthRequest, res: Response, next) => {
  try {
    const { password } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError('Utilizador nao encontrado', 404);
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new AppError('Password incorrecta', 400);
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    res.json({ message: '2FA desactivada' });
  } catch (e) { next(e); }
});

// =============== Convidar por email ===============

// POST /api/users/invite-by-email
router.post('/invite-by-email', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
      throw new AppError('Apenas OWNER/ADMIN', 403);
    }
    const { name, email, role } = req.body;
    if (!name || !email) throw new AppError('Nome e email obrigatorios', 400);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email ja registado', 409);

    const tempPwd = crypto.randomBytes(16).toString('hex');
    const hash = await bcrypt.hash(tempPwd, 12);
    const user = await prisma.user.create({
      data: {
        name, email, password: hash,
        role: role || 'AGENT',
        isActive: false, // activa quando aceitar
        workspaceId: req.user!.workspaceId,
      },
      select: userSelect,
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 7);
    await prisma.inviteToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    const workspace = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/accept-invite/${token}`;
    const result = await sendSystemEmail(req.user!.workspaceId, 'invite', email, {
      name, link,
      workspaceName: workspace?.name || '',
    });

    res.status(201).json({
      user, inviteLink: link, emailSent: result.sent,
      ...(result.sent ? {} : { emailError: result.reason || 'SMTP nao configurado - partilha o link manualmente' }),
    });
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
    const { role, isActive, name, internalNotes, viewOnlyOwn, teamId, phone, digestGroupJid } = req.body;
    if (role === 'OWNER' && req.user!.role !== 'OWNER') {
      throw new AppError('Apenas OWNER pode promover outro a OWNER', 403);
    }
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
        ...(internalNotes !== undefined && { internalNotes }),
        ...(viewOnlyOwn !== undefined && { viewOnlyOwn }),
        ...(teamId !== undefined && { teamId: teamId || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(digestGroupJid !== undefined && { digestGroupJid: digestGroupJid || null }),
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
