// Job que envia lembretes automaticos por WhatsApp X horas antes de cada
// consulta/marcacao. Corre a cada 5 minutos e apanha appointments cuja
// startsAt cai na janela [now + X - buffer, now + X + buffer] e que ainda
// nao tem reminderSentAt.
//
// Configuracao (por workspace, guardada em Workspace.appointmentReminderHours,
// default 24 horas). O template da mensagem usa placeholders: {nome}, {data},
// {hora}, {clinica}, {tipo}.
//
// Envia via sendWhatsAppOut (Evolution + fallback Cloud). Marca reminderSentAt
// mesmo em caso de erro para nao insistir infinitamente com o mesmo contacto.

import prisma from './prisma';
import { sendWhatsAppOut } from './whatsappSend';

// Buffer de janela de 5 minutos para cada lado (10min no total). Cron corre a
// cada 5min, portanto cobrimos toda a linha temporal sem repeticoes.
const WINDOW_MIN = 5;

const DEFAULT_TEMPLATE =
  'Olá {nome}, apenas para lembrar que temos consulta amanhã, dia {data} às {hora}. Se precisar reagendar, responda a esta mensagem. Obrigada, {clinica}.';

function renderTemplate(
  template: string,
  vars: { nome: string; data: string; hora: string; clinica: string; tipo: string },
): string {
  return template
    .split('{nome}').join(vars.nome)
    .split('{data}').join(vars.data)
    .split('{hora}').join(vars.hora)
    .split('{clinica}').join(vars.clinica)
    .split('{tipo}').join(vars.tipo);
}

// Formata Date para "DD/MM" no fuso horario do workspace.
function formatDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value || '00';
  const month = parts.find((p) => p.type === 'month')?.value || '00';
  return `${day}/${month}`;
}

// Formata Date para "HH:MM" no fuso horario do workspace.
function formatTimeInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

export async function runAppointmentReminders(): Promise<void> {
  const now = Date.now();

  // Vamos processar por workspace porque cada um pode ter appointmentReminderHours
  // proprio e template proprio.
  const workspaces = await prisma.workspace.findMany({
    where: {
      // Filtramos so os que tem lembretes activos. Coluna nova; se nao existir
      // valor, considera 24h default (activo).
    },
    select: {
      id: true,
      name: true,
      timezone: true,
      appointmentReminderHours: true,
      appointmentReminderTemplate: true,
      appointmentReminderEnabled: true,
    },
  });

  for (const ws of workspaces) {
    if (ws.appointmentReminderEnabled === false) continue;

    const hoursBefore = ws.appointmentReminderHours || 24;
    const targetTime = now + hoursBefore * 3600 * 1000;
    const windowMs = WINDOW_MIN * 60 * 1000;

    const startsAtGte = new Date(targetTime - windowMs);
    const startsAtLte = new Date(targetTime + windowMs);

    const appts = await prisma.appointment.findMany({
      where: {
        workspaceId: ws.id,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        reminderSentAt: null,
        startsAt: { gte: startsAtGte, lte: startsAtLte },
      },
      include: {
        contact: { select: { firstName: true, lastName: true, phone: true, whatsapp: true } },
      },
    });

    if (appts.length === 0) continue;
    console.log(`[appointmentReminders] workspace=${ws.name} hoursBefore=${hoursBefore} candidates=${appts.length}`);

    const tz = ws.timezone || 'Africa/Maputo';
    const template = ws.appointmentReminderTemplate || DEFAULT_TEMPLATE;

    for (const a of appts) {
      const phone = a.contact?.whatsapp || a.contact?.phone;
      if (!phone) {
        // Sem numero, marcar mesmo assim para nao voltar a tentar
        await prisma.appointment.update({
          where: { id: a.id },
          data: { reminderSentAt: new Date() },
        });
        continue;
      }

      const message = renderTemplate(template, {
        nome: a.contact.firstName || 'paciente',
        data: formatDateInTz(a.startsAt, tz),
        hora: formatTimeInTz(a.startsAt, tz),
        clinica: ws.name,
        tipo: a.title,
      });

      try {
        const result = await sendWhatsAppOut(ws.id, phone, message, 'TEXT');
        await prisma.appointment.update({
          where: { id: a.id },
          data: { reminderSentAt: new Date() },
        });
        // Persistir a mensagem no timeline do paciente (para o utilizador ver
        // que o lembrete saiu)
        await prisma.message.create({
          data: {
            content: message,
            type: 'TEXT',
            direction: 'OUTBOUND',
            channel: 'WHATSAPP',
            status: result.ok ? 'SENT' : 'FAILED',
            externalId: result.externalId,
            contactId: a.contactId,
            leadId: a.leadId,
          },
        });
        console.log(`[appointmentReminders] enviado appt=${a.id} to=${phone.slice(-4)} ok=${result.ok}`);
      } catch (err: any) {
        console.error(`[appointmentReminders] erro appt=${a.id}:`, err.message);
        // Marcar mesmo assim para nao repetir infinitamente
        await prisma.appointment.update({
          where: { id: a.id },
          data: { reminderSentAt: new Date() },
        });
      }
    }
  }
}
