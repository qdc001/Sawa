import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, LogIn, LogOut, MessageSquare, Plus, Settings, Trash2, X } from 'lucide-react';
import api from '../lib/api';
import { useAuthStore } from '../store';
import { getSocket } from '../lib/socket';
import { isMetaWorkspace } from '../lib/useFinanceAccess';
import ChatPreviewModal from '../components/ChatPreviewModal';
import { addDays, errMsg, Field, maputoToday, Modal, mondayOf } from '../components/finance/shared';
import { DaySchedule, DefenseConfig, DefenseSession, hourLabel, hoursFor, roomLabel, shortDay, weekdayName, WEEKDAYS } from '../components/defense/types';

type StudentLite = { id: string; code: string; name: string; project: string | null; whatsapp: string | null; contactId: string | null };
type ContactLite = { id: string; firstName: string; lastName: string | null; whatsapp: string | null; phone: string | null };
const contactName = (c: ContactLite) => [c.firstName, c.lastName].filter(Boolean).join(' ');

// Escolha obrigatoria de um contacto que ja existe (para abrir o chat a partir da agenda).
function ContactPicker({ value, onChange, hint }: { value: ContactLite | null; onChange: (c: ContactLite | null) => void; hint: string }) {
  const [q, setQ] = useState(hint);
  const [list, setList] = useState<ContactLite[] | null>(null);
  useEffect(() => setQ(hint), [hint]);
  useEffect(() => {
    if (value) return;
    const term = q.trim();
    if (term.length < 2) { setList([]); return; }
    const t = setTimeout(() => {
      api.get<{ contacts: ContactLite[] }>('/contacts', { params: { search: term, limit: 10 } })
        .then(({ data }) => setList(data.contacts || [])).catch(() => setList([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: 'var(--surface-2)' }}>
        <span className="flex-1"><b>{contactName(value)}</b>{value.whatsapp || value.phone ? <span style={{ color: 'var(--text-muted)' }}> · {value.whatsapp || value.phone}</span> : null}</span>
        <button onClick={() => onChange(null)} aria-label="Mudar contacto"><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <input className="input-base" placeholder="Procurar contacto por nome ou número" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="rounded" style={{ border: '1px solid var(--border)', maxHeight: 160, overflowY: 'auto' }}>
        {list === null ? <p className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>A procurar...</p> : list.length === 0 ? (
          <p className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>{q.trim().length < 2 ? 'Escreve pelo menos 2 letras.' : 'Nenhum contacto encontrado. Procura de outra forma (nome ou número).'}</p>
        ) : list.map((c) => (
          <button key={c.id} className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-100" onClick={() => onChange(c)}>
            {contactName(c)}<span style={{ color: 'var(--text-muted)' }}>{c.whatsapp || c.phone ? ` · ${c.whatsapp || c.phone}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionModal({ cfg, initial, session, students, onClose, onSaved }: {
  cfg: DefenseConfig; initial: { day: string; hour: number; room: number }; session: DefenseSession | null; students: StudentLite[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({ ...initial, studentId: session?.studentId || '', notes: session?.notes || '' });
  const [contact, setContact] = useState<ContactLite | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [addUser, setAddUser] = useState('');
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const chosen = students.find((s) => s.id === f.studentId) || (session?.student && session.student.id === f.studentId ? { ...session.student, contactId: session.contactId } as StudentLite : undefined);
  // Contacto ja ligado ao estudante (ou a sessao): mostra-o; senao fica por escolher.
  const linkedId = chosen ? (session && session.studentId === chosen.id ? session.contactId : null) || chosen.contactId : null;
  useEffect(() => {
    setContact(null);
    if (!linkedId) return;
    api.get<ContactLite>(`/contacts/${linkedId}`).then(({ data }) => setContact(data)).catch(() => setContact(null));
  }, [linkedId]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return students.filter((x) => !s || `${x.code} ${x.name}`.toLowerCase().includes(s)).slice(0, 60);
  }, [students, q]);

  const save = async () => {
    if (!f.studentId) { toast.error('Escolhe o estudante'); return; }
    if (!contact) { toast.error('Associa o estudante a um contacto'); return; }
    setBusy(true);
    try {
      const body = { day: f.day, hour: f.hour, room: f.room, studentId: f.studentId, notes: f.notes, contactId: contact.id };
      if (session) await api.patch(`/defense/sessions/${session.id}`, body);
      else await api.post('/defense/sessions', body);
      toast.success('Sessão guardada');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!session || !window.confirm('Apagar esta sessão? Quem a tinha escolhido deixa de a ter.')) return;
    try { await api.delete(`/defense/sessions/${session.id}`); toast.success('Sessão apagada'); onSaved(); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  const participant = async (userId: string, add: boolean) => {
    if (!session) return;
    try {
      if (add) await api.post(`/defense/sessions/${session.id}/join`, { userId });
      else await api.delete(`/defense/sessions/${session.id}/join`, { params: { userId } });
      onSaved();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <Modal title={session ? 'Sessão de preparação' : 'Nova sessão de preparação'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Dia"><input className="input-base" type="date" value={f.day} onChange={(e) => set('day', e.target.value)} /></Field>
          <Field label="Hora">
            <select className="input-base" value={f.hour} onChange={(e) => set('hour', Number(e.target.value))}>
              {[...new Set([...hoursFor(f.day, cfg.schedule), ...(session && session.day === f.day ? [session.hour] : [])])].sort((a, b) => a - b)
                .map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              {!hoursFor(f.day, cfg.schedule).length && <option value="">Sem sessões neste dia</option>}
            </select>
          </Field>
          <Field label="Sala">
            <select className="input-base" value={f.room} onChange={(e) => set('room', Number(e.target.value))}>
              {Array.from({ length: cfg.rooms }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{roomLabel(cfg, r)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Estudante">
          {chosen ? (
            <div className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: 'var(--surface-2)' }}>
              <span className="flex-1">{chosen.code} · <b>{chosen.name}</b>{chosen.project ? ` · ${chosen.project}` : ''}</span>
              <button onClick={() => set('studentId', '')} aria-label="Mudar estudante"><X size={14} /></button>
            </div>
          ) : (
            <div className="space-y-1">
              <input className="input-base" placeholder="Procurar por nome ou ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="rounded" style={{ border: '1px solid var(--border)', maxHeight: 180, overflowY: 'auto' }}>
                {list.map((s) => (
                  <button key={s.id} className="w-full text-left text-sm px-2 py-1.5 hover:bg-slate-100" onClick={() => set('studentId', s.id)}>
                    {s.code} · {s.name}{s.project ? <span style={{ color: 'var(--text-muted)' }}> · {s.project}</span> : null}
                  </button>
                ))}
                {!list.length && <p className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>Nenhum estudante encontrado</p>}
              </div>
            </div>
          )}
        </Field>
        {chosen && (
          <Field label="Contacto do estudante (obrigatório)">
            <ContactPicker value={contact} onChange={setContact} hint={chosen.whatsapp ? chosen.whatsapp.replace(/\D/g, '').slice(-9) : chosen.name} />
          </Field>
        )}
        {chosen && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>A ligação fica gravada na ficha do estudante e serve para abrir o chat a partir da agenda e do popup.</p>}
        <Field label="Notas (opcional)"><textarea className="input-base" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        {session && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Participantes</p>
            {session.participants.length === 0 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Ainda ninguém.</p>}
            {session.participants.map((p) => (
              <div key={p.userId} className="flex items-center justify-between text-sm">
                <span>{p.name}</span>
                <button onClick={() => participant(p.userId, false)} aria-label={`Tirar ${p.name}`}><X size={13} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <select className="input-base" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                <option value="">Pôr alguém nesta sessão</option>
                {cfg.users.filter((u) => !session.participants.some((p) => p.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn btn-outline" disabled={!addUser} onClick={() => { participant(addUser, true); setAddUser(''); }}>Pôr</button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" disabled={busy || !f.studentId || !contact} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Guardar</button>
          {session && <button className="btn btn-outline" onClick={remove} style={{ color: '#EF4444' }}><Trash2 size={14} /> Apagar</button>}
        </div>
      </div>
    </Modal>
  );
}

// Ordem de segunda a domingo (o servidor guarda 0 = domingo).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS_24 = Array.from({ length: 25 }, (_, i) => i);

function SettingsBox({ cfg, onSaved }: { cfg: DefenseConfig; onSaved: () => void }) {
  const [rooms, setRooms] = useState(cfg.rooms);
  const [max, setMax] = useState(cfg.maxPerSession);
  const [parts, setParts] = useState<Set<string>>(new Set(cfg.participants));
  const [schedule, setSchedule] = useState<DaySchedule[]>(cfg.schedule);
  const [gateEnabled, setGateEnabled] = useState(cfg.gateEnabled);
  const [gateTime, setGateTime] = useState(cfg.gateTime);
  const [minChoices, setMinChoices] = useState(cfg.minChoices);
  const [gateMode, setGateMode] = useState(cfg.gateMode);
  const [roomNames, setRoomNames] = useState<string[]>(Array.from({ length: 6 }, (_, i) => cfg.roomNames[i] || ''));
  const [busy, setBusy] = useState(false);
  const setDay = (d: number, k: keyof DaySchedule, v: any) => setSchedule((s) => s.map((x, i) => (i === d ? { ...x, [k]: v } : x)));
  const copyWeekdays = () => setSchedule((s) => s.map((x, i) => (i >= 1 && i <= 5 ? { ...s[1] } : x)));

  const save = async () => {
    const bad = schedule.findIndex((d) => d.on && d.end <= d.start);
    if (bad >= 0) { toast.error(`${WEEKDAYS[bad]}: a hora de fim tem de ser depois da de início`); return; }
    setBusy(true);
    try {
      const { data } = await api.put<{ outside: number }>('/defense/config', {
        rooms, maxPerSession: max, participants: [...parts], schedule, gateEnabled, gateTime, minChoices, gateMode, roomNames: roomNames.slice(0, rooms),
      });
      toast.success('Definições guardadas');
      if (data.outside) toast(`${data.outside} sessão(ões) já marcada(s) ficam fora do novo horário. Continuam na agenda; mude-as se for preciso.`, { duration: 7000 });
      onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const section = (title: string, hint?: string) => (
    <div className="mb-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {hint && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );

  return (
    <div className="card p-4 space-y-5">
      <div>
        {section('Dias e horários', 'Sessões de 1 hora. Desmarque os dias sem sessões. "Até" é a hora em que termina a última sessão.')}
        <div className="space-y-1.5">
          {WEEK_ORDER.map((d) => (
            <div key={d} className="flex items-center gap-2 flex-wrap text-sm">
              <label className="flex items-center gap-2 w-28 cursor-pointer">
                <input type="checkbox" checked={schedule[d].on} onChange={(e) => setDay(d, 'on', e.target.checked)} /> {WEEKDAYS[d]}
              </label>
              {schedule[d].on ? (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>das</span>
                  <select className="input-base" style={{ width: 'auto', padding: '4px 8px' }} value={schedule[d].start} onChange={(e) => setDay(d, 'start', Number(e.target.value))}>
                    {HOURS_24.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  <span style={{ color: 'var(--text-muted)' }}>até</span>
                  <select className="input-base" style={{ width: 'auto', padding: '4px 8px' }} value={schedule[d].end} onChange={(e) => setDay(d, 'end', Number(e.target.value))}>
                    {HOURS_24.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  <span className="text-xs" style={{ color: schedule[d].end > schedule[d].start ? 'var(--text-muted)' : '#DC2626' }}>
                    {schedule[d].end > schedule[d].start ? `${schedule[d].end - schedule[d].start} sessões por sala` : 'o fim tem de ser depois do início'}
                  </span>
                  {d === 1 && <button className="text-xs underline" style={{ color: 'var(--primary)' }} onClick={copyWeekdays}>Copiar para terça a sexta</button>}
                </>
              ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem sessões</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        {section('Salas')}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="Número de salas">
            <select className="input-base" value={rooms} onChange={(e) => setRooms(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Máximo de pessoas por sessão">
            <select className="input-base" value={max} onChange={(e) => setMax(Number(e.target.value))}>
              <option value={0}>Sem limite</option>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          {Array.from({ length: rooms }, (_, i) => (
            <Field key={i} label={`Nome da sala ${i + 1}`}>
              <input className="input-base" maxLength={40} placeholder={`Sala ${i + 1}`} value={roomNames[i]} onChange={(e) => setRoomNames((r) => r.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
        </div>
      </div>

      <div>
        {section('Aviso para escolher sessões', 'Quem está na lista abaixo recebe o aviso a partir desta hora e tem de escolher sessões do dia seguinte.')}
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
          <input type="checkbox" checked={gateEnabled} onChange={(e) => setGateEnabled(e.target.checked)} /> Mostrar o aviso
        </label>
        {gateEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="A partir das">
              <input className="input-base" type="time" value={gateTime} onChange={(e) => e.target.value && setGateTime(e.target.value)} />
            </Field>
            <Field label="Mínimo de sessões a escolher">
              <select className="input-base" value={minChoices} onChange={(e) => setMinChoices(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Tipo de aviso">
              <select className="input-base" value={gateMode} onChange={(e) => setGateMode(e.target.value as 'block' | 'remind')}>
                <option value="block">Bloqueia o CRM até escolher</option>
                <option value="remind">Só lembra (pode adiar 30 min)</option>
              </select>
            </Field>
          </div>
        )}
      </div>

      <div>
        {section('Quem participa', `Estas pessoas recebem o aviso${gateEnabled ? ` a partir das ${gateTime}` : ''} e podem entrar nas sessões.`)}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          {cfg.users.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={parts.has(u.id)} onChange={(e) => setParts((p) => { const n = new Set(p); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} />
              {u.name}
            </label>
          ))}
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Guardar definições</button>
    </div>
  );
}

export default function DefensePage() {
  const { user, workspace } = useAuthStore();
  const [start, setStart] = useState(() => mondayOf(maputoToday()));
  const [cfg, setCfg] = useState<DefenseConfig | null>(null);
  const [sessions, setSessions] = useState<DefenseSession[] | null>(null);
  const [today, setToday] = useState(maputoToday());
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [editing, setEditing] = useState<{ initial: { day: string; hour: number; room: number }; session: DefenseSession | null } | null>(null);
  const [chat, setChat] = useState<DefenseSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadCfg = useCallback(() => { api.get<DefenseConfig>('/defense/config').then(({ data }) => setCfg(data)).catch((e) => toast.error(errMsg(e))); }, []);
  const loadWeek = useCallback(() => {
    api.get<{ start: string; today: string; sessions: DefenseSession[] }>('/defense/week', { params: { start } })
      .then(({ data }) => { setSessions(data.sessions); setToday(data.today); }).catch((e) => toast.error(errMsg(e)));
  }, [start]);
  useEffect(loadCfg, [loadCfg]);
  useEffect(() => {
    loadWeek();
    const socket = getSocket();
    const onChange = () => loadWeek();
    socket?.on('defense:changed', onChange);
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadWeek(); }, 30000);
    return () => { socket?.off('defense:changed', onChange); clearInterval(t); };
  }, [loadWeek]);
  useEffect(() => {
    if (!cfg?.canManage) return;
    api.get<StudentLite[]>('/finance/students').then(({ data }) => setStudents(data)).catch(() => {});
  }, [cfg?.canManage]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  // Linhas da grelha: todas as horas com sessoes em algum dia desta semana (e sessoes antigas fora do horario).
  const gridHours = useMemo(() => {
    if (!cfg) return [];
    const set = new Set<number>();
    for (const d of days) for (const h of hoursFor(d, cfg.schedule)) set.add(h);
    for (const x of sessions || []) set.add(x.hour);
    return [...set].sort((a, b) => a - b);
  }, [cfg, days, sessions]);
  const bySlot = useMemo(() => new Map((sessions || []).map((s) => [`${s.day}|${s.hour}|${s.room}`, s])), [sessions]);
  // Para ver se a distribuicao e equitativa: quantas sessoes cada pessoa escolheu nesta semana.
  const fairness = useMemo(() => {
    if (!cfg || !sessions) return [];
    const count = new Map<string, number>();
    for (const s of sessions) for (const p of s.participants) count.set(p.userId, (count.get(p.userId) || 0) + 1);
    return cfg.users.filter((u) => cfg.participants.includes(u.id) || count.has(u.id)).map((u) => ({ name: u.name, n: count.get(u.id) || 0 })).sort((a, b) => b.n - a.n);
  }, [cfg, sessions]);

  // Igual ao servidor: quem esta na lista so pode sair de uma sessao se ficar com o minimo nesse dia.
  const lockedDays = useMemo(() => {
    const locked = new Set<string>();
    if (!cfg?.gateEnabled || !cfg.isParticipant || !sessions) return locked;
    const byDay = new Map<string, DefenseSession[]>();
    for (const x of sessions) byDay.set(x.day, [...(byDay.get(x.day) || []), x]);
    for (const [day, list] of byDay) {
      const mine = list.filter((x) => x.participants.some((p) => p.userId === user?.id));
      if (!mine.length) continue;
      const open = list.filter((x) => mine.includes(x) || !cfg.maxPerSession || x.participants.length < cfg.maxPerSession);
      if (mine.length - 1 < Math.min(cfg.minChoices, open.length)) locked.add(day);
    }
    return locked;
  }, [cfg, sessions, user?.id]);

  if (!isMetaWorkspace(workspace?.name)) return <Navigate to="/" replace />;

  const canJoin = !!cfg && (cfg.canManage || cfg.isParticipant);
  const toggleJoin = async (s: DefenseSession, joined: boolean) => {
    setBusy(s.id);
    try {
      if (joined) await api.delete(`/defense/sessions/${s.id}/join`);
      else await api.post(`/defense/sessions/${s.id}/join`, {});
      loadWeek();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}><CalendarClock size={20} /> Preparação para defesa</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Simulações por sala, em sessões de 1 hora.
            {cfg?.gateEnabled ? ` A partir das ${cfg.gateTime}, cada pessoa da lista escolhe pelo menos ${cfg.minChoices} ${cfg.minChoices === 1 ? 'sessão' : 'sessões'} do dia seguinte.` : ''}
          </p>
        </div>
        {cfg?.canManage && <button className="btn btn-outline" onClick={() => setShowSettings((v) => !v)}><Settings size={14} /> Definições</button>}
      </div>
      {showSettings && cfg && <SettingsBox key={JSON.stringify(cfg)} cfg={cfg} onSaved={() => { loadCfg(); loadWeek(); }} />}

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn btn-outline" style={{ padding: '4px 8px' }} aria-label="Semana anterior" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={14} /></button>
        <span className="text-sm font-medium">{shortDay(days[0])} a {shortDay(days[6])} de {days[6].slice(0, 4)}</span>
        <button className="btn btn-outline" style={{ padding: '4px 8px' }} aria-label="Semana seguinte" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={14} /></button>
        <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setStart(mondayOf(maputoToday()))}>Esta semana</button>
        {fairness.length > 0 && (
          <span className="text-xs ml-auto flex flex-wrap gap-x-3" style={{ color: 'var(--text-secondary)' }}>
            Sessões escolhidas nesta semana: {fairness.map((f) => <span key={f.name}><b>{f.name}</b> {f.n}</span>)}
          </span>
        )}
      </div>

      {!cfg || !sessions ? <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" /></div> : (
        Array.from({ length: cfg.rooms }, (_, i) => i + 1).map((room) => (
          <div key={room} className="card p-3 overflow-x-auto">
            <h3 className="font-semibold text-sm mb-2">{roomLabel(cfg, room)}</h3>
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 3, minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 92 }} />
                  {days.map((d) => (
                    <th key={d} className="text-xs font-semibold text-left px-1" style={{ color: d === today ? 'var(--primary)' : 'var(--text-secondary)' }}>
                      {weekdayName(d)} {shortDay(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gridHours.map((h) => (
                  <tr key={h}>
                    <td className="text-[11px] whitespace-nowrap pr-1" style={{ color: 'var(--text-muted)' }}>{hourLabel(h)}</td>
                    {days.map((d) => {
                      if (!hoursFor(d, cfg.schedule).includes(h) && !bySlot.get(`${d}|${h}|${room}`)) return <td key={d} style={{ background: 'var(--surface-3)', opacity: 0.35, borderRadius: 4 }} />;
                      const s = bySlot.get(`${d}|${h}|${room}`);
                      const past = d < today;
                      if (!s) {
                        return (
                          <td key={d} style={{ border: '1px dashed var(--border)', borderRadius: 4, height: 34 }}>
                            {cfg.canManage && !past && (
                              <button className="w-full h-full flex items-center justify-center opacity-40 hover:opacity-100" aria-label={`Marcar sessão ${weekdayName(d)} ${hourLabel(h)} sala ${room}`}
                                onClick={() => setEditing({ initial: { day: d, hour: h, room }, session: null })}><Plus size={13} /></button>
                            )}
                          </td>
                        );
                      }
                      const joined = s.participants.some((p) => p.userId === user?.id);
                      const full = !!cfg.maxPerSession && s.participants.length >= cfg.maxPerSession && !joined;
                      return (
                        <td key={d} className="align-top p-1.5 text-[11px]" style={{ background: joined ? 'var(--primary-light)' : 'var(--surface-2)', border: `1px solid ${joined ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 4, opacity: past ? 0.6 : 1 }}>
                          <button className="font-semibold text-left w-full truncate block" style={{ fontSize: 12 }} disabled={!cfg.canManage}
                            onClick={() => setEditing({ initial: { day: s.day, hour: s.hour, room: s.room }, session: s })} title={s.notes || s.title}>{s.title}</button>
                          <div className="truncate" style={{ color: 'var(--text-muted)' }}>
                            {s.participants.length ? s.participants.map((p) => p.name.split(' ')[0]).join(', ') : 'Ninguém ainda'}
                            {cfg.maxPerSession ? ` (${s.participants.length}/${cfg.maxPerSession})` : ''}
                          </div>
                          <div className="flex gap-1.5 mt-1">
                            {s.contactId && <button onClick={() => setChat(s)} title="Ver chat com o estudante" aria-label="Ver chat"><MessageSquare size={12} /></button>}
                            {canJoin && !past && joined && lockedDays.has(d) && (
                              <span title={`Tens de ficar com pelo menos ${cfg.minChoices} sessões neste dia. Para sair desta, escolhe primeiro outra.`} style={{ color: 'var(--text-muted)' }}>
                                Mínimo
                              </span>
                            )}
                            {canJoin && !past && !(joined && lockedDays.has(d)) && (
                              <button disabled={busy === s.id || full} onClick={() => toggleJoin(s, joined)} title={joined ? 'Sair desta sessão' : full ? 'Sessão cheia' : 'Participar nesta sessão'}
                                className="flex items-center gap-0.5" style={{ color: joined ? '#B91C1C' : 'var(--primary)', opacity: full ? 0.4 : 1 }}>
                                {joined ? <LogOut size={12} /> : <LogIn size={12} />} {joined ? 'Sair' : 'Participar'}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {editing && cfg && (
        <SessionModal cfg={cfg} initial={editing.initial} session={editing.session && (sessions || []).find((x) => x.id === editing.session!.id) || editing.session}
          students={students} onClose={() => setEditing(null)} onSaved={loadWeek} />
      )}
      {chat && <ChatPreviewModal contactId={chat.contactId} contactName={chat.title} onClose={() => setChat(null)} />}
    </div>
  );
}
