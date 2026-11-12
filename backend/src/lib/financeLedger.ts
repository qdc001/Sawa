import prisma from './prisma';

// Pacotes do M.E.T.A. A parte final do valor de cada pacote e da preparacao para defesa:
// quando o estudante ja pagou (total - parte), cada metical seguinte conta para o associado de defesa.
export const PACKAGE_TIERS = ['Completo', 'Intermédio', 'Essencial'] as const;
export const DEFAULT_DEFENSE_SHARES: Record<string, number> = { Completo: 5000, 'Intermédio': 4000, Essencial: 3000 };

export function defenseShares(s: { defenseShares?: any }): Record<string, number> {
  const out = { ...DEFAULT_DEFENSE_SHARES };
  const saved = s.defenseShares && typeof s.defenseShares === 'object' ? s.defenseShares : {};
  for (const t of PACKAGE_TIERS) {
    const v = Number(saved[t]);
    if (Number.isFinite(v) && v >= 0) out[t] = v;
  }
  return out;
}

// null = sem pacote; undefined = valor que nao e nenhum pacote.
export function normalizeTier(v: any): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const k = String(v).normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  if (k.startsWith('complet')) return 'Completo';
  if (k.startsWith('intermedi')) return 'Intermédio';
  if (k.startsWith('essencial') || k.startsWith('escencial')) return 'Essencial';
  return undefined;
}

// Quanto de cada pagamento (por ordem) cai na parte final [total - parte, total].
// "start" = o que ja estava pago antes destes pagamentos (estudantes vindos da planilha).
export function splitDefense(total: number, share: number, amounts: number[], start = 0): number[] {
  const part = Math.max(0, Math.min(share, total));
  const from = total - part;
  let paid = start;
  return amounts.map((a) => {
    const start = paid;
    paid += a;
    return part > 0 ? round2(Math.max(0, Math.min(paid, total) - Math.max(start, from))) : 0;
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

// Recalcula um estudante a partir dos lancamentos ligados a ele.
// Com saldo automatico: valor pago, parcelas, estado e a divisao da comissao (normal / defesa).
// Sem saldo automatico (dados antigos da planilha) so desfaz uma divisao que tenha ficado de antes.
export async function recalcStudentLedger(tx: Tx, studentId: string) {
  const st = await tx.financeStudent.findUnique({ where: { id: studentId } });
  if (!st) return;
  const settings = await tx.financeSettings.findUnique({ where: { workspaceId: st.workspaceId } });
  const rate = settings?.commissionRate ?? 0.25;
  const entries = await tx.financeEntry.findMany({
    where: { studentId, type: 'RECEITA' },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  if (!st.ledgerBalance) {
    for (const e of entries) {
      if (!e.defenseAmount && !e.defenseCommission && !e.defenseAssociateId) continue;
      await tx.financeEntry.update({
        where: { id: e.id },
        data: { defenseAmount: 0, defenseCommission: 0, defenseAssociateId: null, commission: e.associateId ? round2(e.revenue * rate) : 0 },
      });
    }
    return;
  }

  const share = st.packageTier && st.defenseAssociateId && settings ? defenseShares(settings)[st.packageTier] || 0 : 0;
  const parts = splitDefense(st.totalValue, share, entries.map((e) => e.revenue), st.openingPaid);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    // Pagamentos antes de "ledgerSince" ficam como estavam: a comissao desses meses ja foi paga.
    if (st.ledgerSince && (!e.date || e.date < st.ledgerSince)) continue;
    const d = parts[i];
    const want = {
      defenseAmount: d,
      defenseCommission: d > 0 ? round2(d * rate) : 0,
      defenseAssociateId: d > 0 ? st.defenseAssociateId : null,
      commission: e.associateId ? round2((e.revenue - d) * rate) : 0,
    };
    if (want.defenseAmount !== e.defenseAmount || want.defenseCommission !== e.defenseCommission
      || want.defenseAssociateId !== e.defenseAssociateId || want.commission !== round2(e.commission)) {
      await tx.financeEntry.update({ where: { id: e.id }, data: want });
    }
  }
  const paid = round2(st.openingPaid + entries.reduce((a, e) => a + e.revenue, 0));
  await tx.financeStudent.update({
    where: { id: st.id },
    data: {
      paidAmount: paid,
      installmentsPaid: st.openingInstallments + entries.length,
      // Se o valor pago nao mudou, mantem o estado que estava (ex.: "Pago" com desconto).
      status: st.totalValue > 0 && paid >= st.totalValue ? 'Pago' : paid === st.paidAmount ? st.status : 'Em aberto',
    },
  });
}

// Passa um estudante antigo (saldo da planilha) para o saldo pelos lancamentos sem mudar o valor pago:
// o que a planilha tem a mais do que os lancamentos ligados fica como "pago antes".
// Devolve null se os lancamentos ligados ja somam mais do que o valor pago (e preciso rever a mao).
export async function openingFor(tx: Tx, st: { id: string; paidAmount: number; installmentsPaid: number }) {
  const agg = await tx.financeEntry.aggregate({ where: { studentId: st.id, type: 'RECEITA' }, _sum: { revenue: true }, _count: { _all: true } });
  return openingFromSums(st, agg._sum.revenue || 0, agg._count._all);
}

export function openingFromSums(st: { paidAmount: number; installmentsPaid: number }, linkedSum: number, linkedCount: number) {
  const linked = round2(linkedSum);
  const openingPaid = round2(st.paidAmount - linked);
  if (openingPaid < -0.01) return { ok: false as const, linked, openingPaid: 0, openingInstallments: 0 };
  return { ok: true as const, linked, openingPaid: Math.max(0, openingPaid), openingInstallments: Math.max(0, st.installmentsPaid - linkedCount) };
}
