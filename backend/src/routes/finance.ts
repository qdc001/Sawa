import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { computeFlow, computeMonths, FinanceConfig, FixedSalary, normalizeWallet, WALLETS } from '../lib/financeCalc';
import { ParsedWorkbook, parseFinanceWorkbook, reconcile, SalaryPaymentCandidate, suggestSalaryPayments } from '../lib/financeImport';
import { buildXlsx, XlsxSheet } from '../lib/xlsxWriter';
import { planStudentLinks } from '../lib/financeLink';

const router = Router();

const ADMIN_ROLES = ['OWNER', 'ADMIN'];
const FUNDS = ['Dono', 'Previdencia', 'Oportunidade', 'Expansao', 'Empresa'];
const DEFAULT_FIXED: FixedSalary[] = [
  { name: 'Director técnico', amount: 10000, startPeriod: '2025-10' },
  { name: 'Directora comercial', amount: 10000, startPeriod: '2026-01' },
  { name: 'Directora operacional', amount: 15000, startPeriod: '2026-11' },
  { name: 'Director de marketing', amount: 10000, startPeriod: '2026-11' },
];
const ORDINALS = ['Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava'];

// So existe no workspace M.E.T.A.
router.use(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId }, select: { name: true } });
    if (ws?.name.replace(/[^a-z0-9]/gi, '').toLowerCase() !== 'meta') throw new AppError('Não encontrado', 404);
    next();
  } catch (e) { next(e); }
});

function adminOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!ADMIN_ROLES.includes(req.user!.role)) return next(new AppError('Só o dono e administradores têm acesso a esta área.', 403));
  next();
}

const isAdmin = (req: AuthRequest) => ADMIN_ROLES.includes(req.user!.role);

function parseDate(v: any, label = 'Data'): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new AppError(`${label} inválida`, 400);
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new AppError(`${label} inválida`, 400);
  return d;
}
const optDate = (v: any, label?: string) => (v === null || v === '' || v === undefined ? null : parseDate(v, label));
function money(v: any, label = 'Valor'): number {
  const n = v === null || v === undefined || v === '' ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`${label} inválido`, 400);
  return n;
}
const text = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);
function period(v: any): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new AppError('Mês inválido', 400);
  return v;
}
function wallet(v: any): string {
  const w = normalizeWallet(v);
  if (!w) throw new AppError(`Forma de pagamento inválida. Usa: ${WALLETS.join(', ')}`, 400);
  return w;
}

async function getSettings(workspaceId: string) {
  return prisma.financeSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, fixedSalaries: DEFAULT_FIXED as any },
    update: {},
  });
}

function toConfig(s: Awaited<ReturnType<typeof getSettings>>): FinanceConfig {
  return { ...s, fixedSalaries: (s.fixedSalaries as any as FixedSalary[]) || [] };
}

async function ensureMonth(workspaceId: string, p: string, tx: any = prisma) {
  const s = await tx.financeSettings.findUnique({ where: { workspaceId } });
  const proLabore = s && p >= s.proLaboreFrom ? s.proLabore : 0;
  await tx.financePayroll.upsert({
    where: { workspaceId_period: { workspaceId, period: p } },
    create: { workspaceId, period: p, proLabore },
    update: {},
  });
}

async function loadSummary(workspaceId: string) {
  const settings = await getSettings(workspaceId);
  const cfg = toConfig(settings);
  const [entries, payrolls, students, investments, associates, salaryPayments] = await Promise.all([
    prisma.financeEntry.findMany({
      where: { workspaceId },
      select: { period: true, revenue: true, expense: true, potentialRevenue: true, commission: true, associateId: true, paymentMethod: true },
    }),
    prisma.financePayroll.findMany({ where: { workspaceId } }),
    prisma.financeStudent.findMany({ where: { workspaceId }, select: { entryDate: true, sellerCredit: true } }),
    prisma.financeInvestment.findMany({ where: { workspaceId }, select: { date: true, investment: true, returnAmount: true, paymentMethod: true, fund: true } }),
    prisma.financeAssociate.findMany({ where: { workspaceId }, orderBy: { code: 'asc' } }),
    prisma.financeSalaryPayment.findMany({ where: { workspaceId }, orderBy: [{ period: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const months = computeMonths(
    entries, payrolls, students.map((s) => ((s.sellerCredit ?? !!s.entryDate) ? s.entryDate : null)), cfg,
    salaryPayments,
  );
  return { settings, months, flow: computeFlow(months, investments, cfg), associates, salaryPayments };
}

// ---------- Resumo ----------
router.get('/summary', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    res.json(await loadSummary(req.user!.workspaceId));
  } catch (e) { next(e); }
});

router.post('/months', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const p = period(req.body?.period);
    await getSettings(req.user!.workspaceId);
    await ensureMonth(req.user!.workspaceId, p);
    res.status(201).json({ period: p });
  } catch (e) { next(e); }
});

router.patch('/payroll/:period', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const p = period(req.params.period);
    const b = req.body || {};
    const data: any = {};
    for (const k of ['proLabore', 'reinvestment', 'reserve', 'paidMpesa', 'paidEmola', 'paidBim']) {
      if (b[k] !== undefined) data[k] = money(b[k]);
    }
    if (b.status !== undefined) {
      if (!['Pago', 'Por pagar'].includes(b.status)) throw new AppError('Estado inválido', 400);
      data.status = b.status;
      if (b.status === 'Por pagar') Object.assign(data, { paidMpesa: 0, paidEmola: 0, paidBim: 0 });
    }
    await getSettings(workspaceId);
    await ensureMonth(workspaceId, p);
    res.json(await prisma.financePayroll.update({ where: { workspaceId_period: { workspaceId, period: p } }, data }));
  } catch (e) { next(e); }
});

// ---------- Pagamentos de salario (por pessoa e por carteira) ----------
async function salaryPaymentFields(workspaceId: string, b: any, partial: boolean) {
  const d: any = {};
  if (b.period !== undefined || !partial) d.period = period(b.period);
  if (b.payee !== undefined || !partial) {
    d.payee = text(b.payee);
    if (!d.payee) throw new AppError('Indica a pessoa', 400);
    if (d.payee.length > 120) throw new AppError('Nome demasiado longo', 400);
  }
  if (b.associateId !== undefined) {
    d.associateId = text(b.associateId);
    if (d.associateId && !(await prisma.financeAssociate.findFirst({ where: { id: d.associateId, workspaceId } }))) {
      throw new AppError('Associado não encontrado', 400);
    }
  }
  if (b.amount !== undefined || !partial) {
    d.amount = money(b.amount, 'Valor');
    if (!d.amount) throw new AppError('Indica o valor', 400);
  }
  if (b.wallet !== undefined || !partial) d.wallet = wallet(b.wallet);
  if (b.date !== undefined) d.date = optDate(b.date);
  if (b.notes !== undefined) d.notes = text(b.notes);
  return d;
}

router.post('/salary-payments', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const d = await salaryPaymentFields(workspaceId, req.body || {}, false);
    await getSettings(workspaceId);
    await ensureMonth(workspaceId, d.period);
    res.status(201).json(await prisma.financeSalaryPayment.create({ data: { ...d, workspaceId, source: 'crm' } }));
  } catch (e) { next(e); }
});

router.patch('/salary-payments/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const d = await salaryPaymentFields(workspaceId, req.body || {}, true);
    if (d.period) await ensureMonth(workspaceId, d.period);
    const r = await prisma.financeSalaryPayment.updateMany({ where: { id: req.params.id, workspaceId }, data: d });
    if (!r.count) throw new AppError('Pagamento não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/salary-payments/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const r = await prisma.financeSalaryPayment.deleteMany({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!r.count) throw new AppError('Pagamento não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- O meu resumo (colaboradores) ----------
router.get('/me', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const associate = await prisma.financeAssociate.findFirst({ where: { workspaceId, userId: req.user!.id } });
    if (!associate) return res.json({ associate: null, months: [] });
    const rows = await prisma.financeEntry.groupBy({
      by: ['period'], where: { workspaceId, associateId: associate.id },
      _sum: { commission: true, revenue: true }, _count: { _all: true }, orderBy: { period: 'desc' },
    });
    res.json({
      associate: { code: associate.code, name: associate.name },
      months: rows.map((r) => ({ period: r.period, commission: r._sum.commission || 0, revenue: r._sum.revenue || 0, payments: r._count._all })),
    });
  } catch (e) { next(e); }
});

// ---------- Lancamentos ----------
const entryInclude = {
  associate: { select: { id: true, code: true, name: true } },
  student: { select: { id: true, code: true, name: true } },
};

router.get('/entries', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    res.json(await prisma.financeEntry.findMany({
      where: { workspaceId: req.user!.workspaceId, period: period(req.query.period) },
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }));
  } catch (e) { next(e); }
});

async function checkAssociate(workspaceId: string, id: any): Promise<string | null> {
  if (!id) return null;
  const a = await prisma.financeAssociate.findFirst({ where: { id: String(id), workspaceId }, select: { id: true } });
  if (!a) throw new AppError('Associado não encontrado', 400);
  return a.id;
}

router.post('/entries', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const date = parseDate(b.date);
    const type = b.type === 'DESPESA' ? 'DESPESA' : 'RECEITA';
    const amount = money(b.amount);
    if (!amount) throw new AppError('Indica o valor', 400);
    const settings = await getSettings(workspaceId);
    const associateId = type === 'RECEITA' ? await checkAssociate(workspaceId, b.associateId) : null;
    const p = date.toISOString().slice(0, 7);
    await ensureMonth(workspaceId, p);
    const created = await prisma.financeEntry.create({
      data: {
        workspaceId, period: p, date, type, description: text(b.description), category: text(b.category),
        potentialRevenue: type === 'RECEITA' ? money(b.potentialRevenue) : 0,
        revenue: type === 'RECEITA' ? amount : 0, expense: type === 'DESPESA' ? amount : 0,
        commission: associateId ? amount * settings.commissionRate : 0, associateId,
        paymentMethod: wallet(b.paymentMethod), notes: text(b.notes), source: 'crm', createdById: req.user!.id,
      },
      include: entryInclude,
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

function studentAfterPayment(s: { totalValue: number; paidAmount: number }) {
  return s.totalValue > 0 && s.paidAmount >= s.totalValue ? 'Pago' : 'Em aberto';
}

router.patch('/entries/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const cur = await prisma.financeEntry.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Lançamento não encontrado', 404);
    const data: any = {};
    let p = cur.period;
    if (b.date !== undefined) {
      data.date = parseDate(b.date);
      p = data.date.toISOString().slice(0, 7);
      data.period = p;
    }
    if (b.description !== undefined) data.description = text(b.description);
    if (b.category !== undefined) data.category = text(b.category);
    if (b.notes !== undefined) data.notes = text(b.notes);
    if (b.paymentMethod !== undefined) data.paymentMethod = wallet(b.paymentMethod);
    if (b.potentialRevenue !== undefined) data.potentialRevenue = money(b.potentialRevenue);
    const revenue = b.amount !== undefined && cur.type === 'RECEITA' ? money(b.amount) : cur.revenue;
    if (b.amount !== undefined && cur.type === 'DESPESA') data.expense = money(b.amount);
    if (b.amount !== undefined && cur.type === 'RECEITA') data.revenue = revenue;
    let associateId = cur.associateId;
    if (b.associateId !== undefined) {
      associateId = await checkAssociate(workspaceId, b.associateId);
      data.associateId = associateId;
      if (associateId) data.commissionistRaw = null;
    }
    if (b.amount !== undefined || b.associateId !== undefined) {
      const s = await getSettings(workspaceId);
      data.commission = associateId ? revenue * s.commissionRate : 0;
    }
    await ensureMonth(workspaceId, p);
    const updated = await prisma.$transaction(async (tx) => {
      const up = await tx.financeEntry.update({ where: { id: cur.id }, data, include: entryInclude });
      if (cur.studentId && revenue !== cur.revenue) {
        const st = await tx.financeStudent.update({ where: { id: cur.studentId }, data: { paidAmount: { increment: revenue - cur.revenue } } });
        await tx.financeStudent.update({ where: { id: st.id }, data: { status: studentAfterPayment(st) } });
      }
      return up;
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/entries/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.financeEntry.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Lançamento não encontrado', 404);
    await prisma.$transaction(async (tx) => {
      await tx.financeEntry.delete({ where: { id: cur.id } });
      if (cur.studentId) {
        const st = await tx.financeStudent.update({
          where: { id: cur.studentId },
          data: { paidAmount: { decrement: cur.revenue }, installmentsPaid: { decrement: 1 } },
        });
        await tx.financeStudent.update({ where: { id: st.id }, data: { status: studentAfterPayment(st) } });
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Estudantes ----------
function studentDto(s: any) {
  return { ...s, balance: s.totalValue - s.paidAmount };
}

async function scopeStudents(req: AuthRequest): Promise<any> {
  const where: any = { workspaceId: req.user!.workspaceId };
  if (isAdmin(req)) return where;
  const a = await prisma.financeAssociate.findFirst({ where: { workspaceId: req.user!.workspaceId, userId: req.user!.id }, select: { id: true } });
  where.associateId = a?.id || '__nenhum__';
  return where;
}

router.get('/students', async (req: AuthRequest, res: Response, next) => {
  try {
    const list = await prisma.financeStudent.findMany({
      where: await scopeStudents(req),
      include: { associate: { select: { id: true, code: true, name: true } } },
      orderBy: { code: 'desc' },
    });
    res.json(list.map(studentDto));
  } catch (e) { next(e); }
});

function studentFields(b: any) {
  const d: any = {};
  for (const k of ['gender', 'whatsapp', 'faculty', 'course', 'theme', 'notes', 'project', 'origin']) if (b[k] !== undefined) d[k] = text(b[k]);
  if (b.entryDate !== undefined) d.entryDate = optDate(b.entryDate, 'Data de entrada');
  if (b.sellerCredit !== undefined) d.sellerCredit = !!b.sellerCredit;
  if (b.lastActivityAt !== undefined) d.lastActivityAt = optDate(b.lastActivityAt, 'Última actividade');
  if (b.nextDueDate !== undefined) d.nextDueDate = optDate(b.nextDueDate, 'Próxima parcela');
  if (b.totalValue !== undefined) d.totalValue = money(b.totalValue, 'Valor total');
  if (b.installments !== undefined) d.installments = b.installments === '' || b.installments === null ? null : Math.max(1, Math.floor(money(b.installments, 'Nº de parcelas')));
  if (b.currentPhase !== undefined) {
    const f = b.currentPhase === '' || b.currentPhase === null ? null : Number(b.currentPhase);
    if (f !== null && !(Number.isInteger(f) && f >= 1 && f <= 7)) throw new AppError('Fase inválida', 400);
    d.currentPhase = f;
  }
  if (b.phases !== undefined) {
    if (typeof b.phases !== 'object' || b.phases === null) throw new AppError('Fases inválidas', 400);
    d.phases = b.phases;
  }
  return d;
}

router.post('/students', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const name = text(b.name);
    if (!name) throw new AppError('Indica o nome', 400);
    const fields = studentFields(b);
    const codes = await prisma.financeStudent.findMany({ where: { workspaceId }, select: { code: true } });
    const max = codes.reduce((a, c) => Math.max(a, parseInt(c.code.slice(1), 10) || 0), 0);
    const created = await prisma.financeStudent.create({
      data: {
        workspaceId, code: `E${String(max + 1).padStart(3, '0')}`, name,
        associateId: await checkAssociate(workspaceId, b.associateId),
        ...fields,
        // Sem data de entrada o estudante nao contava para a comissao por estudante novo.
        entryDate: fields.entryDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      },
      include: { associate: { select: { id: true, code: true, name: true } } },
    });
    res.status(201).json(studentDto(created));
  } catch (e) { next(e); }
});

router.patch('/students/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const cur = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Estudante não encontrado', 404);
    const data: any = studentFields(b);
    if (b.name !== undefined) {
      data.name = text(b.name);
      if (!data.name) throw new AppError('Indica o nome', 400);
    }
    if (b.associateId !== undefined) data.associateId = await checkAssociate(workspaceId, b.associateId);
    if (b.status !== undefined) {
      if (!['Pago', 'Em aberto'].includes(b.status)) throw new AppError('Estado inválido', 400);
      data.status = b.status;
    }
    if ((data.sellerCredit ?? cur.sellerCredit) && !(data.entryDate !== undefined ? data.entryDate : cur.entryDate)) {
      throw new AppError('Indica a data de entrada para contar a venda.', 400);
    }
    if (b.paidAmount !== undefined) data.paidAmount = money(b.paidAmount, 'Valor pago');
    if (b.installmentsPaid !== undefined) data.installmentsPaid = Math.floor(money(b.installmentsPaid, 'Parcelas pagas'));
    const up = await prisma.financeStudent.update({
      where: { id: cur.id }, data, include: { associate: { select: { id: true, code: true, name: true } } },
    });
    res.json(studentDto(up));
  } catch (e) { next(e); }
});

router.delete('/students/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Estudante não encontrado', 404);
    await prisma.financeStudent.delete({ where: { id: cur.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Liga os lancamentos aos estudantes e acerta o associado pelo comissionista. apply=false so mostra.
router.post('/students/link', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const [students, entries, associates] = await Promise.all([
      prisma.financeStudent.findMany({ where: { workspaceId }, select: { id: true, code: true, name: true, associateId: true } }),
      prisma.financeEntry.findMany({
        where: { workspaceId },
        select: { id: true, description: true, revenue: true, associateId: true, studentId: true, period: true, date: true, commissionistRaw: true },
        orderBy: [{ period: 'asc' }, { date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.financeAssociate.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    ]);
    const plan = planStudentLinks(students, entries);
    const aName = new Map(associates.map((a) => [a.id, a.name]));
    const st = new Map(students.map((s) => [s.id, s]));
    const entryDto = (e: (typeof entries)[number]) => ({
      id: e.id, period: e.period, date: e.date, description: e.description, revenue: e.revenue,
      commissionist: e.associateId ? aName.get(e.associateId) || null : e.commissionistRaw,
    });
    if (req.body?.apply === true) {
      const byStudent = new Map<string, string[]>();
      for (const [eid, sid] of plan.links) byStudent.set(sid, [...(byStudent.get(sid) || []), eid]);
      await prisma.$transaction(async (tx) => {
        for (const [sid, ids] of byStudent) await tx.financeEntry.updateMany({ where: { id: { in: ids }, workspaceId }, data: { studentId: sid } });
        for (const [sid, aid] of plan.associates) await tx.financeStudent.update({ where: { id: sid }, data: { associateId: aid } });
      }, { timeout: 120000, maxWait: 20000 });
    }
    res.json({
      applied: req.body?.apply === true,
      payments: entries.filter((e) => e.revenue > 0).length,
      alreadyLinked: entries.filter((e) => e.studentId).length,
      newLinks: plan.links.size,
      associateChanges: [...plan.associates].map(([sid, aid]) => {
        const s = st.get(sid)!;
        return { code: s.code, name: s.name, from: s.associateId ? aName.get(s.associateId) || null : null, to: aName.get(aid) || null };
      }).sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true })),
      unmatched: plan.unmatched.map(entryDto).reverse(),
      ambiguous: plan.ambiguous.map((a) => ({ ...entryDto(a.entry as any), candidates: a.candidates.map((c) => `${st.get(c.id)?.code} ${c.name}`) })).reverse(),
    });
  } catch (e) { next(e); }
});

// Registo unico: entra no mes do pagamento, conta os 25% nesse mes e actualiza as parcelas.
router.post('/students/:id/payments', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const date = parseDate(b.date);
    const amount = money(b.amount);
    if (!amount) throw new AppError('Indica o valor', 400);
    const method = wallet(b.paymentMethod);
    const nextDueDate = optDate(b.nextDueDate, 'Próxima parcela');
    const settings = await getSettings(workspaceId);
    const st = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!st) throw new AppError('Estudante não encontrado', 404);
    const associateId = b.associateId !== undefined ? await checkAssociate(workspaceId, b.associateId) : st.associateId;
    const p = date.toISOString().slice(0, 7);
    const first = st.installmentsPaid === 0;
    await ensureMonth(workspaceId, p);
    const paid = st.paidAmount + amount;
    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.financeEntry.create({
        data: {
          workspaceId, period: p, date, type: 'RECEITA', description: `Pagamento - ${st.name}`, category: st.project,
          potentialRevenue: first ? st.totalValue : 0, revenue: amount,
          commission: associateId ? amount * settings.commissionRate : 0, associateId, paymentMethod: method,
          notes: text(b.notes) || `${ORDINALS[st.installmentsPaid] || `${st.installmentsPaid + 1}.ª`} parcela`,
          studentId: st.id, source: 'crm', createdById: req.user!.id,
        },
      });
      const student = await tx.financeStudent.update({
        where: { id: st.id },
        data: {
          paidAmount: paid, installmentsPaid: st.installmentsPaid + 1, nextDueDate,
          status: studentAfterPayment({ totalValue: st.totalValue, paidAmount: paid }),
        },
        include: { associate: { select: { id: true, code: true, name: true } } },
      });
      return { entry, student };
    });
    res.status(201).json({ entry: result.entry, student: studentDto(result.student) });
  } catch (e) { next(e); }
});

// Painel e estatisticas do programa
router.get('/academic', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const where = await scopeStudents(req);
    const [students, associates] = await Promise.all([
      prisma.financeStudent.findMany({
        where, select: { associateId: true, currentPhase: true, lastActivityAt: true, phases: true, project: true, origin: true, paidAmount: true },
      }),
      prisma.financeAssociate.findMany({ where: { workspaceId }, orderBy: { code: 'asc' } }),
    ]);
    const now = Date.now();
    const inactive = (d: Date | null) => (d ? Math.floor((now - d.getTime()) / 86400000) : null);
    const phaseCounts = [1, 2, 3, 4, 5, 6, 7].map((f) => students.filter((s) => s.currentPhase === f).length);
    const states: Record<string, number> = { Entregue: 0, 'Em curso': 0, Pendente: 0, Atrasado: 0, Bloqueado: 0 };
    let deliveredF7 = 0;
    for (const s of students) {
      for (const [f, v] of Object.entries((s.phases as any) || {})) {
        const st = (v as any)?.status;
        if (st && st in states) states[st]++;
        if (f === '7' && st === 'Entregue') deliveredF7++;
      }
    }
    const withPhase = students.filter((s) => s.currentPhase);
    const byAssociate = associates.map((a) => {
      const own = students.filter((s) => s.associateId === a.id);
      return {
        id: a.id, code: a.code, name: a.name, whatsapp: a.whatsapp, userId: a.userId,
        total: own.length,
        early: own.filter((s) => s.currentPhase && s.currentPhase <= 3).length,
        middle: own.filter((s) => s.currentPhase && s.currentPhase >= 4 && s.currentPhase <= 6).length,
        final: own.filter((s) => s.currentPhase === 7).length,
        alerts: own.filter((s) => (inactive(s.lastActivityAt) ?? 0) > 14).length,
        completed: own.filter((s) => s.currentPhase === 7 && (s.phases as any)?.['7']?.status === 'Entregue').length,
      };
    });
    const group = (key: 'project' | 'origin') => {
      const m = new Map<string, { count: number; value: number }>();
      for (const s of students) {
        const k = s[key] || 'Sem indicação';
        const c = m.get(k) || { count: 0, value: 0 };
        c.count++; c.value += s.paidAmount;
        m.set(k, c);
      }
      return [...m].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
    };
    res.json({
      total: students.length,
      averagePhase: withPhase.length ? Math.round((withPhase.reduce((a, s) => a + (s.currentPhase || 0), 0) / withPhase.length) * 10) / 10 : 0,
      deliveredF7,
      active: students.filter((s) => s.currentPhase && s.currentPhase < 7).length,
      alerts: students.filter((s) => (inactive(s.lastActivityAt) ?? 0) > 14).length,
      phaseCounts, states, byAssociate, byProject: group('project'), byOrigin: group('origin'),
    });
  } catch (e) { next(e); }
});

// ---------- Associados ----------
router.post('/associates', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const name = text(b.name);
    if (!name) throw new AppError('Indica o nome', 400);
    const codes = await prisma.financeAssociate.findMany({ where: { workspaceId }, select: { code: true } });
    const max = codes.reduce((a, c) => Math.max(a, parseInt(c.code.slice(1), 10) || 0), 0);
    res.status(201).json(await prisma.financeAssociate.create({
      data: { workspaceId, code: `A${String(max + 1).padStart(2, '0')}`, name, whatsapp: text(b.whatsapp), userId: await checkUser(workspaceId, b.userId) },
    }));
  } catch (e) { next(e); }
});

async function checkUser(workspaceId: string, id: any): Promise<string | null> {
  if (!id) return null;
  const u = await prisma.user.findFirst({ where: { id: String(id), workspaceId }, select: { id: true } });
  if (!u) throw new AppError('Utilizador não encontrado', 400);
  return u.id;
}

router.patch('/associates/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const cur = await prisma.financeAssociate.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Associado não encontrado', 404);
    const data: any = {};
    if (b.name !== undefined) {
      data.name = text(b.name);
      if (!data.name) throw new AppError('Indica o nome', 400);
    }
    if (b.whatsapp !== undefined) data.whatsapp = text(b.whatsapp);
    if (b.userId !== undefined) data.userId = await checkUser(workspaceId, b.userId);
    res.json(await prisma.financeAssociate.update({ where: { id: cur.id }, data }));
  } catch (e) { next(e); }
});

router.delete('/associates/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.financeAssociate.findFirst({
      where: { id: req.params.id, workspaceId }, include: { _count: { select: { entries: true, students: true } } },
    });
    if (!cur) throw new AppError('Associado não encontrado', 404);
    if (cur._count.entries || cur._count.students) throw new AppError('Este associado tem estudantes ou comissões registadas e não pode ser eliminado.', 400);
    await prisma.financeAssociate.delete({ where: { id: cur.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Investimentos ----------
function investmentFields(b: any) {
  const d: any = {};
  if (b.date !== undefined) d.date = optDate(b.date);
  if (b.description !== undefined) d.description = text(b.description);
  if (b.investment !== undefined) d.investment = money(b.investment, 'Investimento');
  if (b.returnAmount !== undefined) d.returnAmount = money(b.returnAmount, 'Retorno');
  if (b.potentialReturn !== undefined) d.potentialReturn = money(b.potentialReturn, 'Retorno potencial');
  if (b.paymentMethod !== undefined) d.paymentMethod = wallet(b.paymentMethod);
  if (b.notes !== undefined) d.notes = text(b.notes);
  if (b.fund !== undefined) {
    d.fund = text(b.fund);
    if (d.fund && !FUNDS.includes(d.fund)) throw new AppError('Fundo inválido', 400);
  }
  return d;
}

router.get('/investments', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    res.json(await prisma.financeInvestment.findMany({
      where: { workspaceId: req.user!.workspaceId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }));
  } catch (e) { next(e); }
});

router.post('/investments', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const d = investmentFields(req.body || {});
    if (!d.date) throw new AppError('Indica a data', 400);
    if (!d.paymentMethod) throw new AppError('Indica a forma de pagamento', 400);
    res.status(201).json(await prisma.financeInvestment.create({ data: { ...d, workspaceId: req.user!.workspaceId } }));
  } catch (e) { next(e); }
});

router.patch('/investments/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const r = await prisma.financeInvestment.updateMany({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId }, data: investmentFields(req.body || {}),
    });
    if (!r.count) throw new AppError('Registo não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/investments/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const r = await prisma.financeInvestment.deleteMany({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!r.count) throw new AppError('Registo não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Cupoes ----------
function couponStatus(c: { maxUses: number; usedCount: number; validUntil: Date | null }) {
  if (c.maxUses <= c.usedCount) return 'Usado';
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return c.validUntil && c.validUntil >= today ? 'Aberto' : 'Expirou';
}

router.get('/coupons', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const list = await prisma.financeCoupon.findMany({ where: { workspaceId: req.user!.workspaceId } });
    const num = (c: string) => parseInt(c.match(/(\d+)$/)?.[1] || '0', 10);
    list.sort((a, b) => num(b.code) - num(a.code));
    res.json(list.map((c) => ({ ...c, status: couponStatus(c) })));
  } catch (e) { next(e); }
});

router.post('/coupons', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const s = await getSettings(workspaceId);
    const existing = await prisma.financeCoupon.findMany({ where: { workspaceId }, select: { code: true } });
    const max = existing.reduce((a, c) => Math.max(a, parseInt(c.code.match(/(\d+)$/)?.[1] || '0', 10)), 0);
    const discount = b.discount !== undefined ? money(b.discount, 'Desconto') : s.couponDiscount;
    const validUntil = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    validUntil.setUTCDate(validUntil.getUTCDate() + s.couponValidityDays);
    const c = await prisma.financeCoupon.create({
      data: { workspaceId, code: `META${Math.round(discount)}-${max + 1}`, discount, validUntil, clientName: text(b.clientName) },
    });
    res.status(201).json({ ...c, status: couponStatus(c) });
  } catch (e) { next(e); }
});

router.patch('/coupons/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const b = req.body || {};
    const data: any = {};
    if (b.clientName !== undefined) data.clientName = text(b.clientName);
    if (b.validUntil !== undefined) data.validUntil = optDate(b.validUntil, 'Validade');
    if (b.usedAt !== undefined) data.usedAt = optDate(b.usedAt, 'Data de uso');
    if (b.usedCount !== undefined) data.usedCount = Math.floor(money(b.usedCount, 'Usos'));
    if (b.maxUses !== undefined) data.maxUses = Math.max(1, Math.floor(money(b.maxUses, 'Quantidade máxima')));
    if (b.discount !== undefined) data.discount = money(b.discount, 'Desconto');
    const r = await prisma.financeCoupon.updateMany({ where: { id: req.params.id, workspaceId: req.user!.workspaceId }, data });
    if (!r.count) throw new AppError('Cupão não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/coupons/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const r = await prisma.financeCoupon.deleteMany({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!r.count) throw new AppError('Cupão não encontrado', 404);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Definicoes ----------
router.put('/settings', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    await getSettings(workspaceId);
    const data: any = {};
    for (const k of ['perNewStudent', 'workingCapital', 'proLabore', 'couponDiscount']) if (b[k] !== undefined) data[k] = money(b[k]);
    for (const k of ['commissionRate', 'sealPrevidencia', 'sealOportunidade', 'sealDono', 'sealExpansao']) {
      if (b[k] !== undefined) {
        const v = money(b[k]);
        if (v > 1) throw new AppError('As percentagens têm de estar entre 0 e 100%', 400);
        data[k] = v;
      }
    }
    if (b.perNewStudentName !== undefined) data.perNewStudentName = text(b.perNewStudentName) || 'Lucília';
    if (b.perNewStudentFrom !== undefined) data.perNewStudentFrom = period(b.perNewStudentFrom);
    if (b.proLaboreFrom !== undefined) data.proLaboreFrom = period(b.proLaboreFrom);
    if (b.couponValidityDays !== undefined) data.couponValidityDays = Math.max(1, Math.floor(money(b.couponValidityDays)));
    if (b.fixedSalaries !== undefined) {
      if (!Array.isArray(b.fixedSalaries)) throw new AppError('Salários fixos inválidos', 400);
      data.fixedSalaries = b.fixedSalaries.map((s: any) => {
        const name = text(s?.name);
        if (!name) throw new AppError('Cada salário fixo precisa de um nome', 400);
        return { name, amount: money(s.amount), startPeriod: period(s.startPeriod), endPeriod: s.endPeriod ? period(s.endPeriod) : null };
      });
    }
    res.json(await prisma.financeSettings.update({ where: { workspaceId }, data }));
  } catch (e) { next(e); }
});

// ---------- Exportacao ----------
router.get('/export', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const [{ settings, months, flow, associates, salaryPayments }, entries, students, investments, coupons] = await Promise.all([
      loadSummary(workspaceId),
      prisma.financeEntry.findMany({ where: { workspaceId }, include: { associate: { select: { name: true } }, student: { select: { code: true } } }, orderBy: [{ period: 'desc' }, { date: 'desc' }] }),
      prisma.financeStudent.findMany({ where: { workspaceId }, include: { associate: { select: { code: true, name: true } } }, orderBy: { code: 'desc' } }),
      prisma.financeInvestment.findMany({ where: { workspaceId }, orderBy: { date: 'desc' } }),
      prisma.financeCoupon.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const credit = settings.perNewStudentName;
    const sheets: XlsxSheet[] = [
      { name: 'Resumo mensal', rows: [
        ['Mês', 'DRE', 'Receita', 'Despesa', 'Saldo', 'Comissões', `Vendas ${credit}`, 'Salários fixos', 'Total salários', 'Pró-labore', 'Reinvestimento', 'Imprevistos', 'Lucro líquido', '% Lucro', 'Situação', 'Pago'],
        ...months.map((m) => [m.period, m.dre, m.revenue, m.expense, m.balance, m.commissionTotal, m.newStudentFee, m.fixedSalaries, m.salary, m.proLabore, m.reinvestment, m.reserve, m.profit, m.profitPct, m.status, m.paid]),
      ] },
      { name: 'Fluxo anual', rows: [
        ['Ano', 'DRE', 'Receita', 'Despesa', 'Saldo', 'Salários', 'Pró-labore', 'Lucro líquido', '% Lucro', ...WALLETS, 'Total carteiras'],
        ...flow.years.map((y) => [y.year, y.totals.dre, y.totals.revenue, y.totals.expense, y.totals.balance, y.totals.salary, y.totals.proLabore, y.totals.profit, y.profitPct, ...WALLETS.map((w) => y.wallets[w]), y.walletTotal]),
      ] },
      { name: 'SEAL', rows: [
        ['Fundo', '%', 'Parte', 'Já levantado', 'Disponível'],
        ...Object.entries(flow.funds).map(([k, f]) => [k, f.pct, f.share, f.withdrawn, f.available]),
        [], ['Dinheiro existente', flow.total], ['Capital de giro', flow.workingCapitalFilled], ['Valor a distribuir', flow.distributable],
      ] },
      { name: 'Carteiras por mês', rows: [
        ['Mês', ...WALLETS, 'Total'], ...months.map((m) => [m.period, ...WALLETS.map((w) => m.wallets[w].net), m.walletTotal]),
      ] },
      { name: 'Comissões', rows: [
        ['Mês', credit, ...associates.map((a) => a.name), 'Total'],
        ...months.map((m) => [m.period, m.newStudentFee, ...associates.map((a) => m.commissions[a.id] || 0), m.commissionTotal + m.newStudentFee]),
      ] },
      { name: 'Lançamentos', rows: [
        ['Mês', 'Data', 'Descrição', 'Tipo', 'Categoria', 'Receita potencial', 'Despesa', 'Receita', 'Comissionista', 'Comissão', 'Forma de pagamento', 'Observações', 'Estudante'],
        ...entries.map((e) => [e.period, e.date, e.description, e.type, e.category, e.potentialRevenue, e.expense, e.revenue, e.associate?.name || e.commissionistRaw, e.commission, e.paymentMethod, e.notes, e.student?.code]),
      ] },
      { name: 'Estudantes', rows: [
        ['ID', 'Nome', 'Género', 'WhatsApp', 'Associado', 'Faculdade', 'Curso', 'Tema', 'Data de entrada', `Venda ${credit}`, 'Fase actual', 'Última actividade', 'Projecto', 'Origem', 'Valor total', 'Nº parcelas', 'Parcelas pagas', 'Valor pago', 'Saldo', 'Próxima parcela', 'Estado', 'Notas'],
        ...students.map((s) => [s.code, s.name, s.gender, s.whatsapp, s.associate?.name, s.faculty, s.course, s.theme, s.entryDate, (s.sellerCredit ?? !!s.entryDate) ? 'Sim' : 'Não', s.currentPhase, s.lastActivityAt, s.project, s.origin, s.totalValue, s.installments, s.installmentsPaid, s.paidAmount, s.totalValue - s.paidAmount, s.nextDueDate, s.status, s.notes]),
      ] },
      { name: 'Pagamentos de salários', rows: [
        ['Mês do salário', 'Pessoa', 'Valor', 'Carteira', 'Data', 'Observação'],
        ...salaryPayments.map((s) => [s.period, s.payee, s.amount, s.wallet, s.date, s.notes]),
      ] },
      { name: 'Associados', rows: [['Código', 'Nome', 'WhatsApp'], ...associates.map((a) => [a.code, a.name, a.whatsapp])] },
      { name: 'Investimentos', rows: [
        ['Data', 'Descrição', 'Investimento', 'Retorno', 'Retorno potencial', 'Forma de pagamento', 'Fundo', 'Observação'],
        ...investments.map((i) => [i.date, i.description, i.investment, i.returnAmount, i.potentialReturn, i.paymentMethod, i.fund, i.notes]),
      ] },
      { name: 'Cupões', rows: [
        ['Código', 'Desconto', 'Válido até', 'Máx.', 'Usos', 'Cliente', 'Data de uso', 'Estado'],
        ...coupons.map((c) => [c.code, c.discount, c.validUntil, c.maxUses, c.usedCount, c.clientName, c.usedAt, couponStatus(c)]),
      ] },
    ];
    const file = await buildXlsx(sheets);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="financas-meta-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(file);
  } catch (e) { next(e); }
});

// ---------- Importacao da planilha ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['.xlsm', '.xlsx'].includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new AppError('Envia o ficheiro Excel (.xlsm ou .xlsx)', 400) as any);
  },
});
const pendingImports = new Map<string, { workspaceId: string; parsed: ParsedWorkbook; candidates: SalaryPaymentCandidate[]; expires: number }>();

router.post('/import/preview', adminOnly, upload.single('file'), async (req: AuthRequest, res: Response, next) => {
  try {
    if (!req.file) throw new AppError('Escolhe o ficheiro', 400);
    const workspaceId = req.user!.workspaceId;
    const settings = await getSettings(workspaceId);
    let parsed: ParsedWorkbook;
    try {
      const extraAssociates = await prisma.financeAssociate.findMany({ where: { workspaceId }, select: { code: true, name: true, whatsapp: true } });
      parsed = await parseFinanceWorkbook(req.file.buffer, {
        fixSpaces: req.body?.fixSpaces === 'true', extraAssociates, creditName: settings.perNewStudentName,
      });
    } catch (e: any) {
      throw new AppError(e?.message || 'Não foi possível ler o ficheiro', 400);
    }
    const cfg = toConfig(settings);
    const { differences, checked, months } = reconcile(parsed, cfg);
    const candidates = suggestSalaryPayments(parsed, months, cfg);
    const now = Date.now();
    for (const [k, v] of pendingImports) if (v.expires < now) pendingImports.delete(k);
    const token = crypto.randomBytes(16).toString('hex');
    pendingImports.set(token, { workspaceId, parsed, candidates, expires: now + 30 * 60 * 1000 });
    const [lostEntries, lostPayments] = await Promise.all([
      prisma.financeEntry.count({ where: { workspaceId, source: 'crm' } }),
      prisma.financeSalaryPayment.count({ where: { workspaceId, source: 'crm' } }),
    ]);
    res.json({
      token, checked, differences, warnings: parsed.warnings, lostEntries, lostPayments,
      salaryPayments: candidates.map((c) => ({
        index: c.investmentIndex, period: c.period, payee: c.payee, amount: c.amount, wallet: c.wallet,
        date: c.date, description: c.notes, expected: c.expected, suggested: c.suggested,
      })),
      counts: {
        associates: parsed.associates.length, students: parsed.students.length, entries: parsed.entries.length,
        investments: parsed.investments.length, coupons: parsed.coupons.length, months: parsed.payrolls.length,
      },
    });
  } catch (e) { next(e); }
});

const nameKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

router.post('/import/commit', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const pending = pendingImports.get(String(req.body?.token || ''));
    if (!pending || pending.workspaceId !== workspaceId || pending.expires < Date.now()) {
      throw new AppError('A pré-visualização expirou. Escolhe o ficheiro de novo.', 400);
    }
    const p = pending.parsed;
    await getSettings(workspaceId);
    // Pagamentos de salario escolhidos na pre-visualizacao: saem dos investimentos.
    const chosenIdx = new Set<number>(Array.isArray(req.body?.salaryPayments)
      ? req.body.salaryPayments.map(Number).filter((n: number) => Number.isInteger(n))
      : pending.candidates.filter((c) => c.suggested).map((c) => c.investmentIndex));
    const chosen = pending.candidates.filter((c) => chosenIdx.has(c.investmentIndex));
    const convertedIdx = new Set(chosen.map((c) => c.investmentIndex));

    // Mantem as ligacoes associado-utilizador ja feitas; nas novas tenta pelo primeiro nome.
    const [oldAssociates, users, contacts] = await Promise.all([
      prisma.financeAssociate.findMany({ where: { workspaceId }, select: { code: true, userId: true } }),
      prisma.user.findMany({ where: { workspaceId, isActive: true }, select: { id: true, name: true } }),
      prisma.contact.findMany({ where: { workspaceId }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const oldLink = new Map(oldAssociates.map((a) => [a.code, a.userId]));
    const first = (s: string) => nameKey(s).split(' ')[0];
    const userFor = (name: string) => {
      const m = users.filter((u) => first(u.name) === first(name));
      return m.length === 1 ? m[0].id : null;
    };
    const contactBy = new Map<string, string | null>();
    for (const c of contacts) {
      const k = nameKey(`${c.firstName} ${c.lastName || ''}`);
      contactBy.set(k, contactBy.has(k) ? null : c.id);
    }

    const associateIds = new Map<string, string>(p.associates.map((a) => [a.code, crypto.randomUUID()]));
    const studentRows = p.students.map((s) => {
      const { associateCode, ...rest } = s;
      return {
        ...rest, workspaceId, id: crypto.randomUUID(), source: 'excel', phases: s.phases as any,
        associateId: associateCode ? associateIds.get(associateCode) || null : null,
        contactId: contactBy.get(nameKey(s.name)) || null,
      };
    });
    const entryRows = p.entries.map(({ associateCode, ...e }) => ({
      ...e, id: crypto.randomUUID(), workspaceId, source: 'excel', studentId: null as string | null,
      associateId: associateCode ? associateIds.get(associateCode) || null : null,
    }));
    // Os pagamentos dizem a quem pertence cada estudante; a coluna Associado da planilha esta incompleta.
    const linkPlan = planStudentLinks(studentRows, entryRows);
    for (const e of entryRows) e.studentId = linkPlan.links.get(e.id) || null;
    for (const s of studentRows) s.associateId = linkPlan.associates.get(s.id) ?? s.associateId;

    await prisma.$transaction(async (tx) => {
      await tx.financeEntry.deleteMany({ where: { workspaceId } });
      await tx.financeStudent.deleteMany({ where: { workspaceId } });
      await tx.financeAssociate.deleteMany({ where: { workspaceId } });
      await tx.financeInvestment.deleteMany({ where: { workspaceId } });
      await tx.financeCoupon.deleteMany({ where: { workspaceId } });
      await tx.financePayroll.deleteMany({ where: { workspaceId } });
      await tx.financeSalaryPayment.deleteMany({ where: { workspaceId } });
      await tx.financeAssociate.createMany({
        data: p.associates.map((a) => ({
          id: associateIds.get(a.code)!, workspaceId, code: a.code, name: a.name, whatsapp: a.whatsapp,
          userId: oldLink.get(a.code) ?? userFor(a.name),
        })),
      });
      await tx.financeStudent.createMany({ data: studentRows });
      await tx.financeEntry.createMany({ data: entryRows });
      await tx.financeInvestment.createMany({
        data: p.investments.filter((_, i) => !convertedIdx.has(i)).map((i) => ({ ...i, workspaceId, source: 'excel' })),
      });
      await tx.financeCoupon.createMany({ data: p.coupons.map((c) => ({ ...c, workspaceId })), skipDuplicates: true });
      await tx.financePayroll.createMany({ data: p.payrolls.map((m) => ({ ...m, workspaceId })) });
      // Um pagamento pode ser de um mes sem linha no resumo (ex.: so investimentos).
      const havePeriods = new Set(p.payrolls.map((m) => m.period));
      const settings = await tx.financeSettings.findUnique({ where: { workspaceId } });
      const missing = [...new Set(chosen.map((c) => c.period))].filter((x) => !havePeriods.has(x));
      if (missing.length) {
        await tx.financePayroll.createMany({
          data: missing.map((x) => ({ workspaceId, period: x, proLabore: settings && x >= settings.proLaboreFrom ? settings.proLabore : 0 })),
        });
      }
      await tx.financeSalaryPayment.createMany({
        data: chosen.map((c) => ({
          workspaceId, period: c.period, payee: c.payee, amount: c.amount, wallet: c.wallet, date: c.date,
          notes: c.notes, source: 'excel', associateId: c.associateCode ? associateIds.get(c.associateCode) || null : null,
        })),
      });
    }, { timeout: 120000, maxWait: 20000 });

    pendingImports.delete(String(req.body.token));
    res.json({
      ok: true, students: studentRows.length, linkedContacts: studentRows.filter((s) => s.contactId).length,
      salaryPayments: chosen.length, linkedPayments: linkPlan.links.size,
    });
  } catch (e) { next(e); }
});

export default router;
