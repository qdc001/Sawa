import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, Check, Loader2, MessageSquare } from 'lucide-react';
import api from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAuthStore } from '../../store';
import ChatPreviewModal from '../ChatPreviewModal';
import { DefensePending, DefenseSession, hourLabel, roomLabel, shortDay, weekdayName } from './types';

// Modo "so lembra": adiar 30 minutos (guardado neste computador).
const SNOOZE_KEY = 'meta.defense.snoozeUntil';
const snoozed = () => { try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 30 * 60000)); } catch { /* sem armazenamento */ } };

// A partir da hora definida (hora de Maputo), quem esta na lista de participantes tem de escolher
// sessoes de preparacao para defesa do dia seguinte. No modo "bloquear" este ecra tapa o CRM ate
// escolher (so da para ver o chat de cada estudante); no modo "lembrar" pode adiar 30 minutos.
export default function DefenseGate() {
  const { user } = useAuthStore();
  const [pending, setPending] = useState<DefensePending | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<DefenseSession | null>(null);

  const check = useCallback(() => {
    api.get<DefensePending>('/defense/pending').then(({ data }) => {
      setPending(data.required > 0 && !(data.mode === 'remind' && snoozed()) ? data : null);
      if (data.required === 0) setPicked(new Set());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    check();
    const t = setInterval(check, 60000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    const socket = getSocket();
    socket?.on('defense:changed', check);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); socket?.off('defense:changed', check); };
  }, [user, check]);

  if (!pending) return null;

  const mine = new Set(pending.mine);
  const total = mine.size + picked.size;
  const full = (s: DefenseSession) => !!pending.maxPerSession && s.participants.length >= pending.maxPerSession && !mine.has(s.id);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const confirm = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<DefensePending>('/defense/choose', { sessionIds: [...picked] });
      setPicked(new Set());
      if (data.required > 0) {
        setPending(data);
        toast.error(`Ainda faltam sessões: escolhe pelo menos ${data.required}.`);
      } else {
        setPending(null);
        toast.success('Sessões de amanhã confirmadas. Obrigado!');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Não foi possível guardar');
      check();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.88)' }}>
      <div className="card w-full max-w-2xl p-5 flex flex-col" style={{ maxHeight: '92vh' }} role="dialog" aria-modal="true" aria-labelledby="defense-gate-title">
        <div className="flex items-start gap-3 mb-3">
          <CalendarClock size={26} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <h2 id="defense-gate-title" className="text-lg font-bold">Preparação para defesa · {weekdayName(pending.day)} {shortDay(pending.day)}</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Escolhe <b>pelo menos {pending.required} {pending.required === 1 ? 'sessão' : 'sessões'}</b> de amanhã em que vais participar.
              {pending.mode === 'block' ? ' Só depois podes continuar a usar o CRM.' : ''}
              Podes abrir o chat de cada estudante para te preparares.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {pending.sessions.map((s) => {
            const joined = mine.has(s.id);
            const on = joined || picked.has(s.id);
            const disabled = joined || full(s);
            return (
              <div key={s.id} className="rounded p-2.5 flex items-center gap-3"
                style={{ border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary-light)' : 'var(--surface)', opacity: full(s) ? 0.55 : 1 }}>
                <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(s.id)} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{hourLabel(s.hour)} · {roomLabel(pending, s.room)}</div>
                    <div className="text-sm truncate">{s.title}{s.student ? ` (${s.student.code}${s.student.project ? ` · ${s.student.project}` : ''})` : ''}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {s.participants.length ? `Com: ${s.participants.map((p) => p.name).join(', ')}` : 'Ainda ninguém escolheu'}
                      {pending.maxPerSession ? ` · ${s.participants.length}/${pending.maxPerSession}` : ''}
                      {joined ? ' · já estás nesta' : full(s) ? ' · cheia' : ''}
                    </div>
                  </div>
                </label>
                {s.contactId && (
                  <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setChat(s)} title="Ver o chat com o estudante">
                    <MessageSquare size={13} /> Chat
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <span className="text-sm" style={{ color: total >= pending.required ? '#059669' : 'var(--text-secondary)' }}>{total}/{pending.required} escolhidas</span>
          {pending.mode === 'remind' && (
            <button className="btn btn-outline ml-auto" onClick={() => { snooze(); setPending(null); setPicked(new Set()); }}>Lembrar daqui a 30 min</button>
          )}
          <button className={`btn btn-primary ${pending.mode === 'remind' ? '' : 'ml-auto'}`} disabled={busy || total < pending.required || picked.size === 0} onClick={confirm}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Confirmar sessões
          </button>
        </div>
      </div>
      {chat && <ChatPreviewModal contactId={chat.contactId} contactName={chat.title} onClose={() => setChat(null)} />}
    </div>
  );
}
