// Agendador da regua de follow-up da Leiz Pro (Fluxo 6 do guia).
//
// Corre a cada minuto:
//  1. Pacotes enviados a mao pela equipa (PDF com "pacote" no nome): arranca a
//     regua a contar do dia combinado na mensagem ("amanha as 18h") ou, sem
//     ele, do dia seguinte as 18h.
//  2. Para cada estudante que recebeu os pacotes e ainda nao respondeu, gera o
//     contacto da regua quando chega a hora (dia combinado, +3 dias, despedida
//     aos 9 dias). Em modo supervisionado fica como sugestao para aprovar; em
//     modo automatico e enviado logo.
//  3. Follow-ups por etapa (guia v31): da pergunta do curso ao comprovativo e
//     no Premio Embaixador, 3 por etapa, a hora conforme os tiques do WhatsApp
//     (fuTiming.ts), e a Reactivacao 2 a 3 semanas depois do 3.o. A etapa
//     "Follow-up de pagamento" muda quando o 1.o de pagamento e enviado.
//  4. Acesso activo (guia v34, Fluxo 7): quando a equipa manda as boas-vindas
//     ("O teu acesso ja esta activo ... ate [DATA DE FIM]"), le as datas e manda
//     a mensagem a meio do acesso e as duas de renovacao.
//
// Ritmo (para o WhatsApp nao restringir o numero, como a 25/11): as mensagens
// por iniciativa da Sherone (regua, follow-ups, acesso) saem so nas janelas
// das 12h-13h e 18h-20h, uma de cada vez, com 6 a 9 minutos entre elas, no
// maximo 8 por hora e 40 por dia (metade ate 03/12, depois da restricao). As
// respostas a quem escreveu nao contam. O que nao couber fica para a vez seguinte.

import prisma from '../prisma';
import {
  isLeizProWorkspace, loadState, reguaDue, accessTurn, loadTextsFor, generateLeizProFollowup, generateLeizProStageFollowup, fuStageOf, withContactLock, cleanupPendingReguaWithoutContext,
} from './engine';
import { decisionSlot, parseTimeChoice, slotLabel } from './schedule';
import { moveToStage, syncStage, syncReguaStage, syncPayStage } from './pipeline';
import { syncReguaTasks, syncPayTask } from './reguaTasks';

import { WELCOME_RE, parseWelcome, accessDue, accessStale } from './access';
import { inSendWindow } from './fuTiming';

const PROACTIVE = ['leizpro:regua', 'leizpro:etapa', 'leizpro:pagamento', 'leizpro:acesso-msg'];
const WARMUP_UNTIL = new Date('2026-12-03T00:00:00+02:00');
export const PACE = { gapMin: 6, gapJitter: 4, perHour: 8, perDay: 40 };

// Pode sair agora mais uma mensagem por iniciativa da Sherone neste workspace?
export async function proactiveSlotFree(workspaceId: string, now = new Date()): Promise<boolean> {
  if (!inSendWindow(now)) return false;
  const warm = now.getTime() < WARMUP_UNTIL.getTime();
  const perHour = warm ? PACE.perHour / 2 : PACE.perHour;
  const perDay = warm ? PACE.perDay / 2 : PACE.perDay;
  const recent = await prisma.aiSalesSuggestion.findMany({
    where: {
      workspaceId, modelUsed: { in: PROACTIVE }, action: { in: ['send_text', 'send_pdf', 'send_product'] },
      status: { notIn: ['DISCARDED', 'FAILED'] }, createdAt: { gte: new Date(now.getTime() - 86_400_000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  if (recent.length >= perDay) return false;
  if (recent.filter((r) => r.createdAt.getTime() > now.getTime() - 3_600_000).length >= perHour) return false;
  const last = recent[0];
  if (last) {
    // 6 a 9 minutos (ate 03/12: 12 a 15), variando de mensagem para mensagem.
    const jitter = [...last.id].reduce((a, c) => a + c.charCodeAt(0), 0) % PACE.gapJitter;
    const gap = ((warm ? 2 * PACE.gapMin : PACE.gapMin) + jitter) * 60_000;
    if (now.getTime() - last.createdAt.getTime() < gap) return false;
  }
  return true;
}

// Sugestoes da Sherone por enviar que ja nao servem: a conversa avancou (alguem
// respondeu depois) ou tem mais de 24 horas (ex.: WhatsApp desligado a 25/11).
async function discardStalePending(): Promise<void> {
  const pend = await prisma.aiSalesSuggestion.findMany({
    where: { status: 'PENDING', modelUsed: { startsWith: 'leizpro' } },
    select: { id: true, contactId: true, createdAt: true },
    take: 500,
  });
  for (const p of pend) {
    const old = p.createdAt.getTime() < Date.now() - 24 * 3_600_000;
    // Mais de 15 minutos: uma sugestao a ser enviada agora (modo automatico) nao conta.
    const answered = !old && p.createdAt.getTime() < Date.now() - 15 * 60_000 && await prisma.message.findFirst({
      where: { contactId: p.contactId, direction: 'OUTBOUND', isInternal: false, createdAt: { gt: p.createdAt } }, select: { id: true },
    });
    if (old || answered) {
      await prisma.aiSalesSuggestion.update({
        where: { id: p.id },
        data: { status: 'DISCARDED', decidedAt: new Date(), errorDetail: old ? 'Descartada: mais de 24 horas por enviar' : 'Descartada: a conversa avançou (já foi respondida)' },
      });
    }
  }
}

let running = false;

async function dispatch(io: any, workspaceId: string, suggestion: any): Promise<void> {
  if (io) io.to(`workspace:${workspaceId}`).emit('aiSales:suggestion', suggestion);
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiSalesMode: true } });
  if (ws?.aiSalesMode === 'auto') {
    const { autoDispatchSuggestion } = await import('../autoDispatchSalesSuggestion');
    await autoDispatchSuggestion(suggestion.id, io);
  }
}

// 4a. Boas-vindas da equipa -> acesso activo (datas de inicio e fim).
async function startAccessFromWelcome(): Promise<void> {
  const since = new Date(Date.now() - 3 * 86_400_000);
  const msgs = await prisma.message.findMany({
    where: {
      direction: 'OUTBOUND', isInternal: false, createdAt: { gte: since },
      OR: [{ content: { contains: 'está activo', mode: 'insensitive' } }, { content: { contains: 'esta activo', mode: 'insensitive' } },
        { content: { contains: 'está ativo', mode: 'insensitive' } }, { content: { contains: 'esta ativo', mode: 'insensitive' } }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, contactId: true, content: true, createdAt: true, contact: { select: { workspaceId: true } } },
    take: 500,
  });
  const seen = new Set<string>();
  for (const m of msgs) {
    if (!m.contactId || seen.has(m.contactId) || !WELCOME_RE.test(m.content || '')) continue;
    seen.add(m.contactId);
    const workspaceId = m.contact?.workspaceId;
    if (!workspaceId || !(await isLeizProWorkspace(workspaceId))) continue;
    const done = await prisma.aiSalesSuggestion.findFirst({
      where: { contactId: m.contactId, actionPayload: { path: ['welcomeMsgId'], equals: m.id } }, select: { id: true },
    });
    if (done) continue;
    const st = await loadState(workspaceId, m.contactId);
    const access = parseWelcome(m.content || '', m.createdAt, st.snMonths, st.examSubjects?.length ? st.examSubjects.join(' e ') : null);
    const next = access
      ? { ...st, step: 'active' as const, access, lastKey: null, lastQuestion: null, retries: 0, fu: null, regua: null, payFollow: null }
      : st;
    const lead = await prisma.lead.findFirst({ where: { contactId: m.contactId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    await prisma.aiSalesSuggestion.create({
      data: {
        workspaceId, contactId: m.contactId, leadId: lead?.id || null,
        parts: [] as any, action: 'wait', productFileIds: [] as any,
        actionPayload: { leizpro: next, welcomeMsgId: m.id } as any,
        reasoning: access
          ? `Boas-vindas enviadas pela equipa: acesso de ${new Date(access.start).toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo' })} a ${new Date(access.end).toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo' })}${access.subjects ? ` (${access.subjects})` : ''}. A Sherone manda a mensagem a meio do acesso e a da renovação.`
          : 'Boas-vindas enviadas pela equipa, mas não consegui ler a data de fim ("até 24/12" ou "até 24 de dezembro") nem sei a duração do pacote: sem mensagens a meio do acesso e de renovação.',
        principlesUsed: [] as any,
        modelUsed: 'leizpro:acesso',
        status: 'APPROVED',
        decidedAt: new Date(),
      },
    });
    if (access) await syncStage(workspaceId, m.contactId, next);
  }
}

// 4b. A meio do acesso e renovacao.
async function runAccessMessages(io: any, disabled: (ws: string, c: string) => Promise<boolean>): Promise<void> {
  const since = new Date(Date.now() - 75 * 86_400_000);
  const rows = await prisma.aiSalesSuggestion.findMany({
    where: { modelUsed: { startsWith: 'leizpro:acesso' }, createdAt: { gte: since } },
    distinct: ['contactId'],
    orderBy: { createdAt: 'desc' },
    select: { workspaceId: true, contactId: true, leadId: true },
    take: 2000,
  });
  for (const r of rows) {
    try {
      if (!(await isLeizProWorkspace(r.workspaceId)) || (await disabled(r.workspaceId, r.contactId))) continue;
      const st = await loadState(r.workspaceId, r.contactId);
      if (st.step !== 'active' || !st.access) continue;
      // O estudante escreveu e ainda nao lhe respondemos: a conversa segue normalmente.
      const last = await prisma.message.findFirst({
        where: { contactId: r.contactId, isInternal: false }, orderBy: { createdAt: 'desc' }, select: { direction: true },
      });
      if (last?.direction !== 'OUTBOUND') continue;
      const replied = st.access.renewAt ? !!(await prisma.message.findFirst({
        where: { contactId: r.contactId, direction: 'INBOUND', isInternal: false, createdAt: { gt: new Date(st.access.renewAt) } }, select: { id: true },
      })) : false;
      const due = accessDue(st.access, replied);
      if (!due || due.at.getTime() > Date.now()) continue;
      const pending = await prisma.aiSalesSuggestion.findFirst({
        where: { contactId: r.contactId, modelUsed: { startsWith: 'leizpro' }, status: 'PENDING', action: { in: ['send_text', 'send_product'] } },
        select: { id: true },
      });
      if (pending) continue;
      const accessFor = `${due.key}:${st.access.end}`;
      const exists = await prisma.aiSalesSuggestion.findFirst({
        where: { contactId: r.contactId, actionPayload: { path: ['accessFor'], equals: accessFor } }, select: { id: true },
      });
      if (exists) continue;
      if (!accessStale(due.key, due.at, st.access) && !(await proactiveSlotFree(r.workspaceId))) continue;
      await withContactLock(r.contactId, async () => {
        await loadTextsFor(r.workspaceId);
        const t = accessTurn(st, due.key);
        // O dia passou (Klaru desligado, por exemplo): salta esta mensagem.
        const stale = accessStale(due.key, due.at, st.access!);
        const { hasPlaceholders } = await import('./engine');
        if (stale || hasPlaceholders(t.parts)) {
          await prisma.aiSalesSuggestion.create({
            data: {
              workspaceId: r.workspaceId, contactId: r.contactId, leadId: r.leadId || null,
              parts: [] as any, action: 'wait', productFileIds: [] as any,
              actionPayload: { leizpro: t.next, accessFor } as any,
              reasoning: stale ? `Acesso activo: a mensagem "${due.key}" já passou do dia (não enviada).` : `Acesso activo: a mensagem "${due.key}" ficou com campos por preencher (disciplinas?): não enviada.`,
              principlesUsed: [] as any, modelUsed: 'leizpro:acesso', status: 'APPROVED', decidedAt: new Date(),
            },
          });
          return;
        }
        const suggestion = await prisma.aiSalesSuggestion.create({
          data: {
            workspaceId: r.workspaceId, contactId: r.contactId, leadId: r.leadId || null,
            parts: t.parts as any, action: 'send_text', productFileIds: [] as any,
            actionPayload: { leizpro: t.next, accessFor } as any,
            reasoning: due.key === 'accessMid' ? 'Acesso activo: contacto a meio do acesso (Fluxo 7).'
              : due.key === 'renew1' ? 'Acesso activo: renovação, 3 dias antes do fim (Fluxo 7).'
              : 'Acesso activo: renovação, no último dia (não respondeu à anterior).',
            principlesUsed: [] as any, modelUsed: 'leizpro:acesso-msg', status: 'PENDING',
          },
        });
        await dispatch(io, r.workspaceId, suggestion);
      });
    } catch (e: any) {
      console.error('[leizpro] acesso activo falhou para', r.contactId, e?.message || e);
    }
  }
}

// 1. Pacotes enviados pela equipa -> regua
async function startReguaForManualPackages(): Promise<void> {
  const since = new Date(Date.now() - 3 * 86_400_000);
  const docs = await prisma.message.findMany({
    where: {
      direction: 'OUTBOUND', isInternal: false, type: 'DOCUMENT', createdAt: { gte: since },
      fileName: { contains: 'pacote', mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, contactId: true, createdAt: true, contact: { select: { workspaceId: true } } },
    take: 500,
  });
  const seen = new Set<string>();
  for (const doc of docs) {
    if (!doc.contactId || seen.has(doc.contactId)) continue;
    seen.add(doc.contactId);
    const workspaceId = doc.contact?.workspaceId;
    if (!workspaceId || !(await isLeizProWorkspace(workspaceId))) continue;
    // Enviado pela Sherone: a regua ja arrancou no envio.
    const bySherone = await prisma.aiSalesSuggestion.findFirst({
      where: { contactId: doc.contactId, sentMessageIds: { array_contains: [doc.id] } }, select: { id: true },
    });
    if (bySherone) continue;
    // Ja tratado (regua manual para este PDF).
    const done = await prisma.aiSalesSuggestion.findFirst({
      where: { contactId: doc.contactId, actionPayload: { path: ['manualPdfId'], equals: doc.id } }, select: { id: true },
    });
    if (done) continue;
    // O estudante ja respondeu depois do PDF: a conversa segue normalmente.
    const replied = await prisma.message.findFirst({
      where: { contactId: doc.contactId, direction: 'INBOUND', isInternal: false, createdAt: { gt: doc.createdAt } }, select: { id: true },
    });

    // Dia combinado: "amanha as 18h" numa mensagem da equipa ate 15 min depois do PDF.
    const near = await prisma.message.findMany({
      where: {
        contactId: doc.contactId, direction: 'OUTBOUND', isInternal: false, type: 'TEXT',
        createdAt: { gte: new Date(doc.createdAt.getTime() - 5 * 60_000), lte: new Date(doc.createdAt.getTime() + 15 * 60_000) },
      },
      select: { content: true },
    });
    const txt = near.map((m) => m.content || '').filter((c) => /amanh|hoje|\d{1,2}\s*h/i.test(c)).join(' ');
    let slot = decisionSlot(doc.createdAt);
    if (txt) {
      const tc = parseTimeChoice(txt, null, doc.createdAt);
      if (tc.kind === 'slot') slot = { iso: tc.at.toISOString(), label: slotLabel(tc.at, doc.createdAt) };
    }

    const st = await loadState(workspaceId, doc.contactId);
    const next = {
      ...st,
      step: 'pdf_sent' as const,
      regua: replied ? null : { startAt: slot.iso, sent: 0 },
      offered: [slot],
      lastKey: 'packagesPdf' as const,
      lastQuestion: 'packagesPdf' as const,
      retries: 0,
    };
    const lead = await prisma.lead.findFirst({ where: { contactId: doc.contactId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    await prisma.aiSalesSuggestion.create({
      data: {
        workspaceId, contactId: doc.contactId, leadId: lead?.id || null,
        parts: [] as any, action: 'wait', productFileIds: [] as any,
        actionPayload: { leizpro: next, manualPdfId: doc.id } as any,
        reasoning: replied
          ? 'Pacotes enviados pela equipa (o estudante ja respondeu: sem regua).'
          : `Pacotes enviados pela equipa: a regua de follow-up conta a partir de ${slot.label}.`,
        principlesUsed: [] as any,
        modelUsed: 'leizpro:regua-manual',
        status: 'APPROVED',
        decidedAt: new Date(),
      },
    });
    await syncStage(workspaceId, doc.contactId, next);
  }
}

export async function runLeizProFollowups(io: any): Promise<void> {
  if (running) return;
  running = true;
  try {
    await startReguaForManualPackages().catch((e) => console.error('[leizpro] regua manual falhou:', e?.message || e));
    await cleanupPendingReguaWithoutContext().catch((e) => console.error('[leizpro] limpeza da regua falhou:', e?.message || e));
    await startAccessFromWelcome().catch((e) => console.error('[leizpro] boas-vindas falhou:', e?.message || e));
    await discardStalePending().catch((e) => console.error('[leizpro] limpeza de pendentes falhou:', e?.message || e));

    // Candidatos: contactos com sugestoes da Leiz Pro nos ultimos 25 dias (a
    // Reactivacao sai 16 dias depois do ultimo follow-up).
    const since = new Date(Date.now() - 25 * 86_400_000);
    const rows = await prisma.aiSalesSuggestion.findMany({
      where: { modelUsed: { startsWith: 'leizpro' }, createdAt: { gte: since } },
      distinct: ['contactId'],
      orderBy: { createdAt: 'desc' },
      select: { workspaceId: true, contactId: true, leadId: true },
      take: 2000,
    });
    const disabledBy = new Map<string, string[]>();
    for (const r of rows) {
      try {
        if (!(await isLeizProWorkspace(r.workspaceId))) continue;
        // Leizy desligada a mao nesta conversa: sem regua.
        if (!disabledBy.has(r.workspaceId)) {
          const ws = await prisma.workspace.findUnique({ where: { id: r.workspaceId }, select: { aiSalesDisabledConversationIds: true } });
          disabledBy.set(r.workspaceId, Array.isArray(ws?.aiSalesDisabledConversationIds) ? ws!.aiSalesDisabledConversationIds as string[] : []);
        }
        if (disabledBy.get(r.workspaceId)!.includes(r.contactId)) continue;
        const st = await loadState(r.workspaceId, r.contactId);
        // Tarefas da regua (cria as que faltam a quem ja estava na regua).
        if (st.regua && st.step === 'pdf_sent') {
          await syncReguaTasks(r.workspaceId, r.contactId, st);
          // "Régua n" so quando o contacto foi mesmo enviado (aprovado ou automatico).
          await syncReguaStage(r.workspaceId, r.contactId, st);
        }

        const last = await prisma.message.findFirst({
          where: { contactId: r.contactId, isInternal: false },
          orderBy: { createdAt: 'desc' },
          select: { direction: true, createdAt: true },
        });
        // O estudante escreveu e ainda nao lhe respondemos: nao e follow-up.
        if (last?.direction !== 'OUTBOUND') continue;

        if (st.step === 'paying') {
          await syncPayStage(r.workspaceId, r.contactId, st);
          await syncPayTask(r.workspaceId, r.contactId, st);
        }
        // 3. Follow-ups por etapa (inclui o pagamento e o Premio Embaixador).
        if (fuStageOf(st)) {
          const pendingFu = await prisma.aiSalesSuggestion.findFirst({
            where: { contactId: r.contactId, modelUsed: { startsWith: 'leizpro' }, status: 'PENDING', action: { in: ['send_text', 'send_product'] } },
            select: { id: true },
          });
          if (!pendingFu && await proactiveSlotFree(r.workspaceId)) {
            await withContactLock(r.contactId, async () => {
              const suggestion = await generateLeizProStageFollowup({ workspaceId: r.workspaceId, contactId: r.contactId, leadId: r.leadId });
              if (!suggestion) return;
              if (io) io.to(`workspace:${r.workspaceId}`).emit('aiSales:suggestion', suggestion);
              const ws = await prisma.workspace.findUnique({ where: { id: r.workspaceId }, select: { aiSalesMode: true } });
              if (ws?.aiSalesMode === 'auto') {
                const { autoDispatchSuggestion } = await import('../autoDispatchSalesSuggestion');
                await autoDispatchSuggestion(suggestion.id, io);
              }
            });
          }
          continue;
        }

        const due = reguaDue(st);
        if (!due || due.getTime() > Date.now()) continue;

        // Ha uma mensagem da Sherone por aprovar: esperar pela equipa.
        const pending = await prisma.aiSalesSuggestion.findFirst({
          where: { contactId: r.contactId, modelUsed: { startsWith: 'leizpro' }, status: 'PENDING', action: { in: ['send_text', 'send_product'] } },
          select: { id: true },
        });
        if (pending) continue;
        if (!(await proactiveSlotFree(r.workspaceId))) continue;

        await withContactLock(r.contactId, async () => {
          const suggestion = await generateLeizProFollowup({ workspaceId: r.workspaceId, contactId: r.contactId, leadId: r.leadId });
          if (!suggestion) return;
          if (io) io.to(`workspace:${r.workspaceId}`).emit('aiSales:suggestion', suggestion);
          const ws = await prisma.workspace.findUnique({ where: { id: r.workspaceId }, select: { aiSalesMode: true } });
          if (ws?.aiSalesMode === 'auto') {
            const { autoDispatchSuggestion } = await import('../autoDispatchSalesSuggestion');
            await autoDispatchSuggestion(suggestion.id, io);
          }
        });
      } catch (e: any) {
        console.error('[leizpro] regua falhou para', r.contactId, e?.message || e);
      }
    }
    const disabledCache = new Map<string, string[]>();
    await runAccessMessages(io, async (ws, c) => {
      if (!disabledCache.has(ws)) {
        const w = await prisma.workspace.findUnique({ where: { id: ws }, select: { aiSalesDisabledConversationIds: true } });
        disabledCache.set(ws, Array.isArray(w?.aiSalesDisabledConversationIds) ? w!.aiSalesDisabledConversationIds as string[] : []);
      }
      return disabledCache.get(ws)!.includes(c);
    }).catch((e) => console.error('[leizpro] acesso activo falhou:', e?.message || e));
  } finally {
    running = false;
  }
}
