import prisma from './prisma';

// Onde cai o lead de um contacto novo.
// Se o admin escolheu um pipeline/fase ("Contactos novos"), e esse; senao o pipeline padrao, primeira fase (comportamento antigo).
// Devolve no mesmo formato que o findFirst antigo usava: { id, stages: [{ id }] }.
export async function newLeadTarget(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { newLeadPipelineId: true, newLeadStageId: true } });
  if (ws?.newLeadPipelineId && ws.newLeadStageId) {
    const st = await prisma.stage.findFirst({
      where: { id: ws.newLeadStageId, pipelineId: ws.newLeadPipelineId, pipeline: { workspaceId } },
      select: { id: true },
    });
    if (st) return { id: ws.newLeadPipelineId, stages: [{ id: st.id }], configured: true };
  }
  const p = await prisma.pipeline.findFirst({
    where: { workspaceId, isDefault: true },
    include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
  });
  return p ? { id: p.id, stages: p.stages.map((s) => ({ id: s.id })), configured: false } : null;
}

export function contactTitle(c: { firstName?: string | null; lastName?: string | null; whatsapp?: string | null; phone?: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.whatsapp || c.phone || 'Contacto';
}

// Grupos de WhatsApp nao entram no pipeline.
export const notGroup = { NOT: { whatsapp: { contains: '@g.us' } } };

// Contacto criado a mao ou importado: so cria lead se o admin escolheu o pipeline dos contactos novos.
export async function leadForNewContact(
  workspaceId: string,
  contact: { id: string; firstName?: string | null; lastName?: string | null; whatsapp?: string | null; phone?: string | null },
  createdById: string,
  source: string,
) {
  if (contact.whatsapp?.includes('@g.us')) return null;
  const t = await newLeadTarget(workspaceId);
  if (!t?.configured || !t.stages[0]) return null;
  if (await prisma.lead.findFirst({ where: { contactId: contact.id, workspaceId }, select: { id: true } })) return null;
  return prisma.lead.create({
    data: { title: contactTitle(contact), source, workspaceId, pipelineId: t.id, stageId: t.stages[0].id, contactId: contact.id, createdById },
  });
}
