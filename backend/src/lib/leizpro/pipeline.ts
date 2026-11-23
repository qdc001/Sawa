// Pipeline da Leiz Pro: cada estudante fica numa etapa conforme o passo do
// guia em que esta. Criado automaticamente na primeira vez.
//
//   Diagnóstico -> Apresentação da Zona Nerd -> Pacotes enviados -> Régua 1/2/3
//   -> Escolheu o pacote (falta pagar) -> Follow-up de pagamento -> Pago
//
// So avanca (nunca puxa um estudante para tras) e nunca mexe em leads que a
// equipa ja fechou (ganho/perdido). "Pago" e a equipa que marca.

import prisma from '../prisma';
import type { LeizProState } from './engine';
import { norm as normBase } from './understand';

export const PIPELINE_NAME = 'Leiz Pro · Zona Nerd';

export const STAGES = [
  { key: 'diagnosis', name: 'Diagnóstico', color: '#6B7280' },
  { key: 'presentation', name: 'Apresentação da Zona Nerd', color: '#3B82F6' },
  { key: 'packages', name: 'Pacotes enviados', color: '#8B5CF6' },
  { key: 'regua1', name: 'Régua 1', color: '#F59E0B' },
  { key: 'regua2', name: 'Régua 2', color: '#F97316' },
  { key: 'regua3', name: 'Régua 3 (despedida)', color: '#EF4444' },
  { key: 'chosen', name: 'Escolheu o pacote (falta pagar)', color: '#10B981' },
  { key: 'payFollowup', name: 'Follow-up de pagamento', color: '#14B8A6' },
  { key: 'paid', name: 'Pago', color: '#22C55E', type: 'WON' as const },
] as const;
export type StageKey = typeof STAGES[number]['key'];

const cache = new Map<string, { pipelineId: string; stageIds: Record<string, string> }>();

async function ensurePipeline(workspaceId: string) {
  const hit = cache.get(workspaceId);
  if (hit) return hit;
  let pipeline = await prisma.pipeline.findFirst({
    where: { workspaceId, name: PIPELINE_NAME },
    include: { stages: true },
  });
  if (!pipeline) {
    const owner = await prisma.user.findFirst({
      where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!owner) return null;
    pipeline = await prisma.pipeline.create({
      data: {
        name: PIPELINE_NAME,
        description: 'Etapas do atendimento da Sherone (Leiz Pro). Os estudantes avançam sozinhos conforme a conversa.',
        color: '#8B5CF6',
        workspaceId,
        createdById: owner.id,
        stages: { create: STAGES.map((s, i) => ({ name: s.name, color: s.color, position: i, type: (s as any).type || 'REGULAR' })) },
      },
      include: { stages: true },
    });
  }
  const stageIds: Record<string, string> = {};
  for (const s of STAGES) {
    let st = pipeline.stages.find((x) => x.name === s.name);
    if (!st) {
      st = await prisma.stage.create({
        data: { name: s.name, color: s.color, position: pipeline.stages.length + STAGES.indexOf(s), type: (s as any).type || 'REGULAR', pipelineId: pipeline.id },
      });
    }
    stageIds[s.key] = st.id;
  }
  const val = { pipelineId: pipeline.id, stageIds };
  cache.set(workspaceId, val);
  return val;
}

// Etapa que corresponde ao estado da conversa (null = nao mexer).
export function stageFor(st: LeizProState): StageKey | null {
  const step = (st.step === 'sn_choice' || st.step === 'sn_activate') ? (st.snReturn || st.step) : st.step;
  if (st.pkg && (st.step === 'paying' || st.paidOnce)) return 'chosen';
  switch (step) {
    case 'start': case 'diagnosis': case 'connection': return 'diagnosis';
    case 'ask_online': case 'ask_commitment': return 'presentation';
    // Recebeu os pacotes. As etapas "Régua 1/2/3" so mudam quando o contacto da
    // regua e mesmo enviado (ver reguaSentCount, no agendador), nao quando a
    // Sherone o prepara (em modo supervisionado fica por aprovar).
    case 'pdf_sent': case 'account_help': case 'followup': return 'packages';
    case 'paying': return 'chosen';
    default: return null;
  }
}

// Poe o lead do estudante na etapa certa (cria-o se for preciso).
export async function moveToStage(workspaceId: string, contactId: string, key: StageKey | null): Promise<void> {
  if (!key) return;
  const p = await ensurePipeline(workspaceId);
  if (!p) return;
  const target = p.stageIds[key];
  const targetPos = STAGES.findIndex((s) => s.key === key);

  let lead = await prisma.lead.findFirst({
    where: { workspaceId, contactId, pipelineId: p.pipelineId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, stageId: true },
  });
  if (!lead) {
    // Lead aberto noutro pipeline: passa para este. Senao, cria um.
    const other = await prisma.lead.findFirst({
      where: { workspaceId, contactId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (other) {
      await prisma.lead.update({ where: { id: other.id }, data: { pipelineId: p.pipelineId, stageId: target } });
      return;
    }
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
    const owner = await prisma.user.findFirst({ where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!owner) return;
    await prisma.lead.create({
      data: {
        title: [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Estudante',
        source: 'Leiz Pro',
        workspaceId, contactId, pipelineId: p.pipelineId, stageId: target, createdById: owner.id,
      },
    });
    return;
  }
  if (lead.status !== 'OPEN') return; // ja fechado pela equipa
  const curPos = Object.entries(p.stageIds).find(([, id]) => id === lead!.stageId)?.[0];
  const curIdx = curPos ? STAGES.findIndex((s) => s.key === curPos) : -1;
  if (curIdx >= targetPos) return; // so avanca
  await prisma.lead.update({ where: { id: lead.id }, data: { stageId: target } });
}

// Quantos contactos desta regua (dia combinado startAt) ja foram mesmo
// enviados ao estudante (automatico, aprovado ou editado e enviado).
export async function reguaSentCount(contactId: string, startAt: string): Promise<number> {
  const rows = await prisma.aiSalesSuggestion.findMany({
    where: {
      contactId, modelUsed: 'leizpro:regua',
      status: { in: ['SENT', 'APPROVED', 'EDITED'] },
      actionPayload: { path: ['followupKey'], string_starts_with: `${startAt}#` },
    },
    select: { sentMessageIds: true },
  });
  return rows.filter((r) => Array.isArray(r.sentMessageIds) && (r.sentMessageIds as any[]).length > 0).length;
}

// Etapa "Follow-up de pagamento" quando o follow-up foi mesmo enviado.
export async function paySentAt(contactId: string): Promise<boolean> {
  const rows = await prisma.aiSalesSuggestion.findMany({
    where: { contactId, modelUsed: 'leizpro:pagamento', status: { in: ['SENT', 'APPROVED', 'EDITED'] } },
    select: { sentMessageIds: true },
  });
  return rows.some((r) => Array.isArray(r.sentMessageIds) && (r.sentMessageIds as any[]).length > 0);
}

export async function syncPayStage(workspaceId: string, contactId: string, st: LeizProState): Promise<void> {
  if (st.step !== 'paying') return;
  if (await paySentAt(contactId)) await moveToStage(workspaceId, contactId, 'payFollowup').catch(() => {});
}

// Etapa "Régua n" conforme os contactos ja enviados.
export async function syncReguaStage(workspaceId: string, contactId: string, st: LeizProState): Promise<void> {
  if (!st.regua) return;
  const n = await reguaSentCount(contactId, st.regua.startAt);
  if (n <= 0) return;
  await moveToStage(workspaceId, contactId, n >= 3 ? 'regua3' : n === 2 ? 'regua2' : 'regua1').catch(() => {});
}

export async function syncStage(workspaceId: string, contactId: string, st: LeizProState): Promise<void> {
  try {
    await moveToStage(workspaceId, contactId, stageFor(st));
  } catch (e: any) {
    console.error('[leizpro] pipeline falhou para', contactId, e?.message || e);
  }
  // Tarefas da regua em Agenda > Tarefas.
  const { syncReguaTasks, syncPayTask } = await import('./reguaTasks');
  await syncReguaTasks(workspaceId, contactId, st);
  await syncPayTask(workspaceId, contactId, st);
}

const normKey = (x: string) => normBase(x).replace(/[^a-z0-9]+/g, ' ').trim();

// "Aplicar etapas" (painel da Leiz): linhas "ref = etapa", com a ref que vem
// no ficheiro das conversas (ultimos 8 caracteres do contacto). Pode mover
// para tras e fechar como ganho ("Pago"), porque e uma decisao da equipa.
export async function applyStages(workspaceId: string, text: string): Promise<{ moved: string[]; errors: string[] }> {
  const p = await ensurePipeline(workspaceId);
  if (!p) return { moved: [], errors: ['Workspace sem dono/administrador para criar o pipeline'] };
  const moved: string[] = [];
  const errors: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 1000);
  for (const line of lines) {
    const m = line.match(/^(?:ref\s*)?([a-z0-9]{6,30})\s*[=:>|-]+\s*(.+)$/i);
    if (!m) { errors.push(`Linha não reconhecida: "${line.slice(0, 60)}"`); continue; }
    const ref = m[1];
    const want = normKey(m[2].replace(/\(.*\)$/, ''));
    const stage = STAGES.find((s) => normKey(s.name) === want) || STAGES.find((s) => normKey(s.name).startsWith(want) && want.length >= 4);
    if (!stage) { errors.push(`${ref}: etapa "${m[2].trim()}" não existe`); continue; }
    const contacts = await prisma.contact.findMany({ where: { workspaceId, id: { endsWith: ref } }, select: { id: true, firstName: true, lastName: true }, take: 2 });
    if (contacts.length !== 1) { errors.push(`${ref}: ${contacts.length ? 'mais de um contacto' : 'contacto não encontrado'}`); continue; }
    const c = contacts[0];
    await moveToStage(workspaceId, c.id, stage.key); // garante que o lead existe neste pipeline
    const lead = await prisma.lead.findFirst({ where: { workspaceId, contactId: c.id, pipelineId: p.pipelineId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!lead) { errors.push(`${ref}: não foi possível criar o lead`); continue; }
    const won = (stage as any).type === 'WON';
    await prisma.lead.update({
      where: { id: lead.id },
      data: { stageId: p.stageIds[stage.key], status: won ? 'WON' : 'OPEN', closedAt: won ? new Date() : null },
    });
    moved.push(`${[c.firstName, c.lastName].filter(Boolean).join(' ') || ref} → ${stage.name}`);
  }
  return { moved, errors };
}
