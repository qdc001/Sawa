import prisma from './prisma';
import { AppError } from '../middleware/errorHandler';
import { getPlan, UNLIMITED } from './plans';

type Kind = 'contacts' | 'users' | 'whatsapp' | 'automations';

const LABELS: Record<Kind, string> = {
  contacts: 'contactos',
  users: 'utilizadores',
  whatsapp: 'ligações WhatsApp',
  automations: 'automações activas',
};

// Lança AppError 403 se o workspace já atingiu o limite do seu plano para `kind`.
// Planos ilimitados (Enterprise/Business em alguns campos) nunca bloqueiam.
export async function checkLimit(workspaceId: string, kind: Kind): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } });
  const limit = getPlan(ws?.plan).limits[kind];
  if (limit === UNLIMITED) return;

  let count = 0;
  if (kind === 'contacts') count = await prisma.contact.count({ where: { workspaceId } });
  else if (kind === 'users') count = await prisma.user.count({ where: { workspaceId } });
  else if (kind === 'whatsapp') count = await prisma.integration.count({ where: { workspaceId, type: 'WHATSAPP', isActive: true } });
  else if (kind === 'automations') count = await prisma.automation.count({ where: { workspaceId, isActive: true } });

  if (count >= limit) {
    throw new AppError(`Limite do plano atingido: ${LABELS[kind]} (máximo ${limit}). Faz upgrade do plano para adicionar mais.`, 403);
  }
}
