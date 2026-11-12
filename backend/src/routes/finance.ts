import { Router, Response } from 'express';
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
import { defenseShares, normalizeTier, openingFor, openingFromSums, PACKAGE_TIERS, recalcStudentLedger } from '../lib/financeLedger';
import {
  adminOnly, assertPhase, getSettings, metaOnly, optDate, parseDate, Phase, phaseId, phaseLabel, phaseList,
  scopeStudents, studentDto, text,
} from '../lib/financeCommon';
import workRoutes, { recordPhaseMove, syncCompletion } from './financeWork';

const router = Router();

const FUNDS = ['Dono', 'Previdencia', 'Oportunidade', 'Expansao', 'Empresa'];
const studentInclude = {
  associate: { select: { id: true, code: true, name: true } },
  defenseAssociate: { select: { id: true, code: true, name: true } },
};
const ORDINALS = ['Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava'];

router.use(metaOnly);
router.use('/work', workRoutes);

function money(v: any, label = 'Valor'): number {
  const n = v === null || v === undefined || v === '' ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`${label} inválido`, 400);
  return n;
}
function period(v: any): string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new AppError('Mês inválido', 400);
  return v;
}
function wallet(v: any): string {
  const w = normalizeWallet(v);
  if (!w) throw new AppError(`Forma de pagamento inválida. Usa: ${WALLETS.join(', ')}`, 400);
  return w;
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
      select: { period: true, revenue: true, expense: true, potentialRevenue: true, commission: true, associateId: true, paymentMethod: true, defenseCommission: true, defenseAssociateId: true },
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
  return { settings: { ...settings, defenseShares: defenseShares(settings) }, months, flow: computeFlow(months, investments, cfg), associates, salaryPayments };
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
    if (!associate) return res.json({ associate: null, months: [], defenseStudents: [] });
    const [rows, def, students, settings] = await Promise.all([
      prisma.financeEntry.groupBy({
        by: ['period'], where: { workspaceId, associateId: associate.id },
        _sum: { commission: true, revenue: true }, _count: { _all: true },
      }),
      prisma.financeEntry.groupBy({
        by: ['period'], where: { workspaceId, defenseAssociateId: associate.id },
        _sum: { defenseCommission: true, defenseAmount: true }, _count: { _all: true },
      }),
      prisma.financeStudent.findMany({
        where: { workspaceId, defenseAssociateId: associate.id },
        select: { code: true, name: true, packageTier: true, totalValue: true, paidAmount: true, ledgerBalance: true, entries: { select: { defenseAmount: true, defenseCommission: true } } },
        orderBy: { code: 'desc' },
      }),
      getSettings(workspaceId),
    ]);
    type Row = { period: string; commission: number; revenue: number; payments: number; defenseCommission: number; defenseAmount: number; defensePayments: number };
    const by = new Map<string, Row>();
    const row = (period: string) => {
      if (!by.has(period)) by.set(period, { period, commission: 0, revenue: 0, payments: 0, defenseCommission: 0, defenseAmount: 0, defensePayments: 0 });
      return by.get(period)!;
    };
    for (const r of rows) Object.assign(row(r.period), { commission: r._sum.commission || 0, revenue: r._sum.revenue || 0, payments: r._count._all });
    for (const r of def) Object.assign(row(r.period), { defenseCommission: r._sum.defenseCommission || 0, defenseAmount: r._sum.defenseAmount || 0, defensePayments: r._count._all });
    const shares = defenseShares(settings);
    res.json({
      associate: { code: associate.code, name: associate.name },
      months: [...by.values()].sort((a, b) => b.period.localeCompare(a.period)),
      defenseStudents: students.map((st) => {
        const share = st.packageTier ? Math.min(shares[st.packageTier] || 0, st.totalValue) : 0;
        return {
          code: st.code, name: st.name, packageTier: st.packageTier, totalValue: st.totalValue, paidAmount: st.paidAmount,
          ledgerBalance: st.ledgerBalance, share, startsAt: st.totalValue - share,
          received: st.entries.reduce((a, e) => a + e.defenseAmount, 0),
          commission: st.entries.reduce((a, e) => a + e.defenseCommission, 0),
        };
      }),
    });
  } catch (e) { next(e); }
});

// ---------- Lancamentos ----------
const entryInclude = {
  associate: { select: { id: true, code: true, name: true } },
  defenseAssociate: { select: { id: true, code: true, name: true } },
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
    // Pagamento de um estudante do painel: conta no saldo dele (e na parte da defesa, se tiver).
    if (b.studentId) {
      if (type !== 'RECEITA') throw new AppError('Só uma receita pode ser ligada a um estudante', 400);
      const st = await prisma.financeStudent.findFirst({ where: { id: String(b.studentId), workspaceId } });
      if (!st) throw new AppError('Estudante não encontrado', 400);
      const pot = b.potentialRevenue === undefined || b.potentialRevenue === '' || b.potentialRevenue === null ? null : money(b.potentialRevenue);
      const r = await addStudentPayment(req, st, {
        date, amount, method: wallet(b.paymentMethod), associateId, notes: text(b.notes), description: text(b.description),
        category: b.category !== undefined ? text(b.category) : undefined, potentialRevenue: pot,
        ...(b.nextDueDate !== undefined ? { nextDueDate: optDate(b.nextDueDate, 'Próxima parcela') } : {}),
      });
      return res.status(201).json(r.entry);
    }
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
    let studentId = cur.studentId;
    if (b.studentId !== undefined) {
      studentId = b.studentId ? String(b.studentId) : null;
      if (studentId && cur.type !== 'RECEITA') throw new AppError('Só uma receita pode ser ligada a um estudante', 400);
      if (studentId && !(await prisma.financeStudent.findFirst({ where: { id: studentId, workspaceId }, select: { id: true } }))) {
        throw new AppError('Estudante não encontrado', 400);
      }
      data.studentId = studentId;
    }
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
      const up = await tx.financeEntry.update({ where: { id: cur.id }, data });
      const ids = [...new Set([cur.studentId, studentId].filter(Boolean))] as string[];
      for (const st of await tx.financeStudent.findMany({ where: { id: { in: ids } } })) {
        // Saldo automatico: recalcula tudo a partir dos lancamentos (valor, data e ligacao contam).
        if (st.ledgerBalance) { await recalcStudentLedger(tx, st.id); continue; }
        // Dados antigos: so acerta o valor pago quando muda o valor do mesmo estudante (ligar/desligar nao mexe no saldo da planilha).
        if (st.id === cur.studentId && st.id === studentId && revenue !== cur.revenue) {
          const s2 = await tx.financeStudent.update({ where: { id: st.id }, data: { paidAmount: { increment: revenue - cur.revenue } } });
          await tx.financeStudent.update({ where: { id: st.id }, data: { status: studentAfterPayment(s2) } });
        }
      }
      return tx.financeEntry.findUniqueOrThrow({ where: { id: up.id }, include: entryInclude });
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
      const linked = cur.studentId ? await tx.financeStudent.findUnique({ where: { id: cur.studentId }, select: { ledgerBalance: true } }) : null;
      if (linked?.ledgerBalance) await recalcStudentLedger(tx, cur.studentId!);
      else if (linked) {
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
router.get('/students', async (req: AuthRequest, res: Response, next) => {
  try {
    const list = await prisma.financeStudent.findMany({
      where: await scopeStudents(req),
      include: studentInclude,
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
  if (b.completedAt !== undefined) d.completedAt = optDate(b.completedAt, 'Data de conclusão');
  if (b.nextDueDate !== undefined) d.nextDueDate = optDate(b.nextDueDate, 'Próxima parcela');
  if (b.totalValue !== undefined) d.totalValue = money(b.totalValue, 'Valor total');
  if (b.installments !== undefined) d.installments = b.installments === '' || b.installments === null ? null : Math.max(1, Math.floor(money(b.installments, 'Nº de parcelas')));
  if (b.currentPhase !== undefined) d.currentPhase = phaseId(b.currentPhase);
  if (b.packageTier !== undefined) {
    const t = normalizeTier(b.packageTier);
    if (t === undefined) throw new AppError(`Pacote inválido. Usa: ${PACKAGE_TIERS.join(', ')}`, 400);
    d.packageTier = t;
  }
  if (b.ledgerBalance !== undefined) d.ledgerBalance = !!b.ledgerBalance;
  if (b.openingPaid !== undefined) d.openingPaid = money(b.openingPaid, 'Pago antes dos lançamentos');
  if (b.openingInstallments !== undefined) d.openingInstallments = Math.floor(money(b.openingInstallments, 'Parcelas pagas antes'));
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
    if (fields.currentPhase !== undefined) await assertPhase(workspaceId, fields.currentPhase);
    const codes = await prisma.financeStudent.findMany({ where: { workspaceId }, select: { code: true } });
    const max = codes.reduce((a, c) => Math.max(a, parseInt(c.code.slice(1), 10) || 0), 0);
    const created = await prisma.financeStudent.create({
      data: {
        workspaceId, code: `E${String(max + 1).padStart(3, '0')}`, name,
        associateId: await checkAssociate(workspaceId, b.associateId),
        defenseAssociateId: await checkAssociate(workspaceId, b.defenseAssociateId),
        // Estudantes novos: o saldo vem dos lancamentos ligados.
        ledgerBalance: true,
        ...fields,
        // Sem data de entrada o estudante nao contava para a comissao por estudante novo.
        entryDate: fields.entryDate ?? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      },
      include: studentInclude,
    });
    if (created.currentPhase) await recordPhaseMove(req, created, null, created.currentPhase, null);
    if (fields.completedAt === undefined && (await syncCompletion(workspaceId, created.id))) return res.status(201).json(studentDto(await reloadStudent(created.id)));
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
    if (b.defenseAssociateId !== undefined) data.defenseAssociateId = await checkAssociate(workspaceId, b.defenseAssociateId);
    // A fase tambem muda no quadro: nao escreve por cima de uma mudanca feita entretanto.
    if (data.currentPhase !== undefined && data.currentPhase !== cur.currentPhase) await assertPhase(workspaceId, data.currentPhase);
    if (data.currentPhase !== undefined && b.currentPhaseFrom !== undefined) {
      const from = phaseId(b.currentPhaseFrom);
      if (cur.currentPhase !== from && cur.currentPhase !== data.currentPhase) {
        const list = phaseList(await getSettings(workspaceId));
        throw new AppError(`A fase deste estudante foi mudada noutro lugar para ${phaseLabel(list, cur.currentPhase)}. Fecha e abre de novo.`, 409);
      }
    }
    if (b.status !== undefined) {
      if (!['Pago', 'Em aberto'].includes(b.status)) throw new AppError('Estado inválido', 400);
      data.status = b.status;
    }
    if ((data.sellerCredit ?? cur.sellerCredit) && !(data.entryDate !== undefined ? data.entryDate : cur.entryDate)) {
      throw new AppError('Indica a data de entrada para contar a venda.', 400);
    }
    // Estudante antigo a passar para o saldo pelos lancamentos: o valor pago nao muda
    // (o que nao esta nos lancamentos fica como "pago antes") e a divisao da defesa so vale daqui para a frente.
    if (data.ledgerBalance === true && !cur.ledgerBalance) {
      const o = await openingFor(prisma, cur);
      if (data.openingPaid === undefined) data.openingPaid = o.openingPaid;
      if (data.openingInstallments === undefined) data.openingInstallments = o.openingInstallments;
      if (!cur.ledgerSince) data.ledgerSince = b.ledgerSince ? parseDate(b.ledgerSince) : todayUtc();
    }
    // Com saldo automatico o valor pago e as parcelas vem dos lancamentos.
    const ledger = data.ledgerBalance ?? cur.ledgerBalance;
    if (b.paidAmount !== undefined && !ledger) data.paidAmount = money(b.paidAmount, 'Valor pago');
    if (b.installmentsPaid !== undefined && !ledger) data.installmentsPaid = Math.floor(money(b.installmentsPaid, 'Parcelas pagas'));
    let up = await prisma.financeStudent.update({
      where: { id: cur.id }, data, include: studentInclude,
    });
    if (['totalValue', 'packageTier', 'defenseAssociateId', 'ledgerBalance', 'openingPaid', 'openingInstallments'].some((k) => data[k] !== undefined)) {
      await recalcStudentLedger(prisma, cur.id);
      up = await reloadStudent(cur.id);
    }
    if (data.currentPhase !== undefined && up.currentPhase !== cur.currentPhase) await recordPhaseMove(req, up, cur.currentPhase, up.currentPhase, null);
    if (data.phases !== undefined && data.completedAt === undefined && (await syncCompletion(workspaceId, cur.id))) up = await reloadStudent(cur.id);
    res.json(studentDto(up));
  } catch (e) { next(e); }
});

async function reloadStudent(id: string) {
  return prisma.financeStudent.findUniqueOrThrow({ where: { id }, include: studentInclude });
}

router.delete('/students/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Estudante não encontrado', 404);
    await prisma.financeStudent.delete({ where: { id: cur.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Quadro de fases: muda so a fase actual, e so se ainda estiver na fase de onde saiu.
// O associado pode mover os seus estudantes; cada mudanca fica no historico (com a nota, se houver).
router.patch('/students/:id/phase', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const to = phaseId(req.body?.phase);
    const from = phaseId(req.body?.from);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 4000) || null : null;
    await assertPhase(workspaceId, to);
    const scope = await scopeStudents(req);
    const { count } = await prisma.financeStudent.updateMany({
      where: { ...scope, id: req.params.id, currentPhase: from },
      data: { currentPhase: to, ...(from !== to ? { lastActivityAt: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) } : {}) },
    });
    const st = await prisma.financeStudent.findFirst({
      where: { ...scope, id: req.params.id }, include: studentInclude,
    });
    if (!st) throw new AppError('Estudante não encontrado', 404);
    if (!count && st.currentPhase !== to) {
      const list = phaseList(await getSettings(workspaceId));
      throw new AppError(`${st.name} já tinha sido mudado para ${phaseLabel(list, st.currentPhase)} noutro lugar. O quadro foi actualizado.`, 409);
    }
    if (count && from !== to) await recordPhaseMove(req, st, from, to, note);
    res.json(studentDto(st));
  } catch (e) { next(e); }
});

function todayUtc() {
  return new Date(`${new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// Passa os estudantes antigos (saldo da planilha) para o saldo pelos lancamentos, sem mudar o valor pago.
// apply=false so mostra. "since": a partir deste dia os pagamentos entram na divisao da defesa.
router.post('/students/ledger-convert', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const since = req.body?.since ? parseDate(req.body.since) : todayUtc();
    const list = await prisma.financeStudent.findMany({ where: { workspaceId, ledgerBalance: false }, orderBy: { code: 'desc' } });
    // "A rever" escolhidos pelo admin: o valor pago passa a ser a soma dos lancamentos (a ficha estava por preencher).
    const useLinked = new Set<string>(Array.isArray(req.body?.useLinked) ? req.body.useLinked.map(String) : []);
    const ready: any[] = [];
    const review: any[] = [];
    let fromLinked = 0;
    // mode "linked": o valor pago de todos passa a ser a soma dos lancamentos (sem "pago antes").
    const allLinked = req.body?.mode === 'linked';
    // So estes estudantes (ex.: so o grupo "iguais", "com mais" ou "com menos"). Sem lista = todos.
    const only = Array.isArray(req.body?.ids) ? new Set<string>(req.body.ids.map(String)) : null;
    // Soma dos lancamentos ligados de todos os estudantes numa so consulta.
    const sums = new Map((await prisma.financeEntry.groupBy({
      by: ['studentId'], where: { workspaceId, type: 'RECEITA', studentId: { in: list.map((x) => x.id) } },
      _sum: { revenue: true }, _count: { _all: true },
    })).map((g) => [g.studentId as string, g]));
    for (const st of list) {
      const g = sums.get(st.id);
      const o = openingFromSums(st, g?._sum.revenue || 0, g?._count._all || 0);
      const row = { id: st.id, code: st.code, name: st.name, paidAmount: st.paidAmount, linked: o.linked, openingPaid: o.openingPaid, packageTier: st.packageTier };
      (o.ok ? ready : review).push(row);
      if (only && !only.has(st.id)) continue;
      if (o.ok && !allLinked && req.body?.apply === true) {
        await prisma.financeStudent.update({
          where: { id: st.id },
          data: { ledgerBalance: true, openingPaid: o.openingPaid, openingInstallments: o.openingInstallments, ledgerSince: st.ledgerSince || since },
        });
        await recalcStudentLedger(prisma, st.id);
      }
      if ((allLinked || (!o.ok && useLinked.has(st.id))) && req.body?.apply === true) {
        await prisma.financeStudent.update({
          where: { id: st.id },
          data: { ledgerBalance: true, openingPaid: 0, openingInstallments: 0, ledgerSince: st.ledgerSince || since },
        });
        await recalcStudentLedger(prisma, st.id);
        fromLinked++;
      }
    }
    res.json({ applied: req.body?.apply === true, since, ready, review, fromLinked });
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
        const ledger = await tx.financeStudent.findMany({ where: { id: { in: [...byStudent.keys()] }, ledgerBalance: true }, select: { id: true } });
        for (const s2 of ledger) await recalcStudentLedger(tx, s2.id);
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

type StudentRow = NonNullable<Awaited<ReturnType<typeof prisma.financeStudent.findFirst>>>;

// Cria o lancamento do pagamento ligado ao estudante e actualiza o saldo dele.
// Saldo automatico: recalcula a partir dos lancamentos (inclui a parte da defesa). Dados antigos: soma ao valor pago.
async function addStudentPayment(req: AuthRequest, st: StudentRow, o: {
  date: Date; amount: number; method: string; associateId: string | null; nextDueDate?: Date | null;
  notes?: string | null; description?: string | null; category?: string | null; potentialRevenue?: number | null;
}) {
  const workspaceId = st.workspaceId;
  const settings = await getSettings(workspaceId);
  const p = o.date.toISOString().slice(0, 7);
  await ensureMonth(workspaceId, p);
  const nth = st.ledgerBalance ? st.openingInstallments + await prisma.financeEntry.count({ where: { studentId: st.id, type: 'RECEITA' } }) : st.installmentsPaid;
  return prisma.$transaction(async (tx) => {
    const entry = await tx.financeEntry.create({
      data: {
        workspaceId, period: p, date: o.date, type: 'RECEITA', description: o.description || `Pagamento - ${st.name}`,
        category: o.category !== undefined ? o.category : st.project,
        potentialRevenue: o.potentialRevenue ?? (nth === 0 ? st.totalValue : 0), revenue: o.amount,
        commission: o.associateId ? o.amount * settings.commissionRate : 0, associateId: o.associateId, paymentMethod: o.method,
        notes: o.notes || `${ORDINALS[nth] || `${nth + 1}.ª`} parcela`,
        studentId: st.id, source: 'crm', createdById: req.user!.id,
      },
    });
    const due = o.nextDueDate !== undefined ? { nextDueDate: o.nextDueDate } : {};
    if (st.ledgerBalance) {
      await recalcStudentLedger(tx, st.id);
      if (o.nextDueDate !== undefined) await tx.financeStudent.update({ where: { id: st.id }, data: due });
    } else {
      const paid = st.paidAmount + o.amount;
      await tx.financeStudent.update({
        where: { id: st.id },
        data: { paidAmount: paid, installmentsPaid: st.installmentsPaid + 1, ...due, status: studentAfterPayment({ totalValue: st.totalValue, paidAmount: paid }) },
      });
    }
    return {
      entry: await tx.financeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude }),
      student: await tx.financeStudent.findUniqueOrThrow({ where: { id: st.id }, include: studentInclude }),
    };
  });
}

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
    const st = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!st) throw new AppError('Estudante não encontrado', 404);
    const associateId = b.associateId !== undefined ? await checkAssociate(workspaceId, b.associateId) : st.associateId;
    const result = await addStudentPayment(req, st, { date, amount, method, associateId, nextDueDate, notes: text(b.notes) });
    res.status(201).json({ entry: result.entry, student: studentDto(result.student) });
  } catch (e) { next(e); }
});

// Painel e estatisticas do programa
router.get('/academic', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const where = await scopeStudents(req);
    const phases = phaseList(await getSettings(workspaceId));
    const pos = new Map(phases.map((p, i) => [p.id, i + 1]));
    const lastId = phases[phases.length - 1].id;
    const half = Math.ceil((phases.length - 1) / 2);
    const [students, associates] = await Promise.all([
      prisma.financeStudent.findMany({
        where, select: { associateId: true, currentPhase: true, lastActivityAt: true, phases: true, project: true, origin: true, paidAmount: true },
      }),
      prisma.financeAssociate.findMany({ where: { workspaceId }, orderBy: { code: 'asc' } }),
    ]);
    const now = Date.now();
    const inactive = (d: Date | null) => (d ? Math.floor((now - d.getTime()) / 86400000) : null);
    const phaseCounts = phases.map((p) => students.filter((s) => s.currentPhase === p.id).length);
    const at = (s: { currentPhase: number | null }) => (s.currentPhase ? pos.get(s.currentPhase) || 0 : 0);
    const states: Record<string, number> = { Entregue: 0, 'Em curso': 0, Pendente: 0, Atrasado: 0, Bloqueado: 0 };
    let deliveredF7 = 0;
    for (const s of students) {
      for (const [f, v] of Object.entries((s.phases as any) || {})) {
        const st = (v as any)?.status;
        if (st && st in states) states[st]++;
        if (f === String(lastId) && st === 'Entregue') deliveredF7++;
      }
    }
    const withPhase = students.filter((s) => at(s) > 0);
    const byAssociate = associates.map((a) => {
      const own = students.filter((s) => s.associateId === a.id);
      return {
        id: a.id, code: a.code, name: a.name, whatsapp: a.whatsapp, userId: a.userId,
        total: own.length,
        early: own.filter((s) => at(s) > 0 && at(s) <= half && s.currentPhase !== lastId).length,
        middle: own.filter((s) => at(s) > half && s.currentPhase !== lastId).length,
        final: own.filter((s) => s.currentPhase === lastId).length,
        alerts: own.filter((s) => (inactive(s.lastActivityAt) ?? 0) > 14).length,
        completed: own.filter((s) => s.currentPhase === lastId && (s.phases as any)?.[String(lastId)]?.status === 'Entregue').length,
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
      averagePhase: withPhase.length ? Math.round((withPhase.reduce((a, s) => a + at(s), 0) / withPhase.length) * 10) / 10 : 0,
      deliveredF7,
      active: students.filter((s) => at(s) > 0 && s.currentPhase !== lastId).length,
      groups: {
        early: half > 0 ? `F1-F${half}` : '—',
        middle: half + 1 <= phases.length - 1 ? `F${half + 1}-F${phases.length - 1}` : '—',
        final: `F${phases.length}`,
      },
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
      where: { id: req.params.id, workspaceId }, include: { _count: { select: { entries: true, students: true, defenseEntries: true, defenseStudents: true } } },
    });
    if (!cur) throw new AppError('Associado não encontrado', 404);
    if (cur._count.entries || cur._count.students || cur._count.defenseEntries || cur._count.defenseStudents) throw new AppError('Este associado tem estudantes ou comissões registadas e não pode ser eliminado.', 400);
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
// ---------- Fases do metodo ----------
router.get('/phases', async (req: AuthRequest, res: Response, next) => {
  try {
    const phases = phaseList(await getSettings(req.user!.workspaceId));
    const rows = await prisma.financeStudent.groupBy({ by: ['currentPhase'], where: await scopeStudents(req), _count: { _all: true } });
    const counts: Record<string, number> = {};
    for (const r of rows) if (r.currentPhase) counts[r.currentPhase] = r._count._all;
    res.json({ phases, counts });
  } catch (e) { next(e); }
});

// Renomear, acrescentar, remover e reordenar. Os ids existentes ficam; os novos nunca reutilizam um id antigo.
// Estudantes numa fase removida passam para a fase escolhida em moves[id] (null = sem fase).
router.put('/phases', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const settings = await getSettings(workspaceId);
    const current = phaseList(settings);
    const input = req.body?.phases;
    if (!Array.isArray(input) || !input.length) throw new AppError('Tem de haver pelo menos uma fase', 400);
    if (input.length > 20) throw new AppError('No máximo 20 fases', 400);
    let nextId = Math.max(settings.phaseNextId, ...current.map((p) => p.id + 1));
    const seen = new Set<string>();
    const kept = new Set<number>();
    const list: Phase[] = input.map((x: any) => {
      const name = text(x?.name);
      if (!name) throw new AppError('Cada fase precisa de um nome', 400);
      if (name.length > 60) throw new AppError(`Nome demasiado longo: ${name.slice(0, 20)}...`, 400);
      const k = name.toLowerCase();
      if (seen.has(k)) throw new AppError(`Há duas fases com o nome "${name}"`, 400);
      seen.add(k);
      const id = Number(x?.id);
      if (current.some((p) => p.id === id) && !kept.has(id)) { kept.add(id); return { id, name }; }
      return { id: nextId++, name };
    });
    const removed = current.filter((p) => !kept.has(p.id));
    const moves = req.body?.moves && typeof req.body.moves === 'object' ? req.body.moves : {};
    const need: { id: number; name: string; count: number }[] = [];
    const plan: { from: number; to: number | null }[] = [];
    for (const p of removed) {
      const count = await prisma.financeStudent.count({ where: { workspaceId, currentPhase: p.id } });
      if (!count) continue;
      if (!(String(p.id) in moves)) { need.push({ ...p, count }); continue; }
      const to = phaseId(moves[String(p.id)]);
      if (to !== null && !kept.has(to)) throw new AppError(`Escolhe uma fase que fica para os estudantes de "${p.name}"`, 400);
      plan.push({ from: p.id, to });
    }
    if (need.length) {
      res.status(409).json({ message: 'Há estudantes em fases que vais remover. Escolhe para onde passam.', needMoves: need });
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const m of plan) await tx.financeStudent.updateMany({ where: { workspaceId, currentPhase: m.from }, data: { currentPhase: m.to } });
      await tx.financeSettings.update({ where: { workspaceId }, data: { studentPhases: list as any, phaseNextId: nextId } });
    });
    res.json({ phases: list, moved: plan.length });
  } catch (e) { next(e); }
});

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
    if (b.defenseShares !== undefined) {
      if (typeof b.defenseShares !== 'object' || b.defenseShares === null) throw new AppError('Valores da defesa inválidos', 400);
      const v: Record<string, number> = {};
      for (const t of PACKAGE_TIERS) if (b.defenseShares[t] !== undefined) v[t] = money(b.defenseShares[t], `Defesa (${t})`);
      data.defenseShares = v;
    }
    const saved = await prisma.financeSettings.update({ where: { workspaceId }, data });
    // A parte da defesa (ou a comissao) mudou: recalcula os estudantes com saldo automatico.
    if (data.defenseShares !== undefined || data.commissionRate !== undefined) {
      const list = await prisma.financeStudent.findMany({ where: { workspaceId, ledgerBalance: true }, select: { id: true } });
      for (const st of list) await recalcStudentLedger(prisma, st.id);
    }
    res.json({ ...saved, defenseShares: defenseShares(saved) });
  } catch (e) { next(e); }
});

// ---------- Exportacao ----------
router.get('/export', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const [{ settings, months, flow, associates, salaryPayments }, entries, students, investments, coupons] = await Promise.all([
      loadSummary(workspaceId),
      prisma.financeEntry.findMany({ where: { workspaceId }, include: { associate: { select: { name: true } }, defenseAssociate: { select: { name: true } }, student: { select: { code: true } } }, orderBy: [{ period: 'desc' }, { date: 'desc' }] }),
      prisma.financeStudent.findMany({ where: { workspaceId }, include: { associate: { select: { code: true, name: true } }, defenseAssociate: { select: { name: true } } }, orderBy: { code: 'desc' } }),
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
        ['Mês', 'Data', 'Descrição', 'Tipo', 'Categoria', 'Receita potencial', 'Despesa', 'Receita', 'Comissionista', 'Comissão', 'Forma de pagamento', 'Observações', 'Estudante', 'Parte da defesa', 'Associado de defesa', 'Comissão da defesa'],
        ...entries.map((e) => [e.period, e.date, e.description, e.type, e.category, e.potentialRevenue, e.expense, e.revenue, e.associate?.name || e.commissionistRaw, e.commission, e.paymentMethod, e.notes, e.student?.code, e.defenseAmount || null, e.defenseAssociate?.name, e.defenseCommission || null]),
      ] },
      { name: 'Estudantes', rows: [
        ['ID', 'Nome', 'Género', 'WhatsApp', 'Associado', 'Faculdade', 'Curso', 'Tema', 'Data de entrada', `Venda ${credit}`, 'Fase actual', 'Última actividade', 'Projecto', 'Origem', 'Valor total', 'Nº parcelas', 'Parcelas pagas', 'Valor pago', 'Saldo', 'Próxima parcela', 'Estado', 'Notas', 'Pacote', 'Associado de defesa', 'Saldo pelos lançamentos'],
        ...students.map((s) => [s.code, s.name, s.gender, s.whatsapp, s.associate?.name, s.faculty, s.course, s.theme, s.entryDate, (s.sellerCredit ?? !!s.entryDate) ? 'Sim' : 'Não', s.currentPhase ? phaseLabel(phaseList(settings), s.currentPhase) : null, s.lastActivityAt, s.project, s.origin, s.totalValue, s.installments, s.installmentsPaid, s.paidAmount, s.totalValue - s.paidAmount, s.nextDueDate, s.status, s.notes, s.packageTier, s.defenseAssociate?.name, s.ledgerBalance ? 'Sim' : 'Não']),
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
    // Duas passagens: os associados acertados na primeira desempatam nomes repetidos na segunda.
    let linked = 0;
    const entryById = new Map<string, (typeof entryRows)[number]>(entryRows.map((e) => [e.id, e]));
    for (let pass = 0; pass < 2; pass++) {
      const plan = planStudentLinks(studentRows, entryRows);
      for (const [eid, sid] of plan.links) { entryById.get(eid)!.studentId = sid; linked++; }
      for (const s of studentRows) s.associateId = plan.associates.get(s.id) ?? s.associateId;
    }

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
      salaryPayments: chosen.length, linkedPayments: linked,
    });
  } catch (e) { next(e); }
});

export default router;
