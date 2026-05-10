/**
 * Helper de notificação por email opt-in.
 *
 * Cada utilizador tem `emailPreferences` JSON com chaves: newLead, taskOverdue, newMessage, mention.
 * Esta lib verifica preferências antes de enviar, e se SMTP não estiver configurado, salta silenciosamente.
 */

import { PrismaClient } from '@prisma/client';
import { sendEmail } from './mailer';

const prisma = new PrismaClient();

type PrefKey = 'newLead' | 'taskOverdue' | 'newMessage' | 'mention';

async function shouldNotify(userId: string, key: PrefKey): Promise<{ ok: boolean; user?: any }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isActive: true, emailPreferences: true, workspaceId: true },
  });
  if (!user || !user.isActive || !user.email) return { ok: false };
  const prefs: any = user.emailPreferences || {};
  if (prefs[key] === false) return { ok: false };
  return { ok: true, user };
}

export async function notifyNewLead(leadId: string, assignedToId: string | null): Promise<void> {
  if (!assignedToId) return;
  const { ok, user } = await shouldNotify(assignedToId, 'newLead');
  if (!ok || !user) return;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { contact: true, stage: true, pipeline: true },
  });
  if (!lead) return;

  const subject = `Novo lead atribuído: ${lead.title}`;
  const html = `<p>Olá ${user.name},</p>
    <p>Foi-te atribuído um novo lead:</p>
    <ul>
      <li><strong>${lead.title}</strong></li>
      <li>Pipeline: ${lead.pipeline?.name || '-'} / ${lead.stage?.name || '-'}</li>
      ${lead.contact ? `<li>Contacto: ${lead.contact.firstName} ${lead.contact.lastName || ''}</li>` : ''}
      ${lead.value ? `<li>Valor: ${lead.value} ${lead.currency || ''}</li>` : ''}
    </ul>
    <p>Acede ao CRM para responder.</p>`;
  await sendEmail({ workspaceId: user.workspaceId, to: user.email, subject, html });
}

export async function notifyTaskOverdue(taskId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignedTo: true, lead: true },
  });
  if (!task || !task.assignedTo) return;

  const { ok, user } = await shouldNotify(task.assignedToId, 'taskOverdue');
  if (!ok || !user) return;

  const subject = `Tarefa atrasada: ${task.title}`;
  const html = `<p>Olá ${user.name},</p>
    <p>A seguinte tarefa está atrasada:</p>
    <ul>
      <li><strong>${task.title}</strong></li>
      ${task.dueAt ? `<li>Prazo: ${new Date(task.dueAt).toLocaleString('pt-PT')}</li>` : ''}
      ${task.lead ? `<li>Lead: ${task.lead.title}</li>` : ''}
    </ul>
    <p>Acede ao CRM para concluir ou actualizar.</p>`;
  await sendEmail({ workspaceId: user.workspaceId, to: user.email, subject, html });
}

export async function notifyNewMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { lead: { include: { assignedTo: true } }, contact: true },
  });
  if (!message || message.direction !== 'INBOUND') return;
  // Só notifica o responsável do lead (se houver)
  const userId = message.lead?.assignedToId;
  if (!userId) return;

  const { ok, user } = await shouldNotify(userId, 'newMessage');
  if (!ok || !user) return;

  const subject = `Nova mensagem de ${message.contact?.firstName || 'cliente'}`;
  const html = `<p>Olá ${user.name},</p>
    <p>Recebeste uma nova mensagem ${message.lead ? `no lead "${message.lead.title}"` : ''}:</p>
    <blockquote style="border-left: 3px solid #6366F1; padding-left: 10px; color: #475569;">${(message.content || '').substring(0, 500)}</blockquote>
    <p>Canal: ${message.channel}</p>`;
  await sendEmail({ workspaceId: user.workspaceId, to: user.email, subject, html });
}

// Detecta @nome em texto e notifica utilizadores mencionados
export async function notifyMentions(text: string, workspaceId: string, context: { type: 'note' | 'message'; entityId?: string }): Promise<void> {
  if (!text) return;
  const matches = text.match(/@([\w-]+)/g);
  if (!matches || matches.length === 0) return;

  const names = matches.map((m) => m.substring(1).toLowerCase());
  const users = await prisma.user.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, email: true, emailPreferences: true },
  });

  const mentioned = users.filter((u) => {
    const firstName = u.name.split(' ')[0].toLowerCase();
    return names.includes(firstName) || names.includes(u.name.toLowerCase().replace(/\s+/g, ''));
  });

  for (const u of mentioned) {
    const prefs: any = u.emailPreferences || {};
    if (prefs.mention === false || !u.email) continue;
    const subject = `Foste mencionado em ${context.type === 'note' ? 'uma nota' : 'uma mensagem'}`;
    const html = `<p>Olá ${u.name},</p>
      <p>Foste mencionado:</p>
      <blockquote style="border-left: 3px solid #6366F1; padding-left: 10px; color: #475569;">${text.substring(0, 500)}</blockquote>`;
    await sendEmail({ workspaceId, to: u.email, subject, html });
  }
}
