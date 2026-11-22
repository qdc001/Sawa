// Agendador da regua de follow-up da Leiz Pro (Fluxo 6 do guia).
//
// Corre a cada minuto. Para cada estudante que recebeu os pacotes e ainda nao
// respondeu, gera o contacto da regua quando chega a hora (dia combinado, +3
// dias, despedida aos 9 dias). Em modo supervisionado fica como sugestao para
// aprovar; em modo automatico e enviado logo.
//
// So actua se a ultima mensagem da conversa foi nossa (o estudante nao
// respondeu). Se ele responder, o motor trata e a regua para.

import prisma from '../prisma';
import {
  isLeizProWorkspace, loadState, reguaDue, generateLeizProFollowup, withContactLock,
} from './engine';

let running = false;

export async function runLeizProFollowups(io: any): Promise<void> {
  if (running) return;
  running = true;
  try {
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
        const due = reguaDue(st);
        if (!due || due.getTime() > Date.now()) continue;

        // Ainda ha uma sugestao por aprovar: esperar pela equipa.
        const pending = await prisma.aiSalesSuggestion.findFirst({
          where: { contactId: r.contactId, modelUsed: { startsWith: 'leizpro' }, status: 'PENDING' },
          select: { id: true },
        });
        if (pending) continue;

        // O estudante escreveu e ainda nao lhe respondemos: nao e follow-up.
        const last = await prisma.message.findFirst({
          where: { contactId: r.contactId, isInternal: false },
          orderBy: { createdAt: 'desc' },
          select: { direction: true },
        });
        if (last?.direction !== 'OUTBOUND') continue;

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
