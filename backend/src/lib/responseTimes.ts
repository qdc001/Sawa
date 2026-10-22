// Calculo do tempo de resposta por RESPONSAVEL (funcao pura, testavel).
//
// Pergunta que responde: "quanto tempo, em media, os contactos de cada
// responsavel demoram a ser respondidos?" — por quem for (o proprio, um colega,
// o telemovel). Cada intervalo conta para o responsavel DO CONTACTO; contactos
// sem responsavel contam em UNASSIGNED.
//
// Regra: para cada contacto, a PRIMEIRA mensagem do cliente sem resposta
// "abre" uma espera; a primeira resposta (mensagem enviada pelo CRM ou pelo
// telemovel, ou reaccao de um utilizador a uma mensagem do cliente) "fecha".
//  - Agradecimentos/emojis do cliente ("ok", "obrigado", 👍, sticker) nao
//    abrem espera: nao pedem resposta e inflacionavam a media quando a equipa
//    so voltava a escrever dias depois por outro assunto.
//  - Intervalos acima do limite (cap) sao ignorados e contados a parte.

export type BusinessHours = { enabled: boolean; startHour: number; endHour: number; weekdaysOnly: boolean };

export const UNASSIGNED = '__none';

export type MsgRow = {
  contactId: string | null;
  assigneeId?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  sentById: string | null;
  createdAt: Date;
  reactionTimes?: unknown;
  content?: string | null;
  type?: string | null;
};

export type ResponseStats = {
  answeredByCrm: number;
  answeredByPhone: number;
  overCap: number;
  ignoredAcks: number;
  stillWaiting: number;
};

// Milissegundos de [a, b] dentro do horario laboral (tempos em UTC ms).
export function businessMs(a: number, b: number, bh: BusinessHours, offset: number): number {
  if (b <= a) return 0;
  const DAY = 24 * 3600 * 1000;
  const la = a + offset;
  const lb = b + offset;
  let total = 0;
  for (let day = Math.floor(la / DAY) * DAY; day < lb; day += DAY) {
    const dow = new Date(day).getUTCDay(); // 0 = domingo
    if (bh.weekdaysOnly && (dow === 0 || dow === 6)) continue;
    const lo = Math.max(day + bh.startHour * 3600 * 1000, la);
    const hi = Math.min(day + bh.endHour * 3600 * 1000, lb);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

const ACK_WORDS = new Set([
  'ok', 'okay', 'okey', 'oks', 'k', 'kk', 'certo', 'combinado', 'entendido', 'perfeito', 'otimo',
  'obrigado', 'obrigada', 'obg', 'obgd', 'obrigadao', 'valeu', 'show', 'beleza', 'blz', 'fixe',
  'esta bem', 'ta bem', 'amem', 'deus abencoe',
]);
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u;

export function isAcknowledgement(content: string | null | undefined, _type?: string | null): boolean {
  const raw = (content || '').trim();
  if (!raw) return false; // sem texto: pode ser ficheiro, nao e agradecimento
  if (raw === '[Sticker]') return true;
  if (EMOJI_ONLY.test(raw)) return true;
  const norm = raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return true;
  return ACK_WORDS.has(norm);
}

export function computeResponseTimes(
  messages: MsgRow[],
  opts: { from: Date; to: Date; bh: BusinessHours; offset: number; capMs: number },
): {
  perUser: Map<string, number[]>;
  perDay: Map<string, { sum: number; n: number }>; // `${YYYY-MM-DD}|${userId}`
  stats: ResponseStats;
} {
  const { from, to, bh, offset, capMs } = opts;
  type Ev = { t: number; kind: 'in' | 'out' | 'react'; userId: string | null; viaPhone?: boolean; ack?: boolean };
  const assigneeOf = new Map<string, string | null>();
  const byContact = new Map<string, Ev[]>();
  const push = (cid: string, ev: Ev) => {
    const arr = byContact.get(cid);
    if (arr) arr.push(ev); else byContact.set(cid, [ev]);
  };

  for (const m of messages) {
    if (!m.contactId) continue;
    if (!assigneeOf.has(m.contactId)) assigneeOf.set(m.contactId, m.assigneeId ?? null);
    const inbound = m.direction === 'INBOUND';
    push(m.contactId, {
      t: m.createdAt.getTime(),
      kind: inbound ? 'in' : 'out',
      userId: m.sentById,
      viaPhone: !inbound && !m.sentById,
      ack: inbound ? isAcknowledgement(m.content, m.type) : false,
    });
    if (inbound && m.reactionTimes && typeof m.reactionTimes === 'object') {
      for (const [uid, iso] of Object.entries(m.reactionTimes as Record<string, string>)) {
        const rt = new Date(iso).getTime();
        if (Number.isFinite(rt) && rt >= from.getTime() && rt <= to.getTime()) {
          push(m.contactId, { t: rt, kind: 'react', userId: uid });
        }
      }
    }
  }

  const perUser = new Map<string, number[]>();
  const perDay = new Map<string, { sum: number; n: number }>();
  const stats: ResponseStats = { answeredByCrm: 0, answeredByPhone: 0, overCap: 0, ignoredAcks: 0, stillWaiting: 0 };

  for (const [contactId, evs] of byContact.entries()) {
    const who = assigneeOf.get(contactId) || UNASSIGNED;
    // Em empate de hora, a mensagem do cliente vem antes da resposta.
    const rank = (e: Ev) => (e.kind === 'in' ? 0 : 1);
    evs.sort((a, b) => a.t - b.t || rank(a) - rank(b));
    let pending: number | null = null;
    for (const ev of evs) {
      if (ev.kind === 'in') {
        if (ev.ack) { stats.ignoredAcks++; continue; }
        if (pending === null) pending = ev.t;
        continue;
      }
      if (pending === null || ev.t < pending) continue;
      const start = pending;
      pending = null;
      const delta = bh.enabled ? businessMs(start, ev.t, bh, offset) : ev.t - start;
      if (delta < 0) continue;
      if (delta > capMs) { stats.overCap++; continue; }
      if (ev.viaPhone) stats.answeredByPhone++; else stats.answeredByCrm++;
      const arr = perUser.get(who);
      if (arr) arr.push(delta); else perUser.set(who, [delta]);
      const date = new Date(ev.t + offset).toISOString().slice(0, 10);
      const key = `${date}|${who}`;
      const d = perDay.get(key);
      if (d) { d.sum += delta; d.n += 1; } else perDay.set(key, { sum: delta, n: 1 });
    }
    if (pending !== null) stats.stillWaiting++;
  }

  return { perUser, perDay, stats };
}
