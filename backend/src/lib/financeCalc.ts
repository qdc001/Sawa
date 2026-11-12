// Calculo financeiro do M.E.T.A. (funcao pura). Reproduz a logica da planilha:
// resumo mensal, salarios, carteiras, capital de giro e distribuicao (SEAL).

export const WALLETS = ['M-pesa', 'E-mola', 'BIM', 'Fisico'] as const;
export type Wallet = (typeof WALLETS)[number];

export function normalizeWallet(raw: string | null | undefined): Wallet | null {
  const s = (raw || '').toLowerCase();
  return WALLETS.find((w) => w.toLowerCase() === s) || null;
}

export type FixedSalary = { name: string; amount: number; startPeriod: string; endPeriod?: string | null };

export type FinanceConfig = {
  perNewStudent: number;
  perNewStudentFrom: string;
  workingCapital: number;
  sealPrevidencia: number;
  sealOportunidade: number;
  sealDono: number;
  sealExpansao: number;
  fixedSalaries: FixedSalary[];
  proLabore: number;
  proLaboreFrom: string;
};

export type CalcEntry = {
  period: string; revenue: number; expense: number; potentialRevenue: number;
  commission: number; associateId: string | null; paymentMethod: string | null;
  // Parte final do pacote (preparacao para defesa): comissao que vai para o associado de defesa.
  defenseCommission?: number; defenseAssociateId?: string | null;
};
export type CalcPayroll = {
  period: string; proLabore: number; reinvestment: number; reserve: number; status: string;
  paidMpesa: number; paidEmola: number; paidBim: number;
};
// Pagamento de salario a uma pessoa; sai da carteira indicada no mes do salario.
export type CalcSalaryPayment = { period: string; amount: number; wallet: string | null };
export type CalcInvestment = {
  date: Date | null; investment: number; returnAmount: number; paymentMethod: string | null; fund: string | null;
};

export type WalletLine = { in: number; out: number; salaries: number; net: number };

export type MonthSummary = {
  period: string;
  dre: number; revenue: number; expense: number; balance: number;
  commissions: Record<string, number>; commissionTotal: number;
  newStudents: number; newStudentFee: number; fixedSalaries: number;
  salary: number; proLabore: number; reinvestment: number; reserve: number;
  profit: number; profitPct: number | null;
  toPay: number; paid: number; status: string;
  wallets: Record<Wallet, WalletLine>; walletTotal: number;
  hasActivity: boolean;
};

export type YearSummary = {
  year: string; months: number; activeMonths: number;
  totals: { dre: number; revenue: number; expense: number; balance: number; salary: number; proLabore: number; reinvestment: number; reserve: number; profit: number };
  averages: { dre: number; revenue: number; expense: number; balance: number; salary: number; proLabore: number; profit: number };
  profitPct: number | null;
  wallets: Record<Wallet, number>; walletTotal: number;
};

export type Flow = {
  years: YearSummary[];
  walletTotals: Record<Wallet, number>; total: number;
  workingCapital: number; workingCapitalFilled: number; distributable: number;
  afterCapitalByYear: Record<string, number>;
  funds: Record<'Previdencia' | 'Oportunidade' | 'Dono' | 'Expansao', { pct: number; share: number; withdrawn: number; available: number }>;
};

const emptyWallets = (): Record<Wallet, WalletLine> => ({
  'M-pesa': { in: 0, out: 0, salaries: 0, net: 0 }, 'E-mola': { in: 0, out: 0, salaries: 0, net: 0 },
  BIM: { in: 0, out: 0, salaries: 0, net: 0 }, Fisico: { in: 0, out: 0, salaries: 0, net: 0 },
});

export function periodOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function fixedSalaryTotal(cfg: FinanceConfig, period: string): number {
  return cfg.fixedSalaries
    .filter((s) => period >= s.startPeriod && (!s.endPeriod || period <= s.endPeriod))
    .reduce((a, s) => a + s.amount, 0);
}

export function computeMonths(
  entries: CalcEntry[],
  payrolls: CalcPayroll[],
  studentEntryDates: Array<Date | null>,
  cfg: FinanceConfig,
  salaryPayments: CalcSalaryPayment[] = [],
): MonthSummary[] {
  const payrollBy = new Map(payrolls.map((p) => [p.period, p]));
  const paymentsBy = new Map<string, CalcSalaryPayment[]>();
  for (const sp of salaryPayments) {
    const a = paymentsBy.get(sp.period);
    if (a) a.push(sp); else paymentsBy.set(sp.period, [sp]);
  }
  const entriesBy = new Map<string, CalcEntry[]>();
  for (const e of entries) {
    const a = entriesBy.get(e.period);
    if (a) a.push(e); else entriesBy.set(e.period, [e]);
  }
  const newBy = new Map<string, number>();
  for (const d of studentEntryDates) {
    if (!d) continue;
    const p = periodOf(d);
    newBy.set(p, (newBy.get(p) || 0) + 1);
  }

  const periods = [...new Set([...payrollBy.keys(), ...entriesBy.keys(), ...paymentsBy.keys()])].sort();
  return periods.map((period) => {
    const list = entriesBy.get(period) || [];
    const wallets = emptyWallets();
    let dre = 0, revenue = 0, expense = 0, commissionTotal = 0;
    const commissions: Record<string, number> = {};
    for (const e of list) {
      dre += e.potentialRevenue; revenue += e.revenue; expense += e.expense;
      if (e.associateId) {
        commissions[e.associateId] = (commissions[e.associateId] || 0) + e.commission;
        commissionTotal += e.commission;
      }
      if (e.defenseAssociateId && e.defenseCommission) {
        commissions[e.defenseAssociateId] = (commissions[e.defenseAssociateId] || 0) + e.defenseCommission;
        commissionTotal += e.defenseCommission;
      }
      const w = normalizeWallet(e.paymentMethod);
      if (w) { wallets[w].in += e.revenue; wallets[w].out += e.expense; }
    }
    const row = payrollBy.get(period);
    const proLabore = row ? row.proLabore : (period >= cfg.proLaboreFrom ? cfg.proLabore : 0);
    const reinvestment = row?.reinvestment || 0;
    const reserve = row?.reserve || 0;
    const newStudents = newBy.get(period) || 0;
    const newStudentFee = period >= cfg.perNewStudentFrom ? newStudents * cfg.perNewStudent : 0;
    const fixedSalaries = fixedSalaryTotal(cfg, period);
    const salary = commissionTotal + newStudentFee + fixedSalaries;
    const balance = revenue - expense;
    const profit = balance - (salary + reinvestment + reserve + proLabore);

    // Totais antigos por carteira (planilha ate Maio) + pagamentos por pessoa.
    wallets['M-pesa'].salaries = row?.paidMpesa || 0;
    wallets['E-mola'].salaries = row?.paidEmola || 0;
    wallets.BIM.salaries = row?.paidBim || 0;
    for (const sp of paymentsBy.get(period) || []) {
      const w = normalizeWallet(sp.wallet);
      if (w) wallets[w].salaries += sp.amount;
    }
    const paid = WALLETS.reduce((a, w) => a + wallets[w].salaries, 0);
    const toPay = salary + proLabore;
    const status = row?.status === 'Pago' || (toPay > 0 && paid >= toPay - 1) ? 'Pago' : paid > 0 ? 'Pago em parte' : 'Por pagar';
    let walletTotal = 0;
    for (const w of WALLETS) {
      wallets[w].net = wallets[w].in - wallets[w].out - wallets[w].salaries;
      walletTotal += wallets[w].net;
    }
    return {
      period, dre, revenue, expense, balance, commissions, commissionTotal, newStudents, newStudentFee, fixedSalaries,
      salary, proLabore, reinvestment, reserve, profit, profitPct: revenue ? profit / revenue : null,
      toPay, paid, status, wallets, walletTotal,
      hasActivity: revenue !== 0 || expense !== 0,
    };
  });
}

export function computeFlow(months: MonthSummary[], investments: CalcInvestment[], cfg: FinanceConfig): Flow {
  const years = [...new Set(months.map((m) => m.period.slice(0, 4)))].sort();
  const summaries: YearSummary[] = years.map((year) => {
    const ms = months.filter((m) => m.period.startsWith(year));
    const sum = (f: (m: MonthSummary) => number) => ms.reduce((a, m) => a + f(m), 0);
    const totals = {
      dre: sum((m) => m.dre), revenue: sum((m) => m.revenue), expense: sum((m) => m.expense), balance: sum((m) => m.balance),
      salary: sum((m) => m.salary), proLabore: sum((m) => m.proLabore), reinvestment: sum((m) => m.reinvestment),
      reserve: sum((m) => m.reserve), profit: sum((m) => m.profit),
    };
    const activeMonths = ms.filter((m) => m.hasActivity).length;
    const avg = (v: number) => (activeMonths ? v / activeMonths : 0);
    const wallets = {} as Record<Wallet, number>;
    for (const w of WALLETS) wallets[w] = sum((m) => m.wallets[w].net);
    for (const inv of investments) {
      if (!inv.date || inv.date.getUTCFullYear() !== Number(year)) continue;
      const w = normalizeWallet(inv.paymentMethod);
      if (w) wallets[w] += inv.returnAmount - inv.investment;
    }
    return {
      year, months: ms.length, activeMonths, totals,
      averages: {
        dre: avg(totals.dre), revenue: avg(totals.revenue), expense: avg(totals.expense), balance: avg(totals.balance),
        salary: avg(totals.salary), proLabore: avg(totals.proLabore), profit: avg(totals.profit),
      },
      profitPct: totals.revenue ? totals.profit / totals.revenue : null,
      wallets, walletTotal: WALLETS.reduce((a, w) => a + wallets[w], 0),
    };
  });

  const walletTotals = {} as Record<Wallet, number>;
  for (const w of WALLETS) walletTotals[w] = summaries.reduce((a, y) => a + y.wallets[w], 0);
  const total = WALLETS.reduce((a, w) => a + walletTotals[w], 0);

  const withdrawn = { Previdencia: 0, Oportunidade: 0, Dono: 0, Expansao: 0 };
  for (const inv of investments) {
    if (inv.fund && inv.fund in withdrawn) withdrawn[inv.fund as keyof typeof withdrawn] += inv.investment;
  }
  const allWithdrawn = Object.values(withdrawn).reduce((a, b) => a + b, 0);
  const cg = cfg.workingCapital;
  const distributable = total + allWithdrawn > cg ? total + allWithdrawn - cg : 0;
  const fund = (key: keyof typeof withdrawn, pct: number) => {
    const share = distributable * pct;
    return { pct, share, withdrawn: withdrawn[key], available: share - withdrawn[key] };
  };

  // O capital de giro enche-se pelos anos mais antigos primeiro.
  const afterCapitalByYear: Record<string, number> = {};
  let filled = false;
  for (const y of summaries) {
    const ratio = Math.min(y.walletTotal / cg, 1);
    const used = filled ? 0 : ratio;
    afterCapitalByYear[y.year] = total < cg ? 0 : y.walletTotal - cg * used;
    if (ratio === 1) filled = true;
  }

  return {
    years: summaries, walletTotals, total, workingCapital: cg, workingCapitalFilled: Math.min(total, cg),
    distributable, afterCapitalByYear,
    funds: {
      Previdencia: fund('Previdencia', cfg.sealPrevidencia), Oportunidade: fund('Oportunidade', cfg.sealOportunidade),
      Dono: fund('Dono', cfg.sealDono), Expansao: fund('Expansao', cfg.sealExpansao),
    },
  };
}
