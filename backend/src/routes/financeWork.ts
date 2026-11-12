// Historico do trabalho dos estudantes (revisoes, questoes, correccoes, defesas, mudancas de fase)
// e os relatorios semanal e mensal que saem dele. Montado em /api/finance/work (ja so M.E.T.A.).
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import {
  addDays, adminOnly, findScopedStudent, getSettings, isAdmin, maputoNow, myAssociateId, optDate, parseDate, Phase, phaseList,
  scopeStudents, text, weekStart,
} from '../lib/financeCommon';
import { ReportCell, ReportDoc, ReportSection, ReportTable, sendReport } from '../lib/reportDoc';

const router = Router();

export const EVENT_TYPES = ['REVIEW', 'ISSUE', 'CORRECTION', 'DEFENSE'] as const;
export const REVIEW_RESULTS = ['Aprovado', 'Devolvido'];
export const DEFENSE_RESULTS = ['Aprovado', 'Aprovado com correcções', 'Reprovado', 'Adiado'];
const STATES = ['Em curso', 'Pendente', 'Atrasado', 'Bloqueado', 'Entregue'];
const INACTIVE_DAYS = 14;

const dayOf = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const dmy = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : null);
const longDay = (day: string) => `${Number(day.slice(8, 10))} de ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const daysBetween = (a: string, b: string) => Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / 86400000);
const pctText = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
// "1 revisão" / "3 revisões"
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

async function userName(id: string) {
  return (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name || null;
}

// Chamado sempre que a fase actual muda (quadro, ficha ou criacao).
export async function recordPhaseMove(
  req: AuthRequest, st: { id: string; workspaceId: string; associateId: string | null }, from: number | null, to: number | null, note: string | null,
) {
  await prisma.financeStudentEvent.create({
    data: {
      workspaceId: st.workspaceId, studentId: st.id, type: 'PHASE', date: dayDate(maputoNow().day), fromPhase: from, phaseId: to, note,
      associateId: st.associateId, createdById: req.user!.id, createdByName: await userName(req.user!.id),
    },
  });
}

// Quando a ultima fase fica "Entregue" o trabalho fica concluido nesse dia (se ainda nao tinha data).
export async function syncCompletion(workspaceId: string, studentId: string): Promise<boolean> {
  const [st, settings] = await Promise.all([
    prisma.financeStudent.findUnique({ where: { id: studentId }, select: { phases: true, completedAt: true } }),
    getSettings(workspaceId),
  ]);
  if (!st || st.completedAt) return false;
  const list = phaseList(settings);
  const last = (st.phases as any)?.[String(list[list.length - 1].id)];
  if (last?.status !== 'Entregue') return false;
  const day = /^\d{4}-\d{2}-\d{2}/.test(last.date || '') ? last.date.slice(0, 10) : maputoNow().day;
  await prisma.financeStudent.update({ where: { id: studentId }, data: { completedAt: dayDate(day) } });
  return true;
}

// ---------- Historico ----------
router.get('/students/:id/events', async (req: AuthRequest, res: Response, next) => {
  try {
    const st = await findScopedStudent(req, req.params.id);
    const events = await prisma.financeStudentEvent.findMany({ where: { studentId: st.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    res.json(events);
  } catch (e) { next(e); }
});

async function eventFields(workspaceId: string, type: string, b: any, partial: boolean) {
  const d: any = {};
  if (!partial || b.date !== undefined) d.date = b.date ? parseDate(b.date) : dayDate(maputoNow().day);
  if (b.note !== undefined || !partial) d.note = typeof b.note === 'string' ? b.note.trim().slice(0, 4000) || null : null;
  if (type === 'REVIEW') {
    if (!partial || b.result !== undefined) {
      if (!REVIEW_RESULTS.includes(b.result)) throw new AppError('Escolhe o resultado da revisão: Aprovado ou Devolvido', 400);
      d.result = b.result;
    }
    if (!partial || b.phaseId !== undefined) {
      const id = Number(b.phaseId);
      if (!phaseList(await getSettings(workspaceId)).some((p) => p.id === id)) throw new AppError('Escolhe a fase revista', 400);
      d.phaseId = id;
    }
  }
  if (type === 'DEFENSE') {
    if (!partial || b.result !== undefined) {
      if (!DEFENSE_RESULTS.includes(b.result)) throw new AppError('Escolhe o resultado da defesa', 400);
      d.result = b.result;
    }
    if (b.grade !== undefined) {
      const g = b.grade === '' || b.grade === null ? null : Number(b.grade);
      if (g !== null && !(Number.isFinite(g) && g >= 0 && g <= 20)) throw new AppError('A nota tem de estar entre 0 e 20', 400);
      d.grade = g;
    }
  }
  if (type === 'ISSUE' || type === 'CORRECTION') {
    if (!partial && !d.note) throw new AppError(type === 'ISSUE' ? 'Descreve a questão técnica' : 'Descreve a correcção pedida', 400);
    if (partial && b.note !== undefined && !d.note) throw new AppError('A descrição não pode ficar vazia', 400);
    if (b.resolvedAt !== undefined) d.resolvedAt = optDate(b.resolvedAt, 'Data de resolução');
  }
  if (b.phaseId !== undefined && type !== 'REVIEW') {
    const id = b.phaseId === '' || b.phaseId === null ? null : Number(b.phaseId);
    d.phaseId = Number.isInteger(id) ? id : null;
  }
  if (d.resolvedAt && d.date && d.resolvedAt < d.date) throw new AppError('A data de resolução não pode ser antes da data do registo', 400);
  return d;
}

router.post('/students/:id/events', async (req: AuthRequest, res: Response, next) => {
  try {
    const st = await findScopedStudent(req, req.params.id);
    const b = req.body || {};
    if (!EVENT_TYPES.includes(b.type)) throw new AppError('Tipo de registo inválido', 400);
    const data = await eventFields(st.workspaceId, b.type, b, false);
    const ev = await prisma.financeStudentEvent.create({
      data: {
        ...data, workspaceId: st.workspaceId, studentId: st.id, type: b.type, associateId: st.associateId,
        createdById: req.user!.id, createdByName: await userName(req.user!.id),
      },
    });
    if (!st.lastActivityAt || st.lastActivityAt < ev.date) await prisma.financeStudent.update({ where: { id: st.id }, data: { lastActivityAt: ev.date } });
    res.status(201).json(ev);
  } catch (e) { next(e); }
});

async function editableEvent(req: AuthRequest, id: string) {
  const ev = await prisma.financeStudentEvent.findFirst({ where: { id, workspaceId: req.user!.workspaceId } });
  if (!ev) throw new AppError('Registo não encontrado', 404);
  await findScopedStudent(req, ev.studentId);
  if (!isAdmin(req) && (ev.createdById !== req.user!.id || ev.type === 'PHASE')) throw new AppError('Só quem fez o registo (ou um administrador) o pode mudar.', 403);
  return ev;
}

router.patch('/events/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const ev = await editableEvent(req, req.params.id);
    const b = req.body || {};
    const data = ev.type === 'PHASE'
      ? { note: typeof b.note === 'string' ? b.note.trim().slice(0, 4000) || null : ev.note }
      : await eventFields(ev.workspaceId, ev.type, b, true);
    const date = data.date || ev.date;
    const resolved = data.resolvedAt !== undefined ? data.resolvedAt : ev.resolvedAt;
    if (resolved && resolved < date) throw new AppError('A data de resolução não pode ser antes da data do registo', 400);
    res.json(await prisma.financeStudentEvent.update({ where: { id: ev.id }, data }));
  } catch (e) { next(e); }
});

router.delete('/events/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const ev = await editableEvent(req, req.params.id);
    await prisma.financeStudentEvent.delete({ where: { id: ev.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Dados comuns dos relatorios ----------
type Ctx = Awaited<ReturnType<typeof loadCtx>>;
async function loadCtx(workspaceId: string, until: string, studentWhere?: any) {
  const [settings, students, associates, events] = await Promise.all([
    getSettings(workspaceId),
    prisma.financeStudent.findMany({
      where: studentWhere || { workspaceId },
      select: {
        id: true, code: true, name: true, project: true, associateId: true, currentPhase: true, phases: true, lastActivityAt: true,
        completedAt: true, status: true, nextDueDate: true, totalValue: true, paidAmount: true,
      },
    }),
    prisma.financeAssociate.findMany({ where: { workspaceId }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }),
    prisma.financeStudentEvent.findMany({ where: { workspaceId, date: { lt: dayDate(addDays(until, 1)) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  const phases = phaseList(settings);
  const studentIds = new Set(students.map((s) => s.id));
  return {
    settings, phases, students, associates,
    events: events.filter((e) => studentIds.has(e.studentId)),
    // Mudancas de fase depois do periodo, para saber em que fase cada um estava no fim dele.
    later: await prisma.financeStudentEvent.findMany({
      where: { workspaceId, type: 'PHASE', date: { gte: dayDate(addDays(until, 1)) } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { studentId: true, fromPhase: true },
    }),
    lastId: phases[phases.length - 1].id,
    byStudent: new Map(students.map((s) => [s.id, s])),
    aName: new Map(associates.map((a) => [a.id, a.name])),
  };
}

const pLabel = (phases: Phase[], id: number | null | undefined) => {
  if (!id) return 'Sem fase';
  const i = phases.findIndex((p) => p.id === id);
  return i >= 0 ? `F${i + 1} · ${phases[i].name}` : 'Fase removida';
};
const assocName = (c: Ctx, id: string | null | undefined) => (id ? c.aName.get(id) || '—' : 'Sem associado');

function completionDay(c: Ctx, s: Ctx['students'][number]): string | null | 'sem data' {
  if (s.completedAt) return dayOf(s.completedAt);
  const last = (s.phases as any)?.[String(c.lastId)];
  if (last?.status === 'Entregue') return /^\d{4}-\d{2}-\d{2}/.test(last.date || '') ? last.date.slice(0, 10) : 'sem data';
  return null;
}

// Fase em que o estudante estava no fim do dia `until`.
function phaseAt(c: Ctx) {
  const first = new Map<string, number | null>();
  for (const e of c.later) if (!first.has(e.studentId)) first.set(e.studentId, e.fromPhase);
  return (s: Ctx['students'][number]) => (first.has(s.id) ? first.get(s.id)! : s.currentPhase);
}

function inProgressAt(c: Ctx, until: string) {
  const at = phaseAt(c);
  const pos = new Map(c.phases.map((p, i) => [p.id, i]));
  return c.students
    .map((s) => {
      const phase = at(s);
      const done = completionDay(c, s);
      const state = phase ? ((s.phases as any)?.[String(phase)]?.status as string) || 'Sem estado' : 'Sem estado';
      const since = phase ? (s.phases as any)?.[String(phase)]?.date || null : null;
      return { s, phase, state, since, done: done === 'sem data' || (!!done && done <= until) };
    })
    .filter((r) => r.phase && !r.done)
    .sort((a, b) => assocName(c, a.s.associateId).localeCompare(assocName(c, b.s.associateId)) || (pos.get(a.phase!) ?? 99) - (pos.get(b.phase!) ?? 99));
}

const assocRows = (c: Ctx, ids: (string | null)[]) => {
  const set = new Set(ids);
  const rows: { id: string | null; name: string }[] = c.associates.filter((a) => set.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  if (set.has(null)) rows.push({ id: null, name: 'Sem associado' });
  return rows;
};

function openIssues(c: Ctx, type: 'ISSUE' | 'CORRECTION', until: string) {
  return c.events.filter((e) => e.type === type && dayOf(e.date)! <= until && (!e.resolvedAt || dayOf(e.resolvedAt)! > until));
}

// Revisoes devolvidas cuja ultima revisao (dessa fase) ate `until` continua "Devolvido".
function pendingReturns(c: Ctx, until: string) {
  const last = new Map<string, Ctx['events'][number]>();
  for (const e of c.events) if (e.type === 'REVIEW' && dayOf(e.date)! <= until) last.set(`${e.studentId}:${e.phaseId}`, e);
  return [...last.values()].filter((e) => e.result === 'Devolvido');
}

const now = () => {
  const m = maputoNow();
  return `${dmy(m.day)} às ${String(Math.floor(m.minutes / 60)).padStart(2, '0')}:${String(m.minutes % 60).padStart(2, '0')}`;
};

// ---------- Relatorio semanal ----------
async function weeklyReport(workspaceId: string, week: string): Promise<ReportDoc> {
  const from = weekStart(week);
  const to = addDays(from, 6);
  const c = await loadCtx(workspaceId, to);
  const inWeek = (d: Date | null) => !!d && dayOf(d)! >= from && dayOf(d)! <= to;
  const st = (id: string) => c.byStudent.get(id)!;

  // 1. Em curso
  const prog = inProgressAt(c, to);
  const stateCols = [...STATES, 'Sem estado'];
  const byA = assocRows(c, prog.map((r) => r.s.associateId));
  const matrix: ReportCell[][] = byA.map((a) => {
    const own = prog.filter((r) => r.s.associateId === a.id);
    return [a.name, ...stateCols.map((k) => own.filter((r) => r.state === k).length), own.length];
  });
  if (matrix.length) matrix.push(['Total', ...stateCols.map((k) => prog.filter((r) => r.state === k).length), prog.length]);

  // 2. Revisoes
  const reviews = c.events.filter((e) => e.type === 'REVIEW' && inWeek(e.date));
  const revA = assocRows(c, reviews.map((e) => e.associateId));

  // 3. Questoes e atrasos
  const issues = openIssues(c, 'ISSUE', to);
  const corrections = openIssues(c, 'CORRECTION', to);
  const late = prog.filter((r) => r.state === 'Atrasado' || r.state === 'Bloqueado');
  const returns = pendingReturns(c, to);
  const limit = addDays(to, -INACTIVE_DAYS);
  const idle = prog.filter((r) => !r.s.lastActivityAt || dayOf(r.s.lastActivityAt)! < limit);
  const overdue = c.students.filter((s) => s.status !== 'Pago' && s.nextDueDate && dayOf(s.nextDueDate)! <= to)
    .sort((a, b) => dayOf(a.nextDueDate)!.localeCompare(dayOf(b.nextDueDate)!));

  // 4. Mudancas de fase
  const moves = c.events.filter((e) => e.type === 'PHASE' && inWeek(e.date));
  const today = maputoNow().day;

  const sections: ReportSection[] = [
    {
      heading: 'Resumo',
      bullets: [
        `${n(prog.length, 'trabalho em curso', 'trabalhos em curso')} no fim da semana (${late.length} atrasados ou bloqueados).`,
        `${n(reviews.length, 'revisão técnica', 'revisões técnicas')}: ${reviews.filter((e) => e.result === 'Aprovado').length} aprovadas, ${reviews.filter((e) => e.result === 'Devolvido').length} devolvidas.`,
        `${n(issues.length, 'questão técnica em aberto', 'questões técnicas em aberto')} e ${n(corrections.length, 'correcção pós-entrega por resolver', 'correcções pós-entrega por resolver')}.`,
        `${n(moves.length, 'mudança de fase registada', 'mudanças de fase registadas')} na semana.`,
        ...(to < today ? [] : ['A semana ainda não terminou: os números podem mudar até domingo.']),
      ],
    },
    {
      heading: '1. Trabalhos em curso, por associado e por estado',
      intro: 'Estudantes com fase e trabalho ainda não concluído. O estado é o da fase em que cada um está.',
      tables: [
        { title: 'Por associado e estado', columns: ['Associado', ...stateCols, 'Total'], rows: matrix, numeric: stateCols.map((_, i) => i + 1).concat(stateCols.length + 1), empty: 'Nenhum trabalho em curso.' },
        {
          title: 'Lista', columns: ['Associado', 'ID', 'Estudante', 'Serviço', 'Fase', 'Estado', 'Última actividade'],
          rows: prog.map((r) => [assocName(c, r.s.associateId), r.s.code, r.s.name, r.s.project, pLabel(c.phases, r.phase), r.state, dmy(dayOf(r.s.lastActivityAt))]),
        },
      ],
    },
    {
      heading: '2. Trabalhos revistos e aprovados tecnicamente',
      tables: [
        {
          title: 'Por associado', columns: ['Associado', 'Revisões', 'Aprovados', 'Devolvidos', 'Aprovação'], numeric: [1, 2, 3, 4],
          rows: revA.map((a) => {
            const own = reviews.filter((e) => e.associateId === a.id);
            const ok = own.filter((e) => e.result === 'Aprovado').length;
            return [a.name, own.length, ok, own.length - ok, pctText(ok, own.length)];
          }),
          empty: 'Nenhuma revisão técnica registada nesta semana.',
        },
        {
          title: 'Revisões da semana', columns: ['Data', 'ID', 'Estudante', 'Associado', 'Fase', 'Resultado', 'Nota', 'Registado por'],
          rows: reviews.map((e) => [dmy(dayOf(e.date)), st(e.studentId).code, st(e.studentId).name, assocName(c, e.associateId), pLabel(c.phases, e.phaseId), e.result, e.note, e.createdByName]),
        },
      ],
    },
    {
      heading: '3. Questões técnicas em aberto e atrasos',
      tables: [
        {
          title: 'Questões técnicas em aberto', columns: ['Aberta desde', 'Dias', 'ID', 'Estudante', 'Associado', 'Questão'], numeric: [1],
          rows: issues.map((e) => [dmy(dayOf(e.date)), daysBetween(dayOf(e.date)!, to), st(e.studentId).code, st(e.studentId).name, assocName(c, st(e.studentId).associateId), e.note]),
          empty: 'Nenhuma questão técnica em aberto.',
        },
        {
          title: 'Fases atrasadas ou bloqueadas', columns: ['ID', 'Estudante', 'Associado', 'Fase', 'Estado', 'Data na fase'],
          rows: late.map((r) => [r.s.code, r.s.name, assocName(c, r.s.associateId), pLabel(c.phases, r.phase), r.state, dmy(r.since)]),
          empty: 'Nenhuma fase atrasada ou bloqueada.',
        },
        {
          title: 'Devolvidos na revisão e ainda não aprovados', columns: ['Devolvido em', 'ID', 'Estudante', 'Associado', 'Fase', 'Motivo'],
          rows: returns.map((e) => [dmy(dayOf(e.date)), st(e.studentId).code, st(e.studentId).name, assocName(c, e.associateId), pLabel(c.phases, e.phaseId), e.note]),
          empty: 'Nenhum trabalho devolvido à espera de nova revisão.',
        },
        {
          title: 'Correcções pós-entrega por resolver', columns: ['Pedida em', 'Dias', 'ID', 'Estudante', 'Associado', 'Correcção'], numeric: [1],
          rows: corrections.map((e) => [dmy(dayOf(e.date)), daysBetween(dayOf(e.date)!, to), st(e.studentId).code, st(e.studentId).name, assocName(c, st(e.studentId).associateId), e.note]),
          empty: 'Nenhuma correcção por resolver.',
        },
        {
          title: `Sem actividade há mais de ${INACTIVE_DAYS} dias`, columns: ['ID', 'Estudante', 'Associado', 'Fase', 'Última actividade', 'Dias'], numeric: [5],
          rows: idle.map((r) => [r.s.code, r.s.name, assocName(c, r.s.associateId), pLabel(c.phases, r.phase), dmy(dayOf(r.s.lastActivityAt)), r.s.lastActivityAt ? daysBetween(dayOf(r.s.lastActivityAt)!, to) : null]),
          empty: 'Todos os trabalhos em curso tiveram actividade recente.',
        },
        {
          title: 'Parcelas em atraso', columns: ['ID', 'Estudante', 'Associado', 'Parcela prevista', 'Saldo (MZN)'], numeric: [4],
          rows: overdue.map((s) => [s.code, s.name, assocName(c, s.associateId), dmy(dayOf(s.nextDueDate)), Math.round(s.totalValue - s.paidAmount)]),
          empty: 'Nenhuma parcela em atraso.',
        },
      ],
    },
    {
      heading: '4. Mudanças de fase da semana',
      tables: [movesTable(c, moves)],
    },
  ];
  return { title: 'Relatório semanal', subtitle: `Semana de ${longDay(from)} a ${longDay(to)} de ${to.slice(0, 4)}`, generatedAt: now(), sections };
}

function movesTable(c: Ctx, moves: Ctx['events']): ReportTable {
  return {
    columns: ['Data', 'ID', 'Estudante', 'Associado', 'De', 'Para', 'Por', 'Nota'],
    rows: moves.map((e) => {
      const s = c.byStudent.get(e.studentId)!;
      return [dmy(dayOf(e.date)), s.code, s.name, assocName(c, e.associateId), pLabel(c.phases, e.fromPhase), pLabel(c.phases, e.phaseId), e.createdByName, e.note];
    }),
    empty: 'Nenhuma mudança de fase nesta semana.',
  };
}

// ---------- Relatorio mensal ----------
function trainingHints(c: Ctx, a: { id: string | null }, m: {
  reviews: Ctx['events']; corrections: Ctx['events']; defenses: Ctx['events']; late: number; idle: number;
}): string {
  const out: string[] = [];
  const own = m.reviews.filter((e) => e.associateId === a.id);
  const ok = own.filter((e) => e.result === 'Aprovado').length;
  if (own.length >= 3 && ok / own.length < 0.7) out.push(`Só ${pctText(ok, own.length)} das revisões aprovadas: rever a qualidade antes de entregar.`);
  const byPhase = new Map<number | null, number>();
  for (const e of own) if (e.result === 'Devolvido') byPhase.set(e.phaseId, (byPhase.get(e.phaseId) || 0) + 1);
  for (const [p, n] of byPhase) if (n >= 2) out.push(`${n} devoluções em ${pLabel(c.phases, p)}: formação nesta fase.`);
  const corr = m.corrections.filter((e) => e.associateId === a.id).length;
  if (corr >= 2) out.push(`${corr} correcções pedidas depois da entrega: reforçar a revisão final.`);
  if (m.defenses.some((e) => e.associateId === a.id && e.result === 'Reprovado')) out.push('Defesa reprovada: reforçar a preparação para a defesa.');
  if (m.late >= 3) out.push(`${m.late} trabalhos atrasados ou bloqueados: acompanhar prazos.`);
  if (m.idle >= 3) out.push(`${m.idle} trabalhos sem actividade há mais de ${INACTIVE_DAYS} dias.`);
  if (out.length) return out.join(' ');
  return own.length || corr ? 'Sem necessidades evidentes.' : 'Sem registos suficientes este mês.';
}

async function monthlyReport(workspaceId: string, month: string): Promise<ReportDoc> {
  const from = `${month}-01`;
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  const end = addDays(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`, -1);
  const c = await loadCtx(workspaceId, end);
  const inMonth = (d: string | null) => !!d && d >= from && d <= end;
  const st = (id: string) => c.byStudent.get(id)!;

  // 1. Concluidos
  const done = c.students.map((s) => ({ s, day: completionDay(c, s) })).filter((r) => r.day !== 'sem data' && inMonth(r.day as string))
    .sort((a, b) => (a.day as string).localeCompare(b.day as string));
  const services = new Map<string, number>();
  for (const r of done) services.set(r.s.project || 'Sem indicação', (services.get(r.s.project || 'Sem indicação') || 0) + 1);

  // 2. Correccoes
  const corrections = c.events.filter((e) => e.type === 'CORRECTION' && inMonth(dayOf(e.date)));
  const corrA = assocRows(c, corrections.map((e) => e.associateId));
  const corrS = new Map<string, number>();
  for (const e of corrections) { const k = st(e.studentId).project || 'Sem indicação'; corrS.set(k, (corrS.get(k) || 0) + 1); }
  const avgDays = (list: Ctx['events']) => {
    const r = list.filter((e) => e.resolvedAt && dayOf(e.resolvedAt)! <= end);
    return r.length ? Math.round((r.reduce((a, e) => a + daysBetween(dayOf(e.date)!, dayOf(e.resolvedAt)!), 0) / r.length) * 10) / 10 : null;
  };

  // 3. Defesas
  const defenses = c.events.filter((e) => e.type === 'DEFENSE' && inMonth(dayOf(e.date)));
  const graded = defenses.filter((e) => e.grade !== null);
  const approved = defenses.filter((e) => e.result === 'Aprovado' || e.result === 'Aprovado com correcções').length;
  const decided = defenses.filter((e) => e.result !== 'Adiado').length;
  const avg = (l: Ctx['events']) => (l.length ? Math.round((l.reduce((a, e) => a + (e.grade || 0), 0) / l.length) * 10) / 10 : null);

  // 4. Desempenho
  const prog = inProgressAt(c, end);
  const reviews = c.events.filter((e) => e.type === 'REVIEW' && inMonth(dayOf(e.date)));
  const moves = c.events.filter((e) => e.type === 'PHASE' && inMonth(dayOf(e.date)));
  const limit = addDays(end, -INACTIVE_DAYS);
  const perf = c.associates.map((a) => {
    const own = prog.filter((r) => r.s.associateId === a.id);
    const rv = reviews.filter((e) => e.associateId === a.id);
    const ok = rv.filter((e) => e.result === 'Aprovado').length;
    const df = defenses.filter((e) => e.associateId === a.id);
    const dfOk = df.filter((e) => e.result === 'Aprovado' || e.result === 'Aprovado com correcções').length;
    const late = own.filter((r) => r.state === 'Atrasado' || r.state === 'Bloqueado').length;
    const idle = own.filter((r) => !r.s.lastActivityAt || dayOf(r.s.lastActivityAt)! < limit).length;
    return {
      a, late, idle,
      row: [
        a.name, own.length, done.filter((r) => r.s.associateId === a.id).length, moves.filter((e) => e.associateId === a.id).length,
        rv.length, pctText(ok, rv.length), rv.length - ok, corrections.filter((e) => e.associateId === a.id).length,
        df.length ? `${dfOk}/${df.length}` : '—', avg(df.filter((e) => e.grade !== null)), late, idle,
      ] as ReportCell[],
    };
  }).filter((p) => (p.row.slice(1) as any[]).some((v) => v && v !== '—'));
  const notes = ((c.settings.trainingNotes as any) || {})[month] || {};

  const sections: ReportSection[] = [
    {
      heading: 'Resumo',
      bullets: [
        `${n(done.length, 'trabalho concluído', 'trabalhos concluídos')} no mês.`,
        `${n(corrections.length, 'correcção pedida', 'correcções pedidas')} pelos estudantes depois da entrega.`,
        `${n(defenses.length, 'defesa acompanhada', 'defesas acompanhadas')}: ${approved} aprovada${approved === 1 ? '' : 's'}${decided ? ` (${pctText(approved, decided)} das realizadas)` : ''}${graded.length ? `, nota média ${avg(graded)}` : ''}.`,
        `${n(reviews.length, 'revisão técnica', 'revisões técnicas')} (${pctText(reviews.filter((e) => e.result === 'Aprovado').length, reviews.length)} aprovadas) e ${n(moves.length, 'mudança de fase', 'mudanças de fase')}.`,
      ],
    },
    {
      heading: '1. Trabalhos concluídos, por serviço',
      intro: 'Conta o dia em que o trabalho ficou concluído (a última fase passou a "Entregue", ou a data indicada na ficha).',
      tables: [
        { title: 'Por serviço', columns: ['Serviço', 'Concluídos'], numeric: [1], rows: [...[...services].sort((a, b) => b[1] - a[1]), ...(done.length ? [['Total', done.length] as [string, number]] : [])], empty: 'Nenhum trabalho concluído neste mês.' },
        { title: 'Lista', columns: ['Concluído em', 'ID', 'Estudante', 'Serviço', 'Associado'], rows: done.map((r) => [dmy(r.day as string), r.s.code, r.s.name, r.s.project, assocName(c, r.s.associateId)]) },
      ],
    },
    {
      heading: '2. Correcções pedidas pelos estudantes após a entrega',
      tables: [
        {
          title: 'Por associado', columns: ['Associado', 'Pedidas', 'Resolvidas', 'Por resolver', 'Tempo médio (dias)'], numeric: [1, 2, 3, 4],
          rows: corrA.map((a) => {
            const own = corrections.filter((e) => e.associateId === a.id);
            const res = own.filter((e) => e.resolvedAt && dayOf(e.resolvedAt)! <= end).length;
            return [a.name, own.length, res, own.length - res, avgDays(own)];
          }),
          empty: 'Nenhuma correcção pedida neste mês.',
        },
        { title: 'Por serviço', columns: ['Serviço', 'Pedidas'], numeric: [1], rows: [...corrS].sort((a, b) => b[1] - a[1]) },
        {
          title: 'Lista', columns: ['Pedida em', 'ID', 'Estudante', 'Serviço', 'Associado', 'Correcção', 'Resolvida em'],
          rows: corrections.map((e) => [dmy(dayOf(e.date)), st(e.studentId).code, st(e.studentId).name, st(e.studentId).project, assocName(c, e.associateId), e.note, dmy(dayOf(e.resolvedAt))]),
        },
      ],
    },
    {
      heading: '3. Resultados das defesas acompanhadas',
      tables: [{
        columns: ['Data', 'ID', 'Estudante', 'Serviço', 'Associado', 'Resultado', 'Nota (0-20)', 'Observação'], numeric: [6],
        rows: defenses.map((e) => [dmy(dayOf(e.date)), st(e.studentId).code, st(e.studentId).name, st(e.studentId).project, assocName(c, e.associateId), e.result, e.grade, e.note]),
        empty: 'Nenhuma defesa registada neste mês.',
      }],
    },
    {
      heading: '4. Desempenho técnico de cada associado e necessidades de formação',
      intro: 'Revisões, correcções e defesas contam para o associado que tinha o estudante quando foram registadas. "Em curso", atrasos e inactividade são a situação no fim do mês.',
      tables: [
        {
          title: 'Desempenho',
          columns: ['Associado', 'Em curso', 'Concluídos', 'Mudanças de fase', 'Revisões', 'Aprovadas', 'Devolvidas', 'Correcções', 'Defesas aprovadas', 'Nota média', 'Atrasados/bloqueados', `Sem actividade >${INACTIVE_DAYS}d`],
          numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          rows: perf.map((p) => p.row),
          empty: 'Sem dados de desempenho neste mês.',
        },
        {
          title: 'Necessidades de formação',
          columns: ['Associado', 'Sugestão do CRM', 'Avaliação da direcção'],
          rows: perf.map((p) => [p.a.name, trainingHints(c, p.a, { reviews, corrections, defenses, late: p.late, idle: p.idle }), notes[p.a.id] || null]),
        },
      ],
    },
  ];
  return { title: 'Relatório mensal', subtitle: `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`, generatedAt: now(), sections };
}

function reqWeek(v: any) {
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : maputoNow().day;
  parseDate(d, 'Semana');
  return weekStart(d);
}
function reqMonth(v: any) {
  const m = typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : maputoNow().day.slice(0, 7);
  return m;
}
const fmt = (v: any) => (['docx', 'pdf', 'xlsx'].includes(v) ? v : 'json');

router.get('/reports/weekly', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const week = reqWeek(req.query.week);
    await sendReport(res, await weeklyReport(req.user!.workspaceId, week), fmt(req.query.format), `relatorio-semanal-${week}`);
  } catch (e) { next(e); }
});

router.get('/reports/monthly', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const month = reqMonth(req.query.month);
    const doc = await monthlyReport(req.user!.workspaceId, month);
    if (fmt(req.query.format) === 'json') {
      const s = await getSettings(req.user!.workspaceId);
      return res.json({ ...doc, training: ((s.trainingNotes as any) || {})[month] || {} });
    }
    await sendReport(res, doc, fmt(req.query.format), `relatorio-mensal-${month}`);
  } catch (e) { next(e); }
});

// Avaliacao escrita pela direccao no relatorio mensal (por associado e mes).
router.put('/reports/training', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const month = req.body?.month;
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('Mês inválido', 400);
    const a = await prisma.financeAssociate.findFirst({ where: { id: String(req.body?.associateId || ''), workspaceId }, select: { id: true } });
    if (!a) throw new AppError('Associado não encontrado', 404);
    const value = text(req.body?.text)?.slice(0, 2000) || null;
    await prisma.$transaction(async (tx) => {
      const s = await tx.financeSettings.findUnique({ where: { workspaceId } });
      const all = { ...((s?.trainingNotes as any) || {}) };
      const m = { ...(all[month] || {}) };
      if (value) m[a.id] = value; else delete m[a.id];
      all[month] = m;
      await tx.financeSettings.update({ where: { workspaceId }, data: { trainingNotes: all } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Relatorio da semana do Quadro de fases: mudancas de fase e notas escritas ao mover.
// O associado so ve os seus estudantes; o admin pode filtrar por associado.
router.get('/reports/moves', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const from = reqWeek(req.query.week);
    const to = addDays(from, 6);
    const where = await scopeStudents(req);
    const only = isAdmin(req) && typeof req.query.associateId === 'string' && req.query.associateId ? req.query.associateId : null;
    if (only) where.associateId = only === '__none__' ? null : only;
    const c = await loadCtx(workspaceId, to, where);
    const moves = c.events.filter((e) => e.type === 'PHASE' && dayOf(e.date)! >= from);
    const mine = isAdmin(req) ? null : await myAssociateId(req);
    const who = only ? (only === '__none__' ? 'Sem associado' : c.aName.get(only) || '') : mine ? c.aName.get(mine) || '' : 'Todos os associados';
    const withNote = moves.filter((e) => e.note).length;
    const doc: ReportDoc = {
      title: 'Relatório da semana · Quadro de fases',
      subtitle: `${who} · ${longDay(from)} a ${longDay(to)} de ${to.slice(0, 4)}`,
      generatedAt: now(),
      sections: [
        {
          heading: 'Resumo',
          bullets: [
            `${n(moves.length, 'mudança de fase', 'mudanças de fase')}, ${withNote} com nota.`,
            `${n(new Set(moves.map((e) => e.studentId)).size, 'estudante acompanhado', 'estudantes acompanhados')}.`,
          ],
        },
        { heading: 'Mudanças de fase e notas', tables: [movesTable(c, moves)] },
      ],
    };
    await sendReport(res, doc, fmt(req.query.format), `quadro-de-fases-${from}`);
  } catch (e) { next(e); }
});

export default router;
