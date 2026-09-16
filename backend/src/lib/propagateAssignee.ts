// Helper para propagar a atribuição de responsável entre as 4 entidades que a guardam:
//   - Contact.assignedToId            (responsável da ficha do contacto)
//   - ConversationMeta.assignedToId   (responsável da conversa por canal)
//   - Lead.assignedToId               (responsável de cada lead)
//   - Task.assignedToId               (responsável da tarefa ABERTA do contacto)
//
// Quando se atribui um responsável em qualquer um destes pontos, propagamos
// para os outros do MESMO contacto. Isto garante que o filtro de Contactos por
// responsável, a vista de Inbox por agente, e a tarefa aberta ligada a esse
// contacto ficam sempre coerentes — mudar o responsável num sitio e ver outro
// sitio a mostrar outra pessoa era exactamente a queixa de "o CRM troca o
// responsável" que motivou isto.
//
// Notas:
//  - `assignedToId === null` significa "remover responsável". Propaga a
//    limpeza para Contact/ConversationMeta/Lead, mas NAO para Task: o campo
//    Task.assignedToId é obrigatório no schema (uma tarefa tem sempre de ter
//    alguém responsável), por isso um "remover responsável" no contacto
//    simplesmente deixa a tarefa aberta com quem já lá estava.
//  - So tarefas ABERTAS (PENDING/IN_PROGRESS) e nao-subtarefas sao tocadas —
//    o schema garante no máximo uma por contacto. Tarefas concluídas/canceladas
//    ficam com o histórico de quem as fez, não são retroactivamente reatribuídas.
//  - `source` indica qual a entidade que originou a mudança, para não voltar a actualizar essa.
//  - Falhas individuais não bloqueiam (best-effort). Logs no console se algo correr mal.

import prisma from './prisma';
export type AssigneeSource = 'contact' | 'conversation' | 'lead' | 'task';

export async function propagateAssignee(
  workspaceId: string,
  contactId: string,
  assignedToId: string | null,
  source: AssigneeSource,
): Promise<void> {
  if (!contactId) return;
  try {
    const tasks: Promise<any>[] = [];

    if (source !== 'contact') {
      tasks.push(
        prisma.contact
          .updateMany({ where: { id: contactId, workspaceId }, data: { assignedToId } })
          .catch((e) => console.error('propagateAssignee/contact:', e.message)),
      );
    }
    if (source !== 'conversation') {
      tasks.push(
        prisma.conversationMeta
          .updateMany({ where: { contactId, workspaceId }, data: { assignedToId } })
          .catch((e) => console.error('propagateAssignee/conversation:', e.message)),
      );
    }
    if (source !== 'lead') {
      tasks.push(
        prisma.lead
          .updateMany({ where: { contactId, workspaceId }, data: { assignedToId } })
          .catch((e) => console.error('propagateAssignee/lead:', e.message)),
      );
    }
    if (source !== 'task' && assignedToId) {
      tasks.push(
        prisma.task
          .updateMany({
            where: {
              contactId,
              assignedTo: { workspaceId },
              parentTaskId: null,
              status: { in: ['PENDING', 'IN_PROGRESS'] },
            },
            data: { assignedToId },
          })
          .catch((e) => console.error('propagateAssignee/task:', e.message)),
      );
    }

    await Promise.all(tasks);
  } catch (e: any) {
    console.error('propagateAssignee fatal:', e.message);
  }
}
