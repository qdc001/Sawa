// Arruma no pipeline da Leiz Pro os estudantes ja atendidos (botao no painel).
//
// Para cada contacto com mensagens nos ultimos N dias:
//  - se falou com a Sherone, conta o passo em que ela ficou;
//  - se foi atendido a mao, deduz pelo que a equipa ja enviou: canais de
//    pagamento -> Escolheu o pacote; PDF dos pacotes -> Pacotes enviados;
//    pergunta do online/compromisso -> Apresentacao; so a mensagem do anuncio
//    -> Diagnostico.
// Fica a etapa mais avancada das duas. So avanca e nao mexe em leads fechados.
// Contactos que nao vieram do anuncio nem foram atendidos pelo guia ficam de fora.
// Nao envia mensagens a ninguem.

import prisma from '../prisma';
import { loadState, isTriggerText } from './engine';
import { norm } from './understand';
import { STAGES, stageFor, moveToStage, type StageKey } from './pipeline';

const idx = (k: StageKey | null) => (k ? STAGES.findIndex((s) => s.key === k) : -1);

// De hora a hora (server.ts): o mesmo que o botao, para os ultimos 7 dias,
// em todos os workspaces da Leiz Pro. Assim o que a equipa envia a mao tambem
// move o estudante. So avanca e nao envia mensagens.
let organizing = false;
export async function runOrganizeAll(): Promise<void> {
  if (organizing) return;
  organizing = true;
  try {
    const { leizProWorkspaceIds } = await import('./engine');
    for (const ws of await leizProWorkspaceIds()) {
      await organizeContacts(ws, 7).catch((e) => console.error('[leizpro] organizar automatico falhou:', e?.message || e));
    }
  } finally {
    organizing = false;
  }
}

export async function organizeContacts(workspaceId: string, days = 30): Promise<{ total: number; byStage: Record<string, number> }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const recent = await prisma.message.findMany({
    where: { contact: { workspaceId }, isInternal: false, createdAt: { gte: since } },
    distinct: ['contactId'],
    select: { contactId: true },
    take: 5000,
  });
  const byStage: Record<string, number> = {};
  let total = 0;
  for (const { contactId } of recent) {
    if (!contactId) continue;
    try {
      // 1. O que a Sherone sabe
      const st = await loadState(workspaceId, contactId);
      let key: StageKey | null = st.step === 'start' ? null : stageFor(st);

      // 2. O que a equipa ja enviou a mao
      const msgs = await prisma.message.findMany({
        where: { contactId, isInternal: false },
        orderBy: { createdAt: 'asc' },
        select: { direction: true, content: true, type: true, fileName: true },
        take: 400,
      });
      const out = msgs.filter((m) => m.direction === 'OUTBOUND');
      const outText = norm(out.map((m) => m.content || '').join('\n'));
      let inferred: StageKey | null = null;
      if (/canais de pagamento|871443442|858395481/.test(outText)) inferred = 'chosen';
      else if (out.some((m) => m.type === 'DOCUMENT' && /pacote/i.test(m.fileName || '')) || /enviar.{0,30}pacotes detalhados/.test(outText)) inferred = 'packages';
      else if (/vontade (para|em) estudar online|comprometid/.test(outText)) inferred = 'presentation';
      else {
        const firstIn = msgs.find((m) => m.direction === 'INBOUND');
        if (firstIn && isTriggerText(firstIn.content || '')) inferred = 'diagnosis';
      }

      const best = idx(inferred) > idx(key) ? inferred : key;
      if (!best) continue;
      await moveToStage(workspaceId, contactId, best);
      byStage[best] = (byStage[best] || 0) + 1;
      total += 1;
    } catch (e: any) {
      console.error('[leizpro] organizar falhou para', contactId, e?.message || e);
    }
  }
  const named: Record<string, number> = {};
  for (const s of STAGES) if (byStage[s.key]) named[s.name] = byStage[s.key];
  return { total, byStage: named };
}
