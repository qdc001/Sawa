import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, Check, FileText, Loader2, MessageSquare, Paperclip } from 'lucide-react';
import api from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAuthStore } from '../../store';
import ChatPreviewModal from '../ChatPreviewModal';
import { balanceBlock, DefensePending, DefenseSession, hourLabel, roomLabel, sessionTitle, shortDay, weekdayName } from './types';
import { SLIDES_ACCEPT, uploadSlides } from './slides';

// Modo "so lembra": adiar 30 minutos (guardado neste computador).
const SNOOZE_KEY = 'meta.defense.snoozeUntil';
const snoozed = () => { try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 30 * 60000)); } catch { /* sem armazenamento */ } };

// A partir da hora definida (hora de Maputo):
// - quem esta na lista de participantes tem de escolher sessoes do dia seguinte;
// - o associado responsavel por um estudante com sessao amanha tem de anexar os slides.
// No modo "bloquear" este ecra tapa o CRM ate estar tudo feito (so da para ver o chat); no modo "lembrar" pode adiar 30 minutos.
export default function DefenseGate() {
  const { user } = useAuthStore();
  const [pending, setPending] = useState<DefensePending | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [chat, setChat] = useState<DefenseSession | null>(null);

  const check = useCallback(() => {
    api.get<DefensePending>('/defense/pending').then(({ data }) => {
      const open = data.required > 0 || (data.slides?.length || 0) > 0;
      setPending(open && !(data.mode === 'remind' && snoozed()) ? data : null);
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
  const choosing = pending.required > 0;
  const slides = pending.slides || [];

  const confirm = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<DefensePending>('/defense/choose', { sessionIds: [...picked] });
      setPicked(new Set());
      if (data.required > 0) {
        setPending(data);
        toast.error(`Ainda faltam sessões: escolhe pelo menos ${data.required}.`);
      } else {
        toast.success(`Sessões de ${weekdayName(pending.day).toLowerCase()} confirmadas. Obrigado!`);
        check();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Não foi possível guardar');
      check();
    } finally { setBusy(false); }
  };

  const attach = async (s: DefenseSession, file: File | undefined) => {
    if (!file) return;
    setUploading(s.id);
    try {
      await api.put(`/defense/sessions/${s.id}/slides`, await uploadSlides(file));
      toast.success(`Slides de ${s.title} anexados`);
      check();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Não foi possível anexar');
    } finally { setUploading(null); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.88)' }}>
      <div className="card w-full max-w-2xl p-5 flex flex-col" style={{ maxHeight: '92vh' }} role="dialog" aria-modal="true" aria-labelledby="defense-gate-title">
        <div className="flex items-start gap-3 mb-3">
          <CalendarClock size={26} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <h2 id="defense-gate-title" className="text-lg font-bold">Preparação para defesa · {weekdayName(pending.day)} {shortDay(pending.day)}</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {choosing && <>Escolhe <b>pelo menos {pending.required} {pending.required === 1 ? 'sessão' : 'sessões'}</b> de {weekdayName(pending.day).toLowerCase()} em que vais participar. </>}
              {slides.length > 0 && <>Anexa os <b>slides</b> {slides.length === 1 ? 'do teu estudante' : 'dos teus estudantes'} com sessão {weekdayName(pending.day).toLowerCase()}. </>}
              {pending.mode === 'block' ? 'Só depois podes continuar a usar o CRM. ' : ''}
              Podes abrir o chat de cada estudante.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {slides.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold">Slides em falta</h3>
              {slides.map((s) => (
                <div key={s.id} className="rounded p-2.5 flex items-center gap-3" style={{ border: '1px solid #F59E0B', background: 'var(--surface)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{hourLabel(s.hour)} · {roomLabel(pending, s.room)}</div>
                    <div className="text-sm truncate">{sessionTitle(s)}{s.student ? ` (${s.student.code})` : ''}</div>
                  </div>
                  {s.contactId && (
                    <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setChat(s)} title="Ver o chat com o estudante">
                      <MessageSquare size={13} /> Chat
                    </button>
                  )}
                  <label className="btn btn-primary cursor-pointer" style={{ fontSize: 12, padding: '4px 10px' }}>
                    {uploading === s.id ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Anexar slides
                    <input type="file" accept={SLIDES_ACCEPT} className="hidden" disabled={uploading === s.id} onChange={(e) => attach(s, e.target.files?.[0])} />
                  </label>
                </div>
              ))}
            </div>
          )}
          {choosing && (
            <div className="space-y-1.5">
              {slides.length > 0 && <h3 className="text-sm font-semibold">Sessões de {weekdayName(pending.day).toLowerCase()}</h3>}
              {pending.sessions.map((s) => {
                const joined = mine.has(s.id);
                const on = joined || picked.has(s.id);
                const blocked = on ? null : balanceBlock(s, pending.sessions, user?.id, picked, pending.fillMin, pending.maxPerSession);
                const disabled = joined || full(s) || !!blocked;
                return (
                  <div key={s.id} className="rounded p-2.5 flex items-center gap-3"
                    style={{ border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary-light)' : 'var(--surface)', opacity: full(s) || blocked ? 0.55 : 1 }}>
                    <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" title={blocked || undefined}>
                      <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(s.id)} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{hourLabel(s.hour)} · {roomLabel(pending, s.room)}</div>
                        <div className="text-sm truncate">{sessionTitle(s)}{s.student ? ` (${s.student.code}${s.student.project ? ` · ${s.student.project}` : ''})` : ''}</div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {s.participants.length ? `Com: ${s.participants.map((p) => p.name).join(', ')}` : 'Ainda ninguém escolheu'}
                          {pending.maxPerSession ? ` · ${s.participants.length}/${pending.maxPerSession}` : ''}
                          {joined ? ' · já estás nesta' : full(s) ? ' · cheia' : blocked ? ` · ${blocked}` : ''}
                        </div>
                      </div>
                    </label>
                    {s.slidesUrl && <span title="Já tem slides"><FileText size={14} style={{ color: '#059669' }} /></span>}
                    {s.contactId && (
                      <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setChat(s)} title="Ver o chat com o estudante">
                        <MessageSquare size={13} /> Chat
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 mt-4">
          {choosing && <span className="text-sm" style={{ color: total >= pending.required ? '#059669' : 'var(--text-secondary)' }}>{total}/{pending.required} escolhidas</span>}
          {slides.length > 0 && <span className="text-sm" style={{ color: '#D97706' }}>{slides.length} {slides.length === 1 ? 'slide em falta' : 'slides em falta'}</span>}
          {pending.mode === 'remind' && (
            <button className="btn btn-outline ml-auto" onClick={() => { snooze(); setPending(null); setPicked(new Set()); }}>Lembrar daqui a 30 min</button>
          )}
          {choosing && (
            <button className={`btn btn-primary ${pending.mode === 'remind' ? '' : 'ml-auto'}`} disabled={busy || total < pending.required || picked.size === 0} onClick={confirm}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Confirmar sessões
            </button>
          )}
        </div>
      </div>
      {chat && <ChatPreviewModal contactId={chat.contactId} contactName={chat.title} onClose={() => setChat(null)} />}
    </div>
  );
}
