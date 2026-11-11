// Liga os lancamentos de pagamento aos estudantes pelo nome na descricao
// ("Pagamento - Nome") e define o associado de cada estudante pelo comissionista
// do pagamento mais recente.

export type LinkStudent = { id: string; name: string; associateId: string | null };
export type LinkEntry = {
  id: string; description: string | null; revenue: number; associateId: string | null;
  studentId: string | null; period: string; date: Date | null;
};
export type LinkPlan = {
  links: Map<string, string>;            // entryId -> studentId (novas ligacoes)
  associates: Map<string, string>;       // studentId -> associateId (mudancas)
  unmatched: LinkEntry[];
  ambiguous: { entry: LinkEntry; candidates: LinkStudent[] }[];
};

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z]+/g, ' ').trim();

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
const similar = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

// Tira o "Pagamento -" do inicio, mesmo com erros de escrita (Pagamneto, Pagamentp, Pgamaneto...).
export function payerName(description: string | null): string {
  const words = key(description || '').split(' ').filter(Boolean);
  if (words.length > 1 && words[0][0] === 'p' && similar(words[0], 'pagamento') >= 0.6) words.shift();
  return words.join(' ');
}

const isPrefix = (short: string[], long: string[]) => short.length > 0 && short[0].length >= 3 && short.every((w, i) => long[i] === w);

export function planStudentLinks(students: LinkStudent[], entries: LinkEntry[]): LinkPlan {
  const keyed = students.map((s) => ({ s, k: key(s.name), w: key(s.name).split(' ').filter(Boolean) }));
  const byKey = new Map<string, LinkStudent[]>();
  for (const x of keyed) byKey.set(x.k, [...(byKey.get(x.k) || []), x.s]);

  const links = new Map<string, string>();
  const unmatched: LinkEntry[] = [];
  const ambiguous: LinkPlan['ambiguous'] = [];

  for (const e of entries) {
    if (e.studentId || !(e.revenue > 0)) continue;
    const n = payerName(e.description);
    if (!n) continue;
    const nw = n.split(' ');
    // Do mais seguro ao menos seguro; fica no primeiro nivel que encontrar alguem.
    const tiers: (() => LinkStudent[])[] = [
      () => byKey.get(n) || [],
      () => keyed.filter((x) => (nw.length <= x.w.length ? isPrefix(nw, x.w) : isPrefix(x.w, nw))).map((x) => x.s),
      () => keyed.filter((x) => x.k.length >= 4 && similar(n, x.k) >= 0.85).map((x) => x.s),
    ];
    let found: LinkStudent[] = [];
    for (const t of tiers) { found = t(); if (found.length) break; }
    // Nomes repetidos: desempata pelo associado do pagamento.
    if (found.length > 1 && e.associateId) {
      const same = found.filter((s) => s.associateId === e.associateId);
      if (same.length) found = same;
    }
    if (found.length === 1) links.set(e.id, found[0].id);
    else if (!found.length) unmatched.push(e);
    else ambiguous.push({ entry: e, candidates: found });
  }

  // Associado = comissionista do pagamento mais recente com comissionista.
  const latest = new Map<string, { at: string; associateId: string }>();
  for (const e of entries) {
    const sid = e.studentId || links.get(e.id);
    if (!sid || !e.associateId) continue;
    const at = e.date ? e.date.toISOString().slice(0, 10) : `${e.period}-00`;
    const cur = latest.get(sid);
    if (!cur || at >= cur.at) latest.set(sid, { at, associateId: e.associateId });
  }
  const associates = new Map<string, string>();
  for (const s of students) {
    const l = latest.get(s.id);
    if (l && l.associateId !== s.associateId) associates.set(s.id, l.associateId);
  }
  return { links, associates, unmatched, ambiguous };
}
