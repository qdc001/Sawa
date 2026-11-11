import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import api from '../../lib/api';
import { Associate, errMsg, inputSm, reloadPhases, usePhases } from './shared';
import { Student } from './FinanceStudents';

const LIMIT = 40;

// Quadro de fases. A fase vem do mesmo campo da ficha do estudante (currentPhase),
// por isso o quadro e a ficha mostram sempre o mesmo valor.
export default function FinancePhaseBoard({ associates, canEdit }: { associates: Associate[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [assoc, setAssoc] = useState('');
  const [hidePaidNoPhase, setHide] = useState(true);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [over, setOver] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const phases = usePhases();
  const dragId = useRef<string | null>(null);
  const pending = useRef(0);

  const load = useCallback((quiet = false) => {
    if (pending.current) return; // nao substitui uma mudanca ainda a gravar
    if (!quiet) setLoading(true);
    reloadPhases().catch(() => {});
    api.get<Student[]>('/finance/students').then(({ data }) => { if (!pending.current) setRows(data); })
      .catch((e) => { if (!quiet) toast.error(errMsg(e, 'Erro a carregar estudantes')); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    // Mantem o quadro igual ao que esta gravado, mesmo com mudancas feitas por outra pessoa.
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 20000);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const move = async (id: string, to: number | null) => {
    const st = rows.find((r) => r.id === id);
    if (!st || st.currentPhase === to || saving.has(id)) return;
    const from = st.currentPhase;
    pending.current++;
    setSaving((s) => new Set(s).add(id));
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, currentPhase: to } : r)));
    try {
      const { data } = await api.patch<Student>(`/finance/students/${id}/phase`, { phase: to, from });
      setRows((rs) => rs.map((r) => (r.id === id ? data : r)));
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, currentPhase: from } : r)));
      toast.error(errMsg(e, 'Não foi possível mudar a fase'));
    } finally {
      pending.current--;
      setSaving((s) => { const n = new Set(s); n.delete(id); return n; });
      if (!pending.current) load(true);
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !`${r.code} ${r.name} ${r.project || ''}`.toLowerCase().includes(s)) return false;
      if (assoc === '__none__' ? r.associate : assoc && r.associate?.id !== assoc) return false;
      if (hidePaidNoPhase && !r.currentPhase && r.status === 'Pago') return false;
      return true;
    });
  }, [rows, q, assoc, hidePaidNoPhase]);

  // Colunas = fases configuradas. Estudantes numa fase que ja foi removida ficam numa coluna propria, para nao desaparecerem.
  const { columns, byCol } = useMemo(() => {
    const cols: { key: string; phase: number | null; label: string; orphan?: boolean }[] = [
      { key: 'null', phase: null, label: 'Sem fase' },
      ...(phases || []).map((p, i) => ({ key: String(p.id), phase: p.id, label: `F${i + 1} · ${p.name}` })),
    ];
    const m = new Map<string, Student[]>(cols.map((c) => [c.key, []]));
    for (const r of filtered) {
      const k = String(r.currentPhase ?? null);
      if (!m.has(k)) {
        if (!m.has('orphan')) { m.set('orphan', []); cols.push({ key: 'orphan', phase: null, label: 'Fase removida', orphan: true }); }
        m.get('orphan')!.push(r);
      } else m.get(k)!.push(r);
    }
    return { columns: cols, byCol: m };
  }, [filtered, phases]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2" style={{ color: 'var(--text-muted)' }} />
          <input className="input-base" style={{ ...inputSm, paddingLeft: 26, width: 220 }} placeholder="Nome, ID, projecto..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {associates.length > 0 && (
          <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={assoc} onChange={(e) => setAssoc(e.target.value)}>
            <option value="">Todos os associados</option><option value="__none__">Sem associado</option>
            {associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={hidePaidNoPhase} onChange={(e) => setHide(e.target.checked)} /> Esconder pagos sem fase
        </label>
        <button className="btn btn-outline ml-auto" onClick={() => load()} title="Actualizar"><RefreshCw size={13} /> Actualizar</button>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {canEdit ? 'Arraste o cartão para outra coluna (ou escolha a fase no cartão). ' : ''}A fase é a mesma da ficha do estudante: o que muda aqui muda lá, e o contrário.
      </p>
      {loading || !phases ? <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" /></div> : (
        <div className="flex gap-3 overflow-x-auto pb-3" style={{ alignItems: 'flex-start' }}>
          {columns.map((c) => {
            const k = c.key;
            const list = byCol.get(k) || [];
            const shown = more[k] ? list : list.slice(0, LIMIT);
            return (
              <div
                key={k}
                className="rounded-lg p-2 flex-shrink-0"
                style={{ width: 230, background: over === k ? 'var(--primary-light)' : 'var(--surface-2)', border: `1px solid ${over === k ? 'var(--primary)' : 'var(--border)'}` }}
                onDragOver={(e) => { if (canEdit && dragId.current && !c.orphan) { e.preventDefault(); setOver(k); } }}
                onDragLeave={() => setOver((o) => (o === k ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = dragId.current; dragId.current = null; if (id && !c.orphan) move(id, c.phase); }}
              >
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-semibold truncate" title={c.label}>{c.label}</span>
                  <span className="text-[11px] px-1.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>{list.length}</span>
                </div>
                <div className="space-y-1.5" style={{ minHeight: 40 }}>
                  {shown.map((r) => (
                    <div
                      key={r.id}
                      draggable={canEdit && !saving.has(r.id)}
                      onDragStart={(e) => { dragId.current = r.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); }}
                      onDragEnd={() => { dragId.current = null; setOver(null); }}
                      className="rounded p-2 text-xs"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: canEdit ? 'grab' : 'default', opacity: saving.has(r.id) ? 0.55 : 1 }}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold truncate">{r.name}</span>
                        {saving.has(r.id) ? <Loader2 size={11} className="animate-spin" /> : <span style={{ color: 'var(--text-muted)' }}>{r.code}</span>}
                      </div>
                      <div className="truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{r.associate?.name || 'Sem associado'}{r.project ? ` · ${r.project}` : ''}</div>
                      {canEdit && (
                        <select
                          className="input-base mt-1.5" style={{ padding: '2px 4px', fontSize: 11 }}
                          value={c.orphan ? 'orphan' : r.currentPhase ?? ''} disabled={saving.has(r.id)}
                          onChange={(e) => { if (e.target.value !== 'orphan') move(r.id, e.target.value ? Number(e.target.value) : null); }}
                        >
                          {c.orphan && <option value="orphan">Fase removida</option>}
                          <option value="">Sem fase</option>
                          {(phases || []).map((p, i) => <option key={p.id} value={p.id}>F{i + 1} · {p.name}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                  {list.length > LIMIT && (
                    <button className="text-xs w-full py-1" style={{ color: 'var(--primary)' }} onClick={() => setMore((m) => ({ ...m, [k]: !m[k] }))}>
                      {more[k] ? 'Mostrar menos' : `Mostrar mais ${list.length - LIMIT}`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
