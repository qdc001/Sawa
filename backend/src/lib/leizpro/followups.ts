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
//  3. Escolheu o pacote e passou 1 dia sem pagar nem responder: etapa
//     "Follow-up de pagamento" no pipeline.

import prisma from '../prisma';
import {
  isLeizProWorkspace, loadState, reguaDue, generateLeizProFollowup, withContactLock,
} from './engine';
import { decisionSlot, parseTimeChoice, slotLabel } from './schedule';
import { moveToStage, syncStage } from './pipeline';

let running = false;

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

    const since = new Date(Date.now() - 15 * 86_400_000);
    // Candidatos: contactos com sugestoes da Leiz Pro nos ultimos 15 dias.
    const rows = await prisma.aiSalesSuggestion.findMany({
      where: { modelUsed: { startsWith: 'leizpro' }, createdAt: { gte: since } },
      distinct: ['contactId'],
      orderBy: { createdAt: 'desc' },
      select: { workspaceId: true, contactId: true, leadId: true },
      take: 2000,
    });
    for (const r of rows) {
      try {
        if (!(await isLeizProWorkspace(r.workspaceId))) continue;
        const st = await loadState(r.workspaceId, r.contactId);

        const last = await prisma.message.findFirst({
          where: { contactId: r.contactId, isInternal: false },
          orderBy: { createdAt: 'desc' },
          select: { direction: true, createdAt: true },
        });
        // O estudante escreveu e ainda nao lhe respondemos: nao e follow-up.
        if (last?.direction !== 'OUTBOUND') continue;

        // 3. Escolheu o pacote ha mais de 1 dia e nada: follow-up de pagamento.
        if (st.step === 'paying' && Date.now() - last.createdAt.getTime() > 86_400_000) {
          await moveToStage(r.workspaceId, r.contactId, 'payFollowup').catch(() => {});
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
  } finally {
    running = false;
  }
}
