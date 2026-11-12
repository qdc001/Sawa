import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../store';
import { Badge, dateLabel, errMsg, Field, Modal, phaseLabel, today, usePhases } from './shared';

export type StudentEvent = {
  id: string; type: 'PHASE' | 'REVIEW' | 'ISSUE' | 'CORRECTION' | 'DEFENSE'; date: string; phaseId: number | null; fromPhase: number | null;
  result: string | null; grade: number | null; note: string | null; resolvedAt: string | null; createdById: string | null; createdByName: string | null;
};

const TYPES: { v: Exclude<StudentEvent['type'], 'PHASE'>; label: string }[] = [
  { v: 'REVIEW', label: 'Revisão técnica' },
  { v: 'ISSUE', label: 'Questão técnica' },
  { v: 'CORRECTION', label: 'Correcção pedida pelo estudante' },
  { v: 'DEFENSE', label: 'Defesa' },
];
const LABEL: Record<StudentEvent['type'], string> = {
  PHASE: 'Mudança de fase', REVIEW: 'Revisão técnica', ISSUE: 'Questão técnica', CORRECTION: 'Correcção pós-entrega', DEFENSE: 'Defesa',
};
export const DEFENSE_RESULTS = ['Aprovado', 'Aprovado com correcções', 'Reprovado', 'Adiado'];

// Historico do trabalho de um estudante. Alimenta os relatorios semanal e mensal.
export function StudentHistoryModal({ student, onClose }: { student: { id: string; code: string; name: string; currentPhase: number | null }; onClose: () => void }) {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const phases = usePhases() || [];
  const [list, setList] = useState<StudentEvent[] | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]['v']>('REVIEW');
  const [f, setF] = useState({ date: today(), phaseId: student.currentPhase ? String(student.currentPhase) : '', result: '', grade: '', note: '', resolvedAt: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const load = useCallback(() => {
    api.get<StudentEvent[]>(`/finance/work/students/${student.id}/events`).then(({ data }) => setList(data))
      .catch((e) => { toast.error(errMsg(e)); closeRef.current(); });
  }, [student.id]);
  useEffect(load, [load]);

  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/finance/work/students/${student.id}/events`, {
        type, date: f.date, note: f.note,
        ...(type === 'REVIEW' ? { phaseId: f.phaseId, result: f.result } : {}),
        ...(type === 'DEFENSE' ? { result: f.result, grade: f.grade } : {}),
        ...(type === 'ISSUE' || type === 'CORRECTION' ? { resolvedAt: f.resolvedAt || null, phaseId: f.phaseId || null } : {}),
      });
      toast.success('Registado');
      setF((p) => ({ ...p, result: '', grade: '', note: '', resolvedAt: '' }));
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const patch = async (ev: StudentEvent, body: any) => {
    try { await api.patch(`/finance/work/events/${ev.id}`, body); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (ev: StudentEvent) => {
    if (!window.confirm('Apagar este registo? Deixa de contar nos relatórios.')) return;
    try { await api.delete(`/finance/work/events/${ev.id}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const mayEdit = (ev: StudentEvent) => isAdmin || (ev.createdById === user?.id && ev.type !== 'PHASE');

  const detail = (ev: StudentEvent) => {
    if (ev.type === 'PHASE') return `${phaseLabel(phases, ev.fromPhase)} → ${phaseLabel(phases, ev.phaseId)}`;
    if (ev.type === 'REVIEW') return `${phaseLabel(phases, ev.phaseId)} · ${ev.result}`;
    if (ev.type === 'DEFENSE') return `${ev.result}${ev.grade !== null ? ` · nota ${ev.grade}` : ''}`;
    return ev.resolvedAt ? `Resolvida em ${dateLabel(ev.resolvedAt)}` : 'Por resolver';
  };
  const tone = (ev: StudentEvent): 'green' | 'amber' | 'red' | 'blue' | 'gray' => {
    if (ev.type === 'REVIEW') return ev.result === 'Aprovado' ? 'green' : 'amber';
    if (ev.type === 'DEFENSE') return ev.result === 'Reprovado' ? 'red' : ev.result === 'Adiado' ? 'gray' : 'green';
    if (ev.type === 'ISSUE' || ev.type === 'CORRECTION') return ev.resolvedAt ? 'green' : 'red';
    return 'blue';
  };

  return (
    <Modal title={`Histórico · ${student.code} ${student.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="p-3 rounded space-y-2" style={{ background: 'var(--surface-2)' }}>
          <div className="flex flex-wrap gap-1">
            {TYPES.map((t) => (
              <button key={t.v} onClick={() => { setType(t.v); set('result', ''); }} className="text-xs px-2.5 py-1 rounded font-medium"
                style={{ background: type === t.v ? 'var(--primary)' : 'var(--surface-3)', color: type === t.v ? '#fff' : 'var(--text-secondary)' }}>{t.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label="Data"><input className="input-base" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
            {(type === 'REVIEW' || type === 'ISSUE' || type === 'CORRECTION') && (
              <Field label={type === 'REVIEW' ? 'Fase revista' : 'Fase (opcional)'}>
                <select className="input-base" value={f.phaseId} onChange={(e) => set('phaseId', e.target.value)}>
                  <option value="">{type === 'REVIEW' ? 'Escolher' : '—'}</option>
                  {phases.map((p, i) => <option key={p.id} value={p.id}>F{i + 1} · {p.name}</option>)}
                </select>
              </Field>
            )}
            {type === 'REVIEW' && (
              <Field label="Resultado">
                <select className="input-base" value={f.result} onChange={(e) => set('result', e.target.value)}>
                  <option value="">Escolher</option><option>Aprovado</option><option value="Devolvido">Devolvido para correcção</option>
                </select>
              </Field>
            )}
            {type === 'DEFENSE' && (
              <>
                <Field label="Resultado">
                  <select className="input-base" value={f.result} onChange={(e) => set('result', e.target.value)}>
                    <option value="">Escolher</option>{DEFENSE_RESULTS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Nota (0-20, opcional)"><input className="input-base" type="number" min={0} max={20} step={0.1} value={f.grade} onChange={(e) => set('grade', e.target.value)} /></Field>
              </>
            )}
            {(type === 'ISSUE' || type === 'CORRECTION') && (
              <Field label="Resolvida em (se já está)"><input className="input-base" type="date" value={f.resolvedAt} onChange={(e) => set('resolvedAt', e.target.value)} /></Field>
            )}
          </div>
          <Field label={type === 'ISSUE' ? 'Qual é a questão?' : type === 'CORRECTION' ? 'O que o estudante pediu para corrigir?' : 'Observação (opcional)'}>
            <textarea className="input-base" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
          <button className="btn btn-primary" disabled={busy} onClick={add}>{busy && <Loader2 size={14} className="animate-spin" />} Registar</button>
        </div>

        {!list ? <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin" /></div> : list.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Ainda não há registos para este estudante.</p>
        ) : (
          <div className="space-y-1.5" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {list.map((ev) => (
              <div key={ev.id} className="rounded p-2 text-sm flex gap-3 items-start" style={{ border: '1px solid var(--border)' }}>
                <span className="text-xs whitespace-nowrap pt-0.5" style={{ color: 'var(--text-muted)' }}>{dateLabel(ev.date)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{LABEL[ev.type]}</span>
                    <Badge text={detail(ev)} tone={tone(ev)} />
                  </div>
                  {ev.note && <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{ev.note}</p>}
                  {ev.createdByName && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>por {ev.createdByName}</p>}
                </div>
                {mayEdit(ev) && (
                  <span className="flex gap-2 pt-0.5">
                    {(ev.type === 'ISSUE' || ev.type === 'CORRECTION') && (ev.resolvedAt
                      ? <button title="Reabrir" aria-label="Reabrir" onClick={() => patch(ev, { resolvedAt: null })}><RotateCcw size={13} /></button>
                      : <button title="Marcar como resolvida hoje" aria-label="Marcar como resolvida" onClick={() => patch(ev, { resolvedAt: today() })}><CheckCircle2 size={14} style={{ color: '#10B981' }} /></button>)}
                    <button title="Apagar" aria-label="Apagar" onClick={() => remove(ev)}><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
