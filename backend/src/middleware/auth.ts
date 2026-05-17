import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';


import prisma from '../lib/prisma';
export interface AuthRequest extends Request {
  user?: {
    id: string;
    workspaceId: string;
    role: string;
    email: string;
    viewOnlyOwn?: boolean;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      workspaceId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, workspaceId: true, role: true, email: true, isActive: true, viewOnlyOwn: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Utilizador não autorizado' });
    }

    req.user = { id: user.id, workspaceId: user.workspaceId, role: user.role, email: user.email, viewOnlyOwn: user.viewOnlyOwn };

    // Actualizar session.lastUsedAt em background (sem bloquear)
    prisma.session.updateMany({
      where: { userId: user.id, token, expiresAt: { gt: new Date() } },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Acesso negado' });
    }
    next();
  };
};
