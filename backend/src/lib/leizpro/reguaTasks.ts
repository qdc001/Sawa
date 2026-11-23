// Tarefas da regua de follow-up (Agenda > Tarefas).
//
// Quando a regua arranca, cria uma tarefa de Seguimento para cada contacto
// (dia combinado, +3 dias, despedida aos 9 dias), com a data e a hora. Quando a
// Sherone gera esse contacto, a tarefa fica concluida. Se a regua parar (o
// estudante respondeu, escolheu o pacote, passou a equipa...), as tarefas que
// faltam sao apagadas.

import prisma from '../prisma';
import type { LeizProState } from './engine';

const MARK = 'Régua Leiz Pro';
const DAYS = [0, 3, 9];
const TITLES = ['Régua 1/3: perguntar qual pacote', 'Régua 2/3: espaço para um "agora não"', 'Régua 3/3: despedida'];

export async function syncReguaTasks(workspaceId: string, contactId: string, st: LeizProState): Promise<void> {
  try {
    const existing = await prisma.task.findMany({
      where: { contactId, description: { contains: MARK } },
      select: { id: true, status: true, description: true },
    });
    const active = st.regua && st.step === 'pdf_sent' ? st.regua : null;

    // Regua parada: apagar as que faltam (as concluidas ficam no historico).
    if (!active) {
      const pending = existing.filter((t) => t.status !== 'COMPLETED').map((t) => t.id);
      if (pending.length) await prisma.task.deleteMany({ where: { id: { in: pending } } });
      return;
    }

    const tag = (n: number) => `[${MARK} ${active.startAt}#${n}]`;
    // Tarefas de outra regua (outro dia combinado) que ficaram por fazer: fora.
    const stale = existing.filter((t) => t.status !== 'COMPLETED' && !DAYS.some((_, n) => t.description?.includes(tag(n))));
    if (stale.length) await prisma.task.deleteMany({ where: { id: { in: stale.map((t) => t.id) } } });

    // So conta como feito o contacto que foi mesmo enviado ao estudante.
    const { reguaSentCount } = await import('./pipeline');
    const sentCount = await reguaSentCount(contactId, active.startAt);
    let assignee: string | null = null;
    let leadId: string | null = null;
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
    const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Estudante';

    for (let n = 0; n < DAYS.length; n++) {
      const t = existing.find((x) => x.description?.includes(tag(n)));
      const done = n < sentCount;
      if (t) {
        if (done && t.status !== 'COMPLETED') {
          await prisma.task.update({ where: { id: t.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        }
        continue;
      }
      if (done) continue; // ja passou, sem tarefa: nao criar so para a fechar
      if (!assignee) {
        const lead = await prisma.lead.findFirst({ where: { workspaceId, contactId }, orderBy: { createdAt: 'desc' }, select: { id: true, assignedToId: true } });
        leadId = lead?.id || null;
        assignee = lead?.assignedToId || (await prisma.user.findFirst({
          where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' }, select: { id: true },
        }))?.id || null;
        if (!assignee) return;
      }
      const dueAt = new Date(new Date(active.startAt).getTime() + DAYS[n] * 86_400_000);
      await prisma.task.create({
        data: {
          title: `${TITLES[n]} · ${name}`,
          description: `A Sherone gera a mensagem a esta hora (em modo supervisionado fica no Inbox para aprovar). Se o estudante responder antes, a régua pára e esta tarefa desaparece.\n${tag(n)}`,
          type: 'FOLLOW_UP',
          status: 'PENDING',
          priority: n === 2 ? 'LOW' : 'MEDIUM',
          dueAt,
          contactId,
          leadId,
          assignedToId: assignee,
        },
      });
    }
  } catch (e: any) {
    console.error('[leizpro] tarefas da regua falharam para', contactId, e?.message || e);
  }
}

// Tarefa "Follow-up de pagamento": criada quando escolhe o pacote, concluida
// quando o follow-up e enviado, apagada se pagar/sair do passo de pagamento.
const PAY_MARK = 'Pagamento Leiz Pro';
export async function syncPayTask(workspaceId: string, contactId: string, st: LeizProState): Promise<void> {
  try {
    const existing = await prisma.task.findMany({
      where: { contactId, description: { contains: PAY_MARK } },
      select: { id: true, status: true, description: true },
    });
    const active = st.step === 'paying' && st.payFollow && !st.payFollow.skip ? st.payFollow : null;
    if (!active) {
      const pending = existing.filter((t) => t.status !== 'COMPLETED').map((t) => t.id);
      if (pending.length) await prisma.task.deleteMany({ where: { id: { in: pending } } });
      return;
    }
    const tag = `[${PAY_MARK} ${active.at}]`;
    const t = existing.find((x) => x.description?.includes(tag));
    const { paySentAt } = await import('./pipeline');
    const sent = await paySentAt(contactId);
    if (t) {
      if (sent && t.status !== 'COMPLETED') await prisma.task.update({ where: { id: t.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      return;
    }
    if (sent) return;
    const lead = await prisma.lead.findFirst({ where: { workspaceId, contactId }, orderBy: { createdAt: 'desc' }, select: { id: true, assignedToId: true } });
    const assignee = lead?.assignedToId || (await prisma.user.findFirst({
      where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' }, select: { id: true },
    }))?.id;
    if (!assignee) return;
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
    const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Estudante';
    await prisma.task.create({
      data: {
        title: `Follow-up de pagamento · ${name}${st.pkg ? ` (${st.pkg})` : ''}`,
        description: `A Sherone pergunta se conseguiu pagar (em modo supervisionado fica no Inbox para aprovar). Se mandar o comprovativo antes, a tarefa desaparece.\n${tag}`,
        type: 'FOLLOW_UP', status: 'PENDING', priority: 'HIGH',
        dueAt: new Date(active.at), contactId, leadId: lead?.id || null, assignedToId: assignee,
      },
    });
  } catch (e: any) {
    console.error('[leizpro] tarefa de pagamento falhou para', contactId, e?.message || e);
  }
}
