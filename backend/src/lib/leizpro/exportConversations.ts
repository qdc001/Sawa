// Exportacao de todas as conversas de WhatsApp do workspace num so ficheiro de
// texto, com as sugestoes da Leiz Pro intercaladas (o que propos, se foi
// aprovada/editada/descartada, porque, e em que passo do guia estava).
// Serve para analisar como a Leiz Pro se esta a portar em conversas reais.
//
// Os numeros de telefone saem mascarados (so os 4 ultimos digitos): o ficheiro
// e para analise, nao precisa dos contactos completos.

import prisma from '../prisma';

const MAX_MESSAGES = 40_000;

function fmt(d: Date): string {
  // Hora de Maputo (UTC+2), formato curto "21/11 15:31".
  const t = new Date(d.getTime() + 2 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function maskPhone(p: string | null | undefined): string {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 4 ? `…${digits.slice(-4)}` : '-';
}

function indent(text: string, prefix = '      | '): string {
  return text.split('\n').map((l) => prefix + l).join('\n');
}

const STATUS_PT: Record<string, string> = {
  PENDING: 'POR DECIDIR', APPROVED: 'APROVADA', EDITED: 'EDITADA', DISCARDED: 'DESCARTADA', SENT: 'ENVIADA (auto)', FAILED: 'FALHOU',
};
const ACTION_PT: Record<string, string> = {
  send_text: 'responder', handoff: 'passar à equipa', book_appointment: 'marcar chamada', wait: 'não responder',
  send_product: 'enviar ficheiro', create_task: 'criar tarefa',
};

export async function buildConversationsExport(opts: { workspaceId: string; days: number; onlyWithAi: boolean }): Promise<{ text: string; conversations: number }> {
  const since = new Date(Date.now() - opts.days * 86_400_000);

  const [messages, suggestions] = await Promise.all([
    prisma.message.findMany({
      where: { channel: 'WHATSAPP', isInternal: false, createdAt: { gte: since }, contact: { workspaceId: opts.workspaceId } },
      orderBy: { createdAt: 'asc' },
      take: MAX_MESSAGES,
      select: {
        id: true, contactId: true, direction: true, type: true, content: true, transcription: true, fileName: true,
        createdAt: true, sentById: true, sentBy: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, whatsapp: true, phone: true } },
      },
    }),
    prisma.aiSalesSuggestion.findMany({
      where: { workspaceId: opts.workspaceId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, contactId: true, createdAt: true, status: true, action: true, parts: true, finalParts: true,
        reasoning: true, sentMessageIds: true, modelUsed: true, decidedBy: { select: { name: true } },
      },
    }),
  ]);

  // Mensagem enviada -> sugestao que a enviou.
  const sentBy = new Map<string, (typeof suggestions)[number]>();
  for (const s of suggestions) {
    for (const id of (Array.isArray(s.sentMessageIds) ? s.sentMessageIds as string[] : [])) sentBy.set(id, s);
  }

  type Item = { at: Date; kind: 'msg'; m: (typeof messages)[number] } | { at: Date; kind: 'sug'; s: (typeof suggestions)[number] };
  const byContact = new Map<string, Item[]>();
  const contactInfo = new Map<string, { name: string; phone: string }>();
  for (const m of messages) {
    if (!m.contactId) continue;
    if (!byContact.has(m.contactId)) byContact.set(m.contactId, []);
    byContact.get(m.contactId)!.push({ at: m.createdAt, kind: 'msg', m });
    if (!contactInfo.has(m.contactId) && m.contact) {
      contactInfo.set(m.contactId, {
        name: [m.contact.firstName, m.contact.lastName].filter(Boolean).join(' ') || 'Sem nome',
        phone: maskPhone(m.contact.whatsapp || m.contact.phone),
      });
    }
  }
  for (const s of suggestions) {
    if (!byContact.has(s.contactId)) continue; // sugestao sem mensagens no periodo
    byContact.get(s.contactId)!.push({ at: s.createdAt, kind: 'sug', s });
  }

  // Resumo
  const statusCount: Record<string, number> = {};
  const actionCount: Record<string, number> = {};
  const handoffReasons: Record<string, number> = {};
  for (const s of suggestions) {
    statusCount[s.status] = (statusCount[s.status] || 0) + 1;
    actionCount[s.action] = (actionCount[s.action] || 0) + 1;
    if (s.action === 'handoff') {
      const r = String(s.reasoning || '').split(/[.;(]/)[0].trim().slice(0, 90) || 'sem motivo';
      handoffReasons[r] = (handoffReasons[r] || 0) + 1;
    }
  }

  // Etapa actual no pipeline da Leiz Pro (para ajustar depois com "Aplicar etapas").
  const { PIPELINE_NAME } = await import('./pipeline');
  const pipe = await prisma.pipeline.findFirst({ where: { workspaceId: opts.workspaceId, name: PIPELINE_NAME }, select: { id: true } });
  const stageOf = new Map<string, string>();
  if (pipe) {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: opts.workspaceId, pipelineId: pipe.id, contactId: { in: [...byContact.keys()] } },
      orderBy: { createdAt: 'asc' },
      select: { contactId: true, status: true, stage: { select: { name: true } } },
    });
    for (const l of leads) if (l.contactId) stageOf.set(l.contactId, `${l.stage.name}${l.status !== 'OPEN' ? ` (${l.status === 'WON' ? 'ganho' : 'perdido'})` : ''}`);
  }

  const convs = [...byContact.entries()]
    .filter(([, items]) => !opts.onlyWithAi || items.some((i) => i.kind === 'sug'))
    .sort((a, b) => a[1][0].at.getTime() - b[1][0].at.getTime());

  const out: string[] = [];
  out.push('CONVERSAS DE WHATSAPP COM A LEIZ PRO');
  out.push(`Período: últimos ${opts.days} dias (desde ${fmt(since)}), hora de Maputo · exportado em ${fmt(new Date())}`);
  out.push(`Conversas: ${convs.length}${opts.onlyWithAi ? ' (só as que tiveram sugestões da IA)' : ''} · Mensagens: ${messages.length}${messages.length >= MAX_MESSAGES ? ' (limite atingido)' : ''} · Sugestões da IA: ${suggestions.length}`);
  out.push(`Sugestões por estado: ${Object.entries(statusCount).map(([k, v]) => `${STATUS_PT[k] || k} ${v}`).join(' · ') || '-'}`);
  out.push(`Sugestões por acção: ${Object.entries(actionCount).map(([k, v]) => `${ACTION_PT[k] || k} ${v}`).join(' · ') || '-'}`);
  const topHandoff = Object.entries(handoffReasons).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (topHandoff.length) {
    out.push('Motivos de passagem à equipa:');
    for (const [r, n] of topHandoff) out.push(`  ${n}× ${r}`);
  }
  out.push('');
  out.push('Legenda: ESTUDANTE = mensagem recebida · SHERONE = enviada a partir de uma sugestão da IA · EQUIPA = escrita por uma pessoa · [IA] = sugestão da Leiz Pro (o que propôs e o que aconteceu)');

  convs.forEach(([contactId, items], idx) => {
    items.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'msg' ? -1 : 1));
    const info = contactInfo.get(contactId) || { name: 'Sem nome', phone: '-' };
    const sugs = items.filter((i) => i.kind === 'sug') as Array<Extract<Item, { kind: 'sug' }>>;
    const nMsgs = items.length - sugs.length;
    const sStat: Record<string, number> = {};
    for (const i of sugs) sStat[i.s.status] = (sStat[i.s.status] || 0) + 1;
    out.push('');
    out.push('='.repeat(78));
    out.push(`Conversa ${idx + 1}/${convs.length} · ${info.name} · ${info.phone} · ref ${contactId.slice(-8)} · Etapa: ${stageOf.get(contactId) || 'fora do pipeline'} · ${nMsgs} mensagens · IA: ${sugs.length} sugestões${sugs.length ? ` (${Object.entries(sStat).map(([k, v]) => `${v} ${(STATUS_PT[k] || k).toLowerCase()}`).join(', ')})` : ''}`);
    out.push('='.repeat(78));
    for (const it of items) {
      if (it.kind === 'msg') {
        const m = it.m;
        let body = m.content || m.transcription || '';
        if (m.type !== 'TEXT') body = `[${m.type}${m.fileName ? `: ${m.fileName}` : ''}]${body ? ` ${body}` : ''}`;
        let who: string;
        if (m.direction === 'INBOUND') who = 'ESTUDANTE';
        else {
          const s = sentBy.get(m.id);
          if (s) who = s.status === 'EDITED' ? 'SHERONE (editada pela equipa)' : s.status === 'SENT' ? 'SHERONE (automática)' : 'SHERONE';
          else who = `EQUIPA${m.sentBy?.name ? ` (${m.sentBy.name})` : ''}`;
        }
        const lines = (body || '(vazio)').split('\n');
        out.push(`[${fmt(m.createdAt)}] ${who}: ${lines[0]}`);
        for (const l of lines.slice(1)) out.push(`${' '.repeat(14)}${l}`);
      } else {
        const s = it.s;
        const isLeizPro = String(s.modelUsed || '').startsWith('leizpro');
        const decided = s.decidedBy?.name ? `, por ${s.decidedBy.name}` : '';
        out.push(`[${fmt(s.createdAt)}] [IA${isLeizPro ? '' : ': Leizy'}] ${ACTION_PT[s.action] || s.action} · ${STATUS_PT[s.status] || s.status}${decided}`);
        if (s.reasoning) out.push(indent(String(s.reasoning), '      motivo: '));
        const parts = Array.isArray(s.parts) ? (s.parts as string[]) : [];
        // So mostramos o texto proposto quando nao foi enviado tal e qual
        // (o enviado ja aparece como SHERONE): editada, descartada, por decidir, falhou, passagem.
        if (parts.length && s.status !== 'APPROVED' && s.status !== 'SENT') {
          out.push('      proposto:');
          out.push(indent(parts.join('\n---\n')));
        }
        if (s.status === 'EDITED' && Array.isArray(s.finalParts)) {
          out.push('      enviado pela equipa:');
          out.push(indent((s.finalParts as string[]).join('\n---\n')));
        }
      }
    }
  });

  return { text: out.join('\n') + '\n', conversations: convs.length };
}
