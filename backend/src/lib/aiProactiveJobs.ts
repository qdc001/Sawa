// Jobs proactivos da Leizy (Sprints 3 e 4.2 do cumprimento do manual).
//
// A Leizy passa de reactiva ("responde quando alguem escreve") para proactiva
// ("acompanha o paciente ao longo da jornada"). Tres jobs periodicos:
//
//   1. runReactivationJob (nocturno)
//      Identifica pacientes sem consulta ha N meses. Prepara mensagem
//      personalizada, mete na fila AiSalesSuggestion para o admin aprovar.
//      No modo supervisionado, humano ve e aprova. No modo auto, envia direct.
//
//   2. runBirthdayJob (diario as X horas locais)
//      Le custom field 'birth_date' de todos os contactos. Se hoje e
//      aniversario, envia mensagem.
//
//   3. runPostConsultationFollowupJob (horario)
//      N dias apos Appointment com status COMPLETED, envia mensagem de
//      seguimento se ainda nao houve mensagem no timeline apos a consulta.

import prisma from './prisma';
import { sendWhatsAppOut } from './whatsappSend';

// ============ Reactivacao ============
export async function runReactivationJob(): Promise<void> {
  // Corre no maximo 1x por dia por workspace
  const workspaces = await prisma.workspace.findMany({
    where: { reactivationEnabled: true },
    select: {
      id: true, name: true, timezone: true,
      reactivationDaysThreshold: true, reactivationLastRunAt: true,
      aiSalesEnabled: true, aiSalesMode: true,
      contactLabelSingular: true,
    },
  });

  const now = Date.now();
  for (const ws of workspaces) {
    // Ja correu nas ultimas 22h?
    if (ws.reactivationLastRunAt && (now - ws.reactivationLastRunAt.getTime()) < 22 * 3600_000) continue;

    const daysThreshold = ws.reactivationDaysThreshold || 180;
    const cutoff = new Date(now - daysThreshold * 24 * 3600_000);

    // Pacientes: contactos com pelo menos 1 consulta COMPLETED mas nenhuma
    // no ultimo periodo, e sem consulta futura marcada.
    const candidates = await prisma.contact.findMany({
      where: {
        workspaceId: ws.id,
        appointments: {
          some: { status: 'COMPLETED', startsAt: { lt: cutoff } },
          none: { startsAt: { gte: cutoff } },
        },
        // Sem mensagem OUTBOUND recente (evita enviar a quem ja falamos)
        messages: {
          none: {
            direction: 'OUTBOUND',
            createdAt: { gte: new Date(now - 30 * 24 * 3600_000) },
          },
        },
      },
      select: {
        id: true, firstName: true, lastName: true, whatsapp: true, phone: true,
        appointments: {
          where: { status: 'COMPLETED' },
          orderBy: { startsAt: 'desc' },
          take: 1,
          select: { title: true, startsAt: true },
        },
      },
      take: 50, // rate limit por dia por workspace
    });

    console.log(`[reactivation] workspace=${ws.name} candidates=${candidates.length}`);
    let created = 0;

    for (const c of candidates) {
      const phone = c.whatsapp || c.phone;
      if (!phone) continue;
      const contactLabel = ws.contactLabelSingular || 'paciente';
      const lastAppt = c.appointments[0];
      const daysSince = lastAppt ? Math.floor((now - lastAppt.startsAt.getTime()) / (24 * 3600_000)) : daysThreshold;
      const monthsSince = Math.floor(daysSince / 30);

      // Mensagem generica (sem LLM para poupar tokens: e proactiva simples).
      // Podia usar LLM se quisermos mais personalizacao — deixamos para v2.
      const parts = [
        `Olá ${c.firstName}, notámos que já não a vemos por cá há ${monthsSince > 1 ? `cerca de ${monthsSince} meses` : 'algum tempo'}.`,
        `Está tudo bem? Se quiser reagendar consulta, respondemos por aqui.`,
      ];

      await prisma.aiSalesSuggestion.create({
        data: {
          workspaceId: ws.id,
          contactId: c.id,
          leadId: null,
          triggerMessageId: null,
          parts: parts as any,
          action: 'send_text',
          productFileIds: [] as any,
          reasoning: `Reactivacao proactiva: sem consulta ha ${monthsSince} meses. Ultima: "${lastAppt?.title || 'sem registo'}".`,
          principlesUsed: ['reactivation'] as any,
          modelUsed: 'reactivation-cron',
          status: 'PENDING',
        },
      });
      created++;
    }

    await prisma.workspace.update({
      where: { id: ws.id },
      data: { reactivationLastRunAt: new Date() },
    });
    if (created > 0) {
      console.log(`[reactivation] workspace=${ws.name} created=${created} sugestoes de reactivacao`);
    }
  }
}

// ============ Aniversarios ============
export async function runBirthdayJob(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { birthdayGreetingEnabled: true },
    select: {
      id: true, name: true, timezone: true,
      birthdayGreetingHour: true, birthdayGreetingLastRunAt: true,
      birthdayGreetingTemplate: true,
    },
  });

  const now = new Date();
  for (const ws of workspaces) {
    // Hora local em `timezone` bate certo com birthdayGreetingHour?
    const tz = ws.timezone || 'Africa/Maputo';
    const localHour = parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now),
      10,
    );
    if (localHour !== (ws.birthdayGreetingHour ?? 9)) continue;

    // Ja correu neste dia local?
    if (ws.birthdayGreetingLastRunAt) {
      const lastDay = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(ws.birthdayGreetingLastRunAt);
      const todayDay = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
      if (lastDay === todayDay) continue;
    }

    // Encontrar o CustomField 'birth_date' deste workspace
    const birthField = await prisma.customField.findFirst({
      where: { workspaceId: ws.id, entity: 'contact', key: 'birth_date' },
    });
    if (!birthField) {
      // Sem campo configurado, ignora
      await prisma.workspace.update({ where: { id: ws.id }, data: { birthdayGreetingLastRunAt: new Date() } });
      continue;
    }

    // Dia e mes de hoje em fuso local
    const todayDM = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(now); // "16/07"
    const [todayDay, todayMonth] = todayDM.split('/');

    // Todos os valores do campo birth_date
    const values = await prisma.customFieldValue.findMany({
      where: { fieldId: birthField.id },
      include: { contact: { select: { id: true, firstName: true, whatsapp: true, phone: true } } },
      take: 500,
    });

    const template = ws.birthdayGreetingTemplate || 'Olá {nome}, hoje é o seu dia. Toda a equipa deseja-lhe um feliz aniversário. Um dia cheio de alegria e saúde.';
    let sent = 0;

    for (const v of values) {
      if (!v.contact) continue;
      const d = new Date(v.value);
      if (isNaN(d.getTime())) continue;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      if (dd !== todayDay || mm !== todayMonth) continue;

      const phone = v.contact.whatsapp || v.contact.phone;
      if (!phone) continue;

      const message = template.split('{nome}').join(v.contact.firstName || 'amigo');
      try {
        const result = await sendWhatsAppOut(ws.id, phone, message, 'TEXT');
        await prisma.message.create({
          data: {
            content: message,
            type: 'TEXT',
            direction: 'OUTBOUND',
            channel: 'WHATSAPP',
            status: result.ok ? 'SENT' : 'FAILED',
            externalId: result.externalId,
            contactId: v.contact.id,
          },
        });
        sent++;
        console.log(`[birthday] workspace=${ws.name} ${v.contact.firstName}: enviado`);
      } catch (e: any) {
        console.error(`[birthday] ${v.contact.firstName}: erro:`, e.message);
      }
    }

    await prisma.workspace.update({
      where: { id: ws.id },
      data: { birthdayGreetingLastRunAt: new Date() },
    });
    if (sent > 0) console.log(`[birthday] workspace=${ws.name} sent=${sent}`);
  }
}

// ============ Follow-up pos-consulta ============
export async function runPostConsultFollowupJob(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { postConsultFollowupEnabled: true },
    select: {
      id: true, name: true, timezone: true,
      postConsultFollowupDays: true, postConsultFollowupTemplate: true,
    },
  });

  const now = Date.now();
  for (const ws of workspaces) {
    const days = ws.postConsultFollowupDays || 3;
    // Janela: consultas completadas ha [days-0.5, days+0.5] dias, isto e,
    // consultas cuja completedAt caia num intervalo de 24h centrado em now-days.
    const from = new Date(now - (days + 0.5) * 24 * 3600_000);
    const to = new Date(now - (days - 0.5) * 24 * 3600_000);

    const appts = await prisma.appointment.findMany({
      where: {
        workspaceId: ws.id,
        status: 'COMPLETED',
        // completedAt nao existe no schema; usamos startsAt (aproximado ao momento
        // real da consulta) para essa janela. Assumimos que a consulta durou
        // pouco depois de startsAt.
        startsAt: { gte: from, lte: to },
      },
      include: {
        contact: { select: { id: true, firstName: true, whatsapp: true, phone: true } },
      },
      take: 100,
    });

    if (appts.length === 0) continue;

    const template = ws.postConsultFollowupTemplate ||
      'Olá {nome}, passaram alguns dias desde a sua consulta. Como está a correr? Se tiver alguma dúvida, respondemos por aqui.';
    let sent = 0;

    for (const a of appts) {
      if (!a.contact) continue;
      const phone = a.contact.whatsapp || a.contact.phone;
      if (!phone) continue;

      // Verificar que nao ha mensagem OUTBOUND enviada apos a consulta
      const msgAfter = await prisma.message.findFirst({
        where: {
          contactId: a.contactId,
          direction: 'OUTBOUND',
          createdAt: { gte: a.startsAt },
        },
      });
      if (msgAfter) continue; // ja falamos com ele depois

      const message = template
        .split('{nome}').join(a.contact.firstName || 'amigo')
        .split('{tipo}').join(a.title);

      try {
        const result = await sendWhatsAppOut(ws.id, phone, message, 'TEXT');
        await prisma.message.create({
          data: {
            content: message,
            type: 'TEXT',
            direction: 'OUTBOUND',
            channel: 'WHATSAPP',
            status: result.ok ? 'SENT' : 'FAILED',
            externalId: result.externalId,
            contactId: a.contactId,
          },
        });
        sent++;
      } catch (e: any) {
        console.error(`[postConsultFollowup] ${a.contact.firstName}: erro:`, e.message);
      }
    }

    if (sent > 0) console.log(`[postConsultFollowup] workspace=${ws.name} sent=${sent}`);
  }
}
