// Preparacao para defesa (so M.E.T.A.): agenda de simulacoes por sala, em sessoes de 1 hora.
// Os dias e horarios, a hora do popup, o minimo de sessoes a escolher e se o popup bloqueia o CRM
// configuram-se nas Definicoes da pagina (FinanceSettings.defenseConfig).
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { addDays, adminOnly, getSettings, isAdmin, maputoNow, metaOnly, text, weekStart } from '../lib/financeCommon';

const router = Router();
router.use(metaOnly);

const MAX_ROOMS = 20;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Dia da semana 0 = domingo ... 6 = sabado. end e a hora em que termina a ultima sessao.
export type DaySchedule = { on: boolean; start: number; end: number };
export type DefenseCfg = {
  schedule: DaySchedule[]; gateEnabled: boolean; gateTime: string; minChoices: number; gateMode: 'block' | 'remind'; roomNames: string[];
  // Enchimento equilibrado: enquanto houver sessoes do dia com menos de fillMin associados,
  // so se entra nas que tem menos gente. 0 = desligado.
  fillMin: number;
  // Quando se escolhem as sessoes de cada dia da semana (0 = domingo): N dias antes, a partir de uma hora
  // (null = hora do aviso). Por defeito na vespera; as de segunda no sabado as 10:00.
  gateRules: GateRule[];
};
export type GateRule = { daysBefore: number; time: string | null };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_RULES: GateRule[] = [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 1 ? { daysBefore: 2, time: '10:00' } : { daysBefore: 1, time: null }));
const DEFAULT_SCHEDULE: DaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0 || d === 6 ? { on: true, start: 8, end: 12 } : { on: true, start: 8, end: 20 }));

export function defenseCfg(s: { defenseConfig: any }): DefenseCfg {
  const c = (s.defenseConfig && typeof s.defenseConfig === 'object' ? s.defenseConfig : {}) as any;
  const schedule = DEFAULT_SCHEDULE.map((d, i) => {
    const x = Array.isArray(c.schedule) ? c.schedule[i] : null;
    return x && Number.isInteger(x.start) && Number.isInteger(x.end) ? { on: !!x.on, start: x.start, end: x.end } : d;
  });
  return {
    schedule,
    gateEnabled: c.gateEnabled !== false,
    gateTime: typeof c.gateTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.gateTime) ? c.gateTime : '16:30',
    minChoices: Number.isInteger(c.minChoices) ? c.minChoices : 2,
    gateMode: c.gateMode === 'remind' ? 'remind' : 'block',
    roomNames: Array.isArray(c.roomNames) ? c.roomNames.map((n: any) => (typeof n === 'string' ? n : '')) : [],
    fillMin: Number.isInteger(c.fillMin) ? c.fillMin : 2,
    gateRules: DEFAULT_RULES.map((d, i) => {
      const x = Array.isArray(c.gateRules) ? c.gateRules[i] : null;
      return x && Number.isInteger(x.daysBefore) && x.daysBefore >= 1 && x.daysBefore <= 6
        ? { daysBefore: x.daysBefore, time: typeof x.time === 'string' && HHMM.test(x.time) ? x.time : null } : d;
    }),
  };
}
const dow = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay();
export function hoursFor(day: string, cfg: DefenseCfg): number[] {
  const d = cfg.schedule[dow(day)];
  if (!d.on) return [];
  return Array.from({ length: Math.max(0, d.end - d.start) }, (_, i) => d.start + i);
}
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// Dias (a partir de amanha) cuja escolha ja abriu, pela ordem: a regra do dia da semana diz quantos dias antes e a que hora.
function openTargets(cfg: DefenseCfg): string[] {
  const { day, minutes } = maputoNow();
  const out: string[] = [];
  for (let k = 1; k <= 7; k++) {
    const target = addDays(day, k);
    const r = cfg.gateRules[dow(target)];
    const opens = addDays(target, -r.daysBefore);
    if (day > opens || (day === opens && minutes >= toMinutes(r.time || cfg.gateTime))) out.push(target);
  }
  return out;
}
function validDay(v: any): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(`${v}T00:00:00.000Z`).getTime())) throw new AppError('Dia inválido', 400);
  return v;
}

const sessionInclude = {
  student: { select: { id: true, code: true, name: true, project: true, whatsapp: true, contactId: true } },
  associate: { select: { id: true, name: true, userId: true } },
  participants: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
};
function dto(s: any) {
  return {
    id: s.id, day: s.day, hour: s.hour, room: s.room, number: s.number ?? null, title: s.title, notes: s.notes, studentId: s.studentId, contactId: s.contactId,
    student: s.student, participants: s.participants.map((p: any) => ({ userId: p.userId, name: p.user?.name || '' })),
    associateId: s.associateId, associate: s.associate || null, slidesUrl: s.slidesUrl, slidesName: s.slidesName, slidesAt: s.slidesAt,
  };
}

function emit(req: AuthRequest, day?: string) {
  req.app.get('io')?.to(`workspace:${req.user!.workspaceId}`).emit('defense:changed', { day });
}

const participantsOf = (s: { defenseParticipants: any }): string[] => (Array.isArray(s.defenseParticipants) ? s.defenseParticipants : []);

// O estudante tem de estar ligado a um contacto que ja existe (para abrir o chat a partir da agenda).
// contactId enviado = liga (ou muda) a ligacao; sem ele usa a ligacao que ja estava na ficha.
async function ensureContact(workspaceId: string, st: { id: string; name: string; whatsapp: string | null; contactId: string | null }, contactId?: string | null) {
  const id = contactId || st.contactId;
  if (!id) throw new AppError(`Associa ${st.name} a um contacto existente.`, 400);
  const c = await prisma.contact.findFirst({ where: { id, workspaceId }, select: { id: true, whatsapp: true, phone: true } });
  if (!c) throw new AppError(contactId ? 'Contacto não encontrado' : `O contacto ligado a ${st.name} já não existe. Associa outro.`, 400);
  if (st.contactId !== c.id || (!st.whatsapp && (c.whatsapp || c.phone))) {
    await prisma.financeStudent.update({ where: { id: st.id }, data: { contactId: c.id, ...(!st.whatsapp && (c.whatsapp || c.phone) ? { whatsapp: c.whatsapp || c.phone } : {}) } });
  }
  return c.id;
}

// ---------- Configuracao ----------
router.get('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    const s = await getSettings(req.user!.workspaceId);
    const [users, associates] = await Promise.all([
      prisma.user.findMany({ where: { workspaceId: req.user!.workspaceId }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
      prisma.financeAssociate.findMany({ where: { workspaceId: req.user!.workspaceId, isActive: true }, select: { id: true, name: true, userId: true }, orderBy: { name: 'asc' } }),
    ]);
    const parts = participantsOf(s);
    res.json({
      rooms: s.defenseRooms, maxPerSession: s.defenseMaxPerSession, participants: parts.filter((id) => users.some((u) => u.id === id)),
      users, associates, canManage: isAdmin(req), canCreate: true, isParticipant: parts.includes(req.user!.id), ...defenseCfg(s),
    });
  } catch (e) { next(e); }
});

router.put('/config', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const data: any = {};
    if (b.rooms !== undefined) {
      const n = Number(b.rooms);
      if (!Number.isInteger(n) || n < 1 || n > MAX_ROOMS) throw new AppError(`Número de salas entre 1 e ${MAX_ROOMS}`, 400);
      const used = await prisma.defenseSession.findFirst({ where: { workspaceId, room: { gt: n }, day: { gte: maputoNow().day } }, select: { room: true } });
      if (used) throw new AppError(`A sala ${used.room} ainda tem sessões marcadas. Mude-as de sala primeiro.`, 409);
      data.defenseRooms = n;
    }
    if (b.maxPerSession !== undefined) {
      const n = Number(b.maxPerSession);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new AppError('Máximo por sessão entre 0 (sem limite) e 20', 400);
      data.defenseMaxPerSession = n;
    }
    // Horario, popup e nomes das salas
    const cur = defenseCfg(await getSettings(workspaceId));
    const cfg: DefenseCfg = { ...cur };
    if (b.schedule !== undefined) {
      if (!Array.isArray(b.schedule) || b.schedule.length !== 7) throw new AppError('Horário inválido', 400);
      cfg.schedule = b.schedule.map((d: any, i: number) => {
        const start = Number(d?.start), end = Number(d?.end), on = !!d?.on;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || (on && end <= start)) {
          throw new AppError(`Horário de ${WEEKDAYS[i]}: a hora de fim tem de ser depois da de início`, 400);
        }
        return { on, start, end };
      });
    }
    if (b.gateEnabled !== undefined) cfg.gateEnabled = !!b.gateEnabled;
    if (b.gateTime !== undefined) {
      if (typeof b.gateTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.gateTime)) throw new AppError('Hora do aviso inválida (ex.: 16:30)', 400);
      cfg.gateTime = b.gateTime;
    }
    if (b.minChoices !== undefined) {
      const n = Number(b.minChoices);
      if (!Number.isInteger(n) || n < 1 || n > 12) throw new AppError('Número mínimo de sessões entre 1 e 12', 400);
      cfg.minChoices = n;
    }
    if (b.gateMode !== undefined) {
      if (!['block', 'remind'].includes(b.gateMode)) throw new AppError('Modo do aviso inválido', 400);
      cfg.gateMode = b.gateMode;
    }
    if (b.fillMin !== undefined) {
      const n = Number(b.fillMin);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new AppError('Equilíbrio: número entre 0 (desligado) e 10', 400);
      cfg.fillMin = n;
    }
    if (b.gateRules !== undefined) {
      if (!Array.isArray(b.gateRules) || b.gateRules.length !== 7) throw new AppError('Regras do aviso inválidas', 400);
      cfg.gateRules = b.gateRules.map((r: any, i: number) => {
        const daysBefore = Number(r?.daysBefore);
        if (!Number.isInteger(daysBefore) || daysBefore < 1 || daysBefore > 6) throw new AppError(`Sessões de ${WEEKDAYS[i]}: escolhe entre 1 e 6 dias antes`, 400);
        const time = r?.time ? String(r.time) : null;
        if (time && !HHMM.test(time)) throw new AppError(`Sessões de ${WEEKDAYS[i]}: hora inválida`, 400);
        return { daysBefore, time };
      });
    }
    if (b.roomNames !== undefined) {
      if (!Array.isArray(b.roomNames)) throw new AppError('Nomes das salas inválidos', 400);
      cfg.roomNames = b.roomNames.slice(0, MAX_ROOMS).map((n: any) => (typeof n === 'string' ? n.trim().slice(0, 40) : ''));
    }
    data.defenseConfig = cfg;
    if (b.participants !== undefined) {
      if (!Array.isArray(b.participants)) throw new AppError('Lista de participantes inválida', 400);
      const ids: string[] = [...new Set<string>(b.participants.map(String))];
      const found = await prisma.user.count({ where: { workspaceId, id: { in: ids } } });
      if (found !== ids.length) throw new AppError('Há participantes que não são deste workspace', 400);
      data.defenseParticipants = ids;
    }
    await prisma.financeSettings.update({ where: { workspaceId }, data });
    emit(req);
    // Sessoes ja marcadas que ficaram fora do novo horario (nao sao apagadas).
    const future = await prisma.defenseSession.findMany({ where: { workspaceId, day: { gte: maputoNow().day } }, select: { day: true, hour: true } });
    res.json({ ok: true, outside: future.filter((x) => !hoursFor(x.day, cfg).includes(x.hour)).length });
  } catch (e) { next(e); }
});

// ---------- Agenda ----------
router.get('/week', async (req: AuthRequest, res: Response, next) => {
  try {
    const start = weekStart(typeof req.query.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start) ? req.query.start : maputoNow().day);
    const sessions = await prisma.defenseSession.findMany({
      where: { workspaceId: req.user!.workspaceId, day: { gte: start, lte: addDays(start, 6) } },
      include: sessionInclude, orderBy: [{ day: 'asc' }, { hour: 'asc' }, { room: 'asc' }],
    });
    res.json({ start, today: maputoNow().day, sessions: sessions.map(dto) });
  } catch (e) { next(e); }
});

async function slotFields(workspaceId: string, b: any, cur?: { day: string; hour: number; room: number }) {
  const s = await getSettings(workspaceId);
  const cfg = defenseCfg(s);
  const day = b.day !== undefined ? validDay(b.day) : cur!.day;
  const hour = b.hour !== undefined ? Number(b.hour) : cur!.hour;
  const room = b.room !== undefined ? Number(b.room) : cur!.room;
  // Uma sessao que ja existia pode continuar onde estava, mesmo que o horario tenha mudado depois.
  const unchanged = cur && cur.day === day && cur.hour === hour;
  if (!unchanged && !hoursFor(day, cfg).includes(hour)) {
    const d = cfg.schedule[dow(day)];
    throw new AppError(d.on ? `À ${WEEKDAYS[dow(day)]} as sessões são das ${d.start}h às ${d.end}h` : `Não há sessões à ${WEEKDAYS[dow(day)]}`, 400);
  }
  if (!Number.isInteger(room) || room < 1 || room > s.defenseRooms) throw new AppError('Sala inválida', 400);
  return { day, hour, room };
}

async function studentFor(workspaceId: string, b: any) {
  const st = await prisma.financeStudent.findFirst({ where: { id: String(b.studentId || ''), workspaceId } });
  if (!st) throw new AppError('Escolhe o estudante', 400);
  const contactId = await ensureContact(workspaceId, st, text(b.contactId));
  return { studentId: st.id, contactId, title: st.name, studentAssociateId: st.associateId };
}

async function associateFor(workspaceId: string, v: any): Promise<string | null> {
  if (!v) return null;
  const a = await prisma.financeAssociate.findFirst({ where: { id: String(v), workspaceId }, select: { id: true } });
  if (!a) throw new AppError('Associado não encontrado', 400);
  return a.id;
}

// Proxima sessao de um estudante: numero (maior que ja tem + 1) e os slides da sessao mais recente que os tenha.
async function studentNext(workspaceId: string, studentId: string, excludeId?: string) {
  const list = await prisma.defenseSession.findMany({
    where: { workspaceId, studentId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { number: true, slidesUrl: true, slidesName: true },
    orderBy: [{ day: 'desc' }, { hour: 'desc' }],
  });
  const maxNum = list.reduce((a, x) => Math.max(a, x.number || 0), 0);
  const withSlides = list.find((x) => x.slidesUrl);
  return {
    number: Math.max(maxNum, list.length) + 1,
    slidesUrl: withSlides?.slidesUrl || null,
    slidesName: withSlides?.slidesName || null,
  };
}

function sessionNumber(v: any): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new AppError('Número da sessão inválido', 400);
  return n;
}

router.get('/students/:id/next', async (req: AuthRequest, res: Response, next) => {
  try {
    const st = await prisma.financeStudent.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId }, select: { id: true } });
    if (!st) throw new AppError('Estudante não encontrado', 404);
    res.json(await studentNext(req.user!.workspaceId, st.id, typeof req.query.exclude === 'string' ? req.query.exclude : undefined));
  } catch (e) { next(e); }
});

// Slides: so ficheiros enviados pelo CRM (/uploads/...).
function slidesFields(b: any) {
  if (b.slidesUrl === undefined) return {};
  if (!b.slidesUrl) return { slidesUrl: null, slidesName: null, slidesAt: null };
  const url = String(b.slidesUrl);
  if (!/^\/uploads\/[^/]+$/.test(url)) throw new AppError('Ficheiro dos slides inválido', 400);
  return { slidesUrl: url, slidesName: text(b.slidesName) || 'Slides', slidesAt: new Date() };
}

const conflict = (e: any) => {
  if (e?.code === 'P2002') return new AppError('Já há uma sessão nessa sala a essa hora.', 409);
  return e;
};

// Qualquer pessoa do M.E.T.A. cria sessoes; so administradores editam e apagam.
router.post('/sessions', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const slot = await slotFields(workspaceId, b);
    const { studentAssociateId, ...st } = await studentFor(workspaceId, b);
    // Sem escolha, o responsavel e o associado do estudante.
    const associateId = b.associateId !== undefined ? await associateFor(workspaceId, b.associateId) : studentAssociateId;
    // Numero: o escrito, ou o maior que o estudante ja tem + 1. Slides: os enviados, ou os da sessao anterior dele.
    const prev = await studentNext(workspaceId, st.studentId);
    const number = b.number !== undefined && b.number !== null && b.number !== '' ? sessionNumber(b.number) : prev.number;
    const slides = b.slidesUrl ? slidesFields(b) : !b.noSlides && prev.slidesUrl ? { slidesUrl: prev.slidesUrl, slidesName: prev.slidesName, slidesAt: new Date() } : {};
    const created = await prisma.defenseSession.create({
      data: { workspaceId, ...slot, ...st, number, associateId, ...slides, notes: text(b.notes), createdById: req.user!.id }, include: sessionInclude,
    }).catch((e) => { throw conflict(e); });
    emit(req, slot.day);
    res.status(201).json(dto(created));
  } catch (e) { next(e); }
});

router.patch('/sessions/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.defenseSession.findFirst({ where: { id: req.params.id, workspaceId } });
    if (!cur) throw new AppError('Sessão não encontrada', 404);
    const b = req.body || {};
    const data: any = await slotFields(workspaceId, b, cur);
    if (b.studentId !== undefined && b.studentId !== cur.studentId) {
      const { studentAssociateId, ...st } = await studentFor(workspaceId, b);
      Object.assign(data, st);
      if (b.associateId === undefined) data.associateId = studentAssociateId;
    } else if (b.contactId && cur.studentId) {
      const { studentAssociateId: _a, ...st } = await studentFor(workspaceId, { ...b, studentId: cur.studentId });
      Object.assign(data, st);
    }
    if (b.associateId !== undefined) data.associateId = await associateFor(workspaceId, b.associateId);
    if (b.number !== undefined) data.number = sessionNumber(b.number);
    Object.assign(data, slidesFields(b));
    if (b.notes !== undefined) data.notes = text(b.notes);
    const up = await prisma.defenseSession.update({ where: { id: cur.id }, data, include: sessionInclude }).catch((e) => { throw conflict(e); });
    emit(req, up.day);
    res.json(dto(up));
  } catch (e) { next(e); }
});

router.delete('/sessions/:id', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const cur = await prisma.defenseSession.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!cur) throw new AppError('Sessão não encontrada', 404);
    await prisma.defenseSession.delete({ where: { id: cur.id } });
    emit(req, cur.day);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Anexar / tirar os slides: administrador, o associado responsavel (a conta dele) ou quem criou a sessao.
router.put('/sessions/:id/slides', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const cur = await prisma.defenseSession.findFirst({ where: { id: req.params.id, workspaceId }, include: { associate: { select: { userId: true } } } });
    if (!cur) throw new AppError('Sessão não encontrada', 404);
    if (!isAdmin(req) && cur.associate?.userId !== req.user!.id && cur.createdById !== req.user!.id) {
      throw new AppError('Só o associado responsável pelo estudante (ou um administrador) anexa os slides', 403);
    }
    const data = slidesFields({ slidesUrl: req.body?.slidesUrl ?? null, slidesName: req.body?.slidesName });
    const up = await prisma.defenseSession.update({ where: { id: cur.id }, data, include: sessionInclude });
    emit(req, up.day);
    res.json(dto(up));
  } catch (e) { next(e); }
});

// Entrar numa sessao (com o limite por sessao). Admin pode por outra pessoa (userId).
// balance: aplica o enchimento equilibrado (quem entra por si; um administrador a por alguem nao).
async function join(req: AuthRequest, sessionId: string, userId: string, tx: any = prisma, balance = false) {
  const workspaceId = req.user!.workspaceId;
  const s = await getSettings(workspaceId);
  const ses = await tx.defenseSession.findFirst({ where: { id: sessionId, workspaceId }, include: { participants: true } });
  if (!ses) throw new AppError('Sessão não encontrada', 404);
  if (ses.day < maputoNow().day) throw new AppError('Essa sessão já passou', 400);
  if (ses.participants.some((p: any) => p.userId === userId)) return ses;
  if (s.defenseMaxPerSession && ses.participants.length >= s.defenseMaxPerSession) {
    throw new AppError(`A sessão das ${ses.hour}h (sala ${ses.room}) já está cheia. Escolhe outra.`, 409);
  }
  if (balance) {
    const cfg = defenseCfg(s);
    const day = await tx.defenseSession.findMany({ where: { workspaceId, day: ses.day }, include: { participants: { select: { userId: true } } } });
    const isMine = (x: any) => x.participants.some((p: any) => p.userId === userId);
    const myHours = new Set(day.filter(isMine).map((x: any) => x.hour));
    if (myHours.has(ses.hour)) throw new AppError(`Já estás noutra sessão às ${ses.hour}h.`, 409);
    if (cfg.fillMin > 0) {
      const cands = day.filter((x: any) => !isMine(x) && !myHours.has(x.hour) && (!s.defenseMaxPerSession || x.participants.length < s.defenseMaxPerSession));
      const min = Math.min(...cands.map((x: any) => x.participants.length));
      if (min < cfg.fillMin && ses.participants.length > min) {
        throw new AppError(`Ainda há sessões neste dia com ${min} ${min === 1 ? 'associado' : 'associados'}. Escolhe primeiro uma dessas: só se entra numa sessão com mais gente quando todas tiverem ${cfg.fillMin}.`, 409);
      }
    }
  }
  await tx.defenseParticipant.create({ data: { sessionId, userId } }).catch((e: any) => { if (e?.code !== 'P2002') throw e; });
  return ses;
}

function canJoin(req: AuthRequest, s: { defenseParticipants: any }) {
  if (!isAdmin(req) && !participantsOf(s).includes(req.user!.id)) throw new AppError('Não estás na lista de quem participa nas simulações.', 403);
}

router.post('/sessions/:id/join', async (req: AuthRequest, res: Response, next) => {
  try {
    const s = await getSettings(req.user!.workspaceId);
    let userId = req.user!.id;
    if (req.body?.userId && req.body.userId !== userId) {
      if (!isAdmin(req)) throw new AppError('Só um administrador pode pôr outra pessoa numa sessão', 403);
      const u = await prisma.user.findFirst({ where: { id: String(req.body.userId), workspaceId: req.user!.workspaceId }, select: { id: true } });
      if (!u) throw new AppError('Colaborador não encontrado', 404);
      userId = u.id;
    } else canJoin(req, s);
    const ses = await join(req, req.params.id, userId, prisma, userId === req.user!.id);
    emit(req, ses.day);
    res.json(dto(await prisma.defenseSession.findUniqueOrThrow({ where: { id: ses.id }, include: sessionInclude })));
  } catch (e) { next(e); }
});

router.delete('/sessions/:id/join', async (req: AuthRequest, res: Response, next) => {
  try {
    const ses = await prisma.defenseSession.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!ses) throw new AppError('Sessão não encontrada', 404);
    let userId = req.user!.id;
    if (req.query.userId && req.query.userId !== userId) {
      if (!isAdmin(req)) throw new AppError('Só um administrador pode tirar outra pessoa de uma sessão', 403);
      userId = String(req.query.userId);
    }
    if (ses.day < maputoNow().day && !isAdmin(req)) throw new AppError('Essa sessão já passou', 400);
    // Quem esta na lista tem de ficar sempre com o minimo de sessoes nesse dia: para sair de uma,
    // precisa de ter mais do que o minimo (ex.: minimo 2 -> so sai se tiver 3 ou mais).
    // Um administrador a tirar outra pessoa nao fica preso a esta regra.
    if (userId === req.user!.id) {
      const s = await getSettings(req.user!.workspaceId);
      const cfg = defenseCfg(s);
      if (cfg.gateEnabled && participantsOf(s).includes(userId)) {
        const daySessions = await prisma.defenseSession.findMany({
          where: { workspaceId: req.user!.workspaceId, day: ses.day }, include: { participants: { select: { userId: true } } },
        });
        const mine = daySessions.filter((x) => x.participants.some((p) => p.userId === userId));
        if (mine.some((x) => x.id === ses.id)) {
          const open = daySessions.filter((x) => mine.includes(x) || !s.defenseMaxPerSession || x.participants.length < s.defenseMaxPerSession);
          const required = Math.min(cfg.minChoices, open.length);
          if (mine.length - 1 < required) {
            throw new AppError(`Tens de ficar com pelo menos ${required} ${required === 1 ? 'sessão' : 'sessões'} neste dia. Para sair desta, escolhe primeiro outra.`, 409);
          }
        }
      }
    }
    await prisma.defenseParticipant.deleteMany({ where: { sessionId: ses.id, userId } });
    emit(req, ses.day);
    res.json(dto(await prisma.defenseSession.findUniqueOrThrow({ where: { id: ses.id }, include: sessionInclude })));
  } catch (e) { next(e); }
});

// ---------- Escolha das sessoes do dia seguinte (a partir da hora do aviso) ----------
async function pendingFor(req: AuthRequest) {
  const workspaceId = req.user!.workspaceId;
  const s = await getSettings(workspaceId);
  const cfg = defenseCfg(s);
  const targets = cfg.gateEnabled ? openTargets(cfg) : [];
  const base = {
    required: 0, day: targets[0] || addDays(maputoNow().day, 1), sessions: [] as any[], mine: [] as string[], slides: [] as any[],
    maxPerSession: s.defenseMaxPerSession, mode: cfg.gateMode, gateTime: cfg.gateTime, roomNames: cfg.roomNames, fillMin: cfg.fillMin,
  };
  if (!targets.length) return base;
  const isParticipant = participantsOf(s).includes(req.user!.id);
  const all = await prisma.defenseSession.findMany({
    where: { workspaceId, day: { in: targets } }, include: sessionInclude, orderBy: [{ day: 'asc' }, { hour: 'asc' }, { room: 'asc' }],
  });
  // Um dia de cada vez, o mais proximo primeiro: escolher sessoes (quem esta na lista) e anexar os slides (responsavel).
  for (const day of targets) {
    const sessions = all.filter((x) => x.day === day);
    const slides = sessions.filter((x) => x.associate?.userId === req.user!.id && !x.slidesUrl).map(dto);
    const mine = sessions.filter((x) => x.participants.some((p) => p.userId === req.user!.id)).map((x) => x.id);
    let required = 0;
    if (isParticipant) {
      const open = sessions.filter((x) => mine.includes(x.id) || !s.defenseMaxPerSession || x.participants.length < s.defenseMaxPerSession);
      const need = Math.min(cfg.minChoices, open.length);
      if (mine.length < need) required = need;
    }
    if (required || slides.length) return { ...base, day, required, sessions: required ? sessions.map(dto) : [], mine, slides };
  }
  return base;
}

router.get('/pending', async (req: AuthRequest, res: Response, next) => {
  try { res.json(await pendingFor(req)); } catch (e) { next(e); }
});

router.post('/choose', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const s = await getSettings(workspaceId);
    canJoin(req, s);
    const ids: string[] = Array.isArray(req.body?.sessionIds) ? [...new Set<string>(req.body.sessionIds.map(String))] : [];
    if (!ids.length) throw new AppError('Escolhe as sessões', 400);
    const targets = openTargets(defenseCfg(s));
    const found = await prisma.defenseSession.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, day: true, _count: { select: { participants: true } } } });
    if (found.length !== ids.length || found.some((f) => !targets.includes(f.day))) throw new AppError('Essas sessões ainda não estão abertas para escolha', 400);
    // As com menos gente primeiro, para o equilibrio aceitar a escolha toda.
    const ordered = [...found].sort((a, b) => a._count.participants - b._count.participants).map((f) => f.id);
    await prisma.$transaction(async (tx) => { for (const id of ordered) await join(req, id, req.user!.id, tx, true); });
    emit(req, found[0]?.day);
    res.json(await pendingFor(req));
  } catch (e) { next(e); }
});

export default router;
