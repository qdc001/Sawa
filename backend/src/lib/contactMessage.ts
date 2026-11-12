// Envia um texto por WhatsApp a um contacto e grava-o na conversa (aparece no Inbox como enviado pelo utilizador).
import prisma from './prisma';
import { sendWhatsAppOut } from './whatsappSend';

export async function sendTextToContact(opts: {
  io: any; workspaceId: string; userId: string; contactId: string; leadId?: string | null; content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const contact = await prisma.contact.findFirst({ where: { id: opts.contactId, workspaceId: opts.workspaceId } });
  if (!contact) return { ok: false, error: 'Contacto não encontrado' };
  const phone = contact.whatsapp || contact.phone;
  if (!phone) return { ok: false, error: 'O contacto não tem número de WhatsApp' };
  const r = await sendWhatsAppOut(opts.workspaceId, phone, opts.content, 'TEXT');
  const message = await prisma.message.create({
    data: {
      content: opts.content, channel: 'WHATSAPP', type: 'TEXT', direction: 'OUTBOUND', status: r.ok ? 'SENT' : 'FAILED',
      contactId: contact.id, leadId: opts.leadId || null, externalId: r.externalId, sentById: opts.userId,
    },
    include: { sentBy: { select: { id: true, name: true, avatar: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (message.leadId) opts.io?.to(`lead:${message.leadId}`).emit('message:new', message);
  opts.io?.to(`workspace:${opts.workspaceId}`).emit('message:new', message);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Não foi possível enviar' };
}

// {nome}, {nome_completo}, {etapa}, {pipeline}
export function fillTemplate(tpl: string, vars: Record<string, string | null | undefined>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] || '' : m)).trim();
}
