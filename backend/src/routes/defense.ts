// Preparacao para defesa (so M.E.T.A.): agenda de simulacoes por sala, em sessoes de 1 hora
// (8h-20h nos dias de semana, 8h-12h ao fim de semana). A partir das 16h30, quem esta na lista
// de participantes tem de escolher pelo menos 2 sessoes do dia seguinte antes de usar o CRM.
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { addDays, adminOnly, getSettings, isAdmin, maputoNow, metaOnly, text, weekStart } from '../lib/financeCommon';

const router = Router();
router.use(metaOnly);

export const GATE_MINUTES = 16 * 60 + 30;
const MIN_CHOICES = 2;
const MAX_ROOMS = 6;

const isWeekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00.000Z`).getUTCDay());
export const hoursFor = (day: string) => (isWeekend(day) ? [8, 9, 10, 11] : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
function validDay(v: any): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(`${v}T00:00:00.000Z`).getTime())) throw new AppError('Dia inválido', 400);
  return v;
}

const sessionInclude = {
  student: { select: { id: true, code: true, name: true, project: true, whatsapp: true } },
  participants: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
};
function dto(s: any) {
  return {
    id: s.id, day: s.day, hour: s.hour, room: s.room, title: s.title, notes: s.notes, studentId: s.studentId, contactId: s.contactId,
    student: s.student, participants: s.participants.map((p: any) => ({ userId: p.userId, name: p.user?.name || '' })),
  };
}

function emit(req: AuthRequest, day?: string) {
  req.app.get('io')?.to(`workspace:${req.user!.workspaceId}`).emit('defense:changed', { day });
}

const participantsOf = (s: { defenseParticipants: any }): string[] => (Array.isArray(s.defenseParticipants) ? s.defenseParticipants : []);

// O estudante tem de estar nos contactos para se poder abrir o chat a partir da agenda.
async function ensureContact(workspaceId: string, st: { id: string; name: string; whatsapp: string | null; contactId: string | null }, override?: string | null) {
  if (st.contactId && !override) {
    const c = await prisma.contact.findFirst({ where: { id: st.contactId, workspaceId }, select: { id: true } });
    if (c) return c.id;
  }
  let digits = String(override || st.whatsapp || '').replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('8')) digits = `258${digits}`;
  if (digits.length < 9 || digits.length > 15) throw new AppError(`${st.name} não tem um número de WhatsApp válido na ficha. Indica o número.`, 400);
  const tail = digits.slice(-9);
  let c = await prisma.contact.findFirst({
    where: { workspaceId, OR: [{ whatsapp: digits }, { whatsapp: { endsWith: tail } }, { phone: { endsWith: tail } }] },
    select: { id: true },
  });
  if (!c) {
    const [firstName, ...rest] = st.name.trim().split(/\s+/);
    c = await prisma.contact.create({ data: { workspaceId, firstName: firstName || st.name, lastName: rest.join(' ') || null, whatsapp: digits }, select: { id: true } });
  }
  await prisma.financeStudent.update({ where: { id: st.id }, data: { contactId: c.id, ...(override || !st.whatsapp ? { whatsapp: digits } : {}) } });
  return c.id;
}

// ---------- Configuracao ----------
router.get('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    const s = await getSettings(req.user!.workspaceId);
    const users = await prisma.user.findMany({ where: { workspaceId: req.user!.workspaceId }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
    const parts = participantsOf(s);
    res.json({
      rooms: s.defenseRooms, maxPerSession: s.defenseMaxPerSession, participants: parts.filter((id) => users.some((u) => u.id === id)),
      users, canManage: isAdmin(req), isParticipant: parts.includes(req.user!.id), minChoices: MIN_CHOICES, gateTime: '16:30',
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
    if (b.participants !== undefined) {
      if (!Array.isArray(b.participants)) throw new AppError('Lista de participantes inválida', 400);
      const ids: string[] = [...new Set<string>(b.participants.map(String))];
      const found = await prisma.user.count({ where: { workspaceId, id: { in: ids } } });
      if (found !== ids.length) throw new AppError('Há participantes que não são deste workspace', 400);
      data.defenseParticipants = ids;
    }
    await getSettings(workspaceId);
    await prisma.financeSettings.update({ where: { workspaceId }, data });
    emit(req);
    res.json({ ok: true });
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
  const day = b.day !== undefined ? validDay(b.day) : cur!.day;
  const hour = b.hour !== undefined ? Number(b.hour) : cur!.hour;
  const room = b.room !== undefined ? Number(b.room) : cur!.room;
  if (!hoursFor(day).includes(hour)) throw new AppError(isWeekend(day) ? 'Ao fim de semana as sessões são das 8h às 12h' : 'Nos dias de semana as sessões são das 8h às 20h', 400);
  if (!Number.isInteger(room) || room < 1 || room > s.defenseRooms) throw new AppError('Sala inválida', 400);
  return { day, hour, room };
}

async function studentFor(workspaceId: string, b: any) {
  const st = await prisma.financeStudent.findFirst({ where: { id: String(b.studentId || ''), workspaceId } });
  if (!st) throw new AppError('Escolhe o estudante', 400);
  const contactId = await ensureContact(workspaceId, st, text(b.whatsapp));
  return { studentId: st.id, contactId, title: st.name };
}

const conflict = (e: any) => {
  if (e?.code === 'P2002') return new AppError('Já há uma sessão nessa sala a essa hora.', 409);
  return e;
};

router.post('/sessions', adminOnly, async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const b = req.body || {};
    const slot = await slotFields(workspaceId, b);
    const st = await studentFor(workspaceId, b);
    const created = await prisma.defenseSession.create({
      data: { workspaceId, ...slot, ...st, notes: text(b.notes), createdById: req.user!.id }, include: sessionInclude,
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
    if (b.studentId !== undefined && b.studentId !== cur.studentId) Object.assign(data, await studentFor(workspaceId, b));
    else if (b.whatsapp && cur.studentId) Object.assign(data, await studentFor(workspaceId, { ...b, studentId: cur.studentId }));
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

// Entrar numa sessao (com o limite por sessao). Admin pode por outra pessoa (userId).
async function join(req: AuthRequest, sessionId: string, userId: string, tx: any = prisma) {
  const workspaceId = req.user!.workspaceId;
  const s = await getSettings(workspaceId);
  const ses = await tx.defenseSession.findFirst({ where: { id: sessionId, workspaceId }, include: { participants: true } });
  if (!ses) throw new AppError('Sessão não encontrada', 404);
  if (ses.day < maputoNow().day) throw new AppError('Essa sessão já passou', 400);
  if (ses.participants.some((p: any) => p.userId === userId)) return ses;
  if (s.defenseMaxPerSession && ses.participants.length >= s.defenseMaxPerSession) {
    throw new AppError(`A sessão das ${ses.hour}h (sala ${ses.room}) já está cheia. Escolhe outra.`, 409);
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
    const ses = await join(req, req.params.id, userId);
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
    await prisma.defenseParticipant.deleteMany({ where: { sessionId: ses.id, userId } });
    emit(req, ses.day);
    res.json(dto(await prisma.defenseSession.findUniqueOrThrow({ where: { id: ses.id }, include: sessionInclude })));
  } catch (e) { next(e); }
});

// ---------- Escolha obrigatoria das 16h30 ----------
async function pendingFor(req: AuthRequest) {
  const workspaceId = req.user!.workspaceId;
  const s = await getSettings(workspaceId);
  const { day, minutes } = maputoNow();
  const tomorrow = addDays(day, 1);
  const none = { required: 0, day: tomorrow, sessions: [] as any[], mine: [] as string[], maxPerSession: s.defenseMaxPerSession };
  if (!participantsOf(s).includes(req.user!.id) || minutes < GATE_MINUTES) return none;
  const sessions = await prisma.defenseSession.findMany({
    where: { workspaceId, day: tomorrow }, include: sessionInclude, orderBy: [{ hour: 'asc' }, { room: 'asc' }],
  });
  const mine = sessions.filter((x) => x.participants.some((p) => p.userId === req.user!.id)).map((x) => x.id);
  const open = sessions.filter((x) => mine.includes(x.id) || !s.defenseMaxPerSession || x.participants.length < s.defenseMaxPerSession);
  const required = Math.min(MIN_CHOICES, open.length);
  if (mine.length >= required) return { ...none, mine };
  return { ...none, required, sessions: sessions.map(dto), mine };
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
    const tomorrow = addDays(maputoNow().day, 1);
    const found = await prisma.defenseSession.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, day: true } });
    if (found.length !== ids.length || found.some((f) => f.day !== tomorrow)) throw new AppError('Só podes escolher sessões de amanhã aqui', 400);
    await prisma.$transaction(async (tx) => { for (const id of ids) await join(req, id, req.user!.id, tx); });
    emit(req, tomorrow);
    res.json(await pendingFor(req));
  } catch (e) { next(e); }
});

export default router;
