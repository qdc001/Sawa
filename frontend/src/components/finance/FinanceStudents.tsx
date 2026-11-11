import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, Link2, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { Associate, Badge, dateLabel, errMsg, Field, Modal, monthLabel, mzn, num, Td, Th, today, WALLETS, inputSm } from './shared';

export const PHASES = ['Fundação Invisível', 'Engenharia da Pesquisa', 'Plano de Ataque', 'Base Científica', 'Análise e Discussão', 'Redacção Final', 'Defesa do TCC'];
export const PHASE_STATES = ['Entregue', 'Em curso', 'Pendente', 'Atrasado', 'Bloqueado'];
const PROJECTS = ['Mestrado', 'Licenciatura', 'Simulacao', 'Revisao', 'Projeto', 'Analise estatistica'];
const ORIGINS = ['Whatsap', 'Tiktok', 'Instagram', 'Recomendacao', 'Facebook'];
const PAGE = 50;

export type Student = {
  id: string; code: string; name: string; gender: string | null; whatsapp: string | null; faculty: string | null; course: string | null;
  theme: string | null; entryDate: string | null; sellerCredit: boolean | null; currentPhase: number | null; lastActivityAt: string | null;
  phases: Record<string, { status?: string; date?: string }>; notes: string | null; project: string | null; origin: string | null;
  totalValue: number; installments: number | null; paidAmount: number; installmentsPaid: number; nextDueDate: string | null;
  status: string; balance: number; associate: { id: string; code: string; name: string } | null; contactId: string | null;
};

function StudentModal({ student, associates, creditName, creditValue, onClose, onSaved }: { student: Student | null; associates: Associate[]; creditName: string; creditValue: number; onClose: () => void; onSaved: () => void }) {
  const s = student;
  const [f, setF] = useState({
    name: s?.name || '', gender: s?.gender || '', whatsapp: s?.whatsapp || '', associateId: s?.associate?.id || '',
    faculty: s?.faculty || '', course: s?.course || '', theme: s?.theme || '', entryDate: s ? s.entryDate?.slice(0, 10) || '' : today(),
    currentPhase: s?.currentPhase ? String(s.currentPhase) : '', lastActivityAt: s?.lastActivityAt?.slice(0, 10) || '', notes: s?.notes || '',
    project: s?.project || '', origin: s?.origin || '', totalValue: s ? String(s.totalValue) : '', installments: s?.installments ? String(s.installments) : '',
    nextDueDate: s?.nextDueDate?.slice(0, 10) || '',
  });
  const [sellerCredit, setCredit] = useState(s ? (s.sellerCredit ?? !!s.entryDate) : false);
  const [phases, setPhases] = useState<Student['phases']>(s?.phases || {});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setPhase = (n: number, k: 'status' | 'date', v: string) => setPhases((p) => {
    const cur = { ...(p[n] || {}) };
    if (v) cur[k] = v; else delete cur[k];
    const next = { ...p };
    if (Object.keys(cur).length) next[n] = cur; else delete next[n];
    return next;
  });
  const input = (k: keyof typeof f, type = 'text') => <input className="input-base" type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />;
  const save = async () => {
    if (!f.name.trim()) { toast.error('Indica o nome'); return; }
    setBusy(true);
    try {
      const body = { ...f, associateId: f.associateId || null, phases, sellerCredit };
      if (s) await api.patch(`/finance/students/${s.id}`, body);
      else await api.post('/finance/students', body);
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={s ? `Estudante ${s.code}` : 'Novo estudante'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2"><Field label="Nome">{input('name')}</Field></div>
          <Field label="Género">{input('gender')}</Field>
          <Field label="WhatsApp">{input('whatsapp')}</Field>
          <Field label="Associado">
            <select className="input-base" value={f.associateId} onChange={(e) => set('associateId', e.target.value)}>
              <option value="">Sem associado</option>{associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Data de entrada">{input('entryDate', 'date')}</Field>
          <Field label="Faculdade">{input('faculty')}</Field>
          <Field label="Curso">{input('course')}</Field>
          <Field label="Última actividade">{input('lastActivityAt', 'date')}</Field>
          <div className="sm:col-span-3"><Field label="Tema do TCC">{input('theme')}</Field></div>
          <label className="sm:col-span-3 flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={sellerCredit} onChange={(e) => setCredit(e.target.checked)} />
            Venda de {creditName} (recebe {mzn(creditValue)} no mês de entrada)
          </label>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Parcelamento</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Projecto">
              <select className="input-base" value={f.project} onChange={(e) => set('project', e.target.value)}>
                <option value="">Escolher</option>{[...new Set([...PROJECTS, ...(f.project ? [f.project] : [])])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Origem">
              <select className="input-base" value={f.origin} onChange={(e) => set('origin', e.target.value)}>
                <option value="">Escolher</option>{[...new Set([...ORIGINS, ...(f.origin ? [f.origin] : [])])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Valor total">{input('totalValue', 'number')}</Field>
            <Field label="Nº de parcelas">{input('installments', 'number')}</Field>
            <Field label="Próxima parcela">{input('nextDueDate', 'date')}</Field>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Fases do Método M.E.T.A.</h4>
          <div className="mb-2 max-w-xs">
            <Field label="Fase actual">
              <select className="input-base" value={f.currentPhase} onChange={(e) => set('currentPhase', e.target.value)}>
                <option value="">Sem fase</option>{PHASES.map((p, i) => <option key={p} value={i + 1}>F{i + 1} · {p}</option>)}
              </select>
            </Field>
          </div>
          <div className="space-y-1.5">
            {PHASES.map((p, i) => (
              <div key={p} className="grid grid-cols-[1fr_130px_140px] gap-2 items-center">
                <span className="text-xs truncate">F{i + 1} · {p}</span>
                <select className="input-base" style={inputSm} value={phases[i + 1]?.status || ''} onChange={(e) => setPhase(i + 1, 'status', e.target.value)}>
                  <option value="">—</option>{PHASE_STATES.map((st) => <option key={st}>{st}</option>)}
                </select>
                <input className="input-base" style={inputSm} type="date" value={phases[i + 1]?.date || ''} onChange={(e) => setPhase(i + 1, 'date', e.target.value)} />
              </div>
            ))}
          </div>
        </div>
        <Field label="Notas"><textarea className="input-base" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function PaymentModal({ student, associates, rate, onClose, onSaved }: { student: Student; associates: Associate[]; rate: number; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [paymentMethod, setMethod] = useState('');
  const [associateId, setAssociate] = useState(student.associate?.id || '');
  const [nextDueDate, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount) || 0;
  const save = async () => {
    if (!value) { toast.error('Indica o valor'); return; }
    if (!paymentMethod) { toast.error('Escolhe a forma de pagamento'); return; }
    setBusy(true);
    try {
      await api.post(`/finance/students/${student.id}/payments`, { date, amount, paymentMethod, associateId: associateId || null, nextDueDate: nextDueDate || null, notes });
      toast.success('Pagamento registado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pagamento de ${student.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Saldo: <b>{mzn(student.balance)}</b> · Parcelas pagas: {student.installmentsPaid}/{student.installments ?? '—'}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data do pagamento"><input className="input-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor (MZN)"><input className="input-base" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Forma de pagamento">
            <select className="input-base" value={paymentMethod} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Escolher</option>{WALLETS.map((w) => <option key={w} value={w}>{w === 'Fisico' ? 'Físico' : w}</option>)}
            </select>
          </Field>
          <Field label="Comissionista">
            <select className="input-base" value={associateId} onChange={(e) => setAssociate(e.target.value)}>
              <option value="">Sem comissão</option>{associates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Próxima parcela"><input className="input-base" type="date" value={nextDueDate} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Observação"><input className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Automática" /></Field>
        </div>
        {value > 0 && associateId && date.length === 10 && (
          <p className="text-xs p-2 rounded" style={{ background: 'var(--surface-2)' }}>
            A comissão de <b>{mzn(value * rate)}</b> ({Math.round(rate * 100)}%) entra no salário de <b>{monthLabel(date.slice(0, 7))}</b>.
          </p>
        )}
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Registar pagamento</button>
      </div>
    </Modal>
  );
}

type LinkResult = {
  applied: boolean; payments: number; alreadyLinked: number; newLinks: number;
  associateChanges: { code: string; name: string; from: string | null; to: string | null }[];
  unmatched: { id: string; period: string; description: string | null; revenue: number; commissionist: string | null }[];
  ambiguous: { id: string; period: string; description: string | null; revenue: number; commissionist: string | null; candidates: string[] }[];
};

function LinkModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'changes' | 'unmatched' | 'ambiguous'>('changes');
  useEffect(() => {
    api.post('/finance/students/link', { apply: false }).then(({ data }) => setR(data))
      .catch((e) => { toast.error(errMsg(e)); onClose(); });
  }, [onClose]);
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/finance/students/link', { apply: true });
      toast.success(`${data.newLinks} pagamentos ligados · ${data.associateChanges.length} associados acertados`);
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const tabs: [typeof tab, string, number][] = r ? [
    ['changes', 'Associados que mudam', r.associateChanges.length],
    ['unmatched', 'Pagamentos sem estudante', r.unmatched.length],
    ['ambiguous', 'Nomes repetidos', r.ambiguous.length],
  ] : [];
  return (
    <Modal title="Ligar estudantes aos lançamentos" onClose={onClose} wide>
      {!r ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Procura o nome do estudante em cada pagamento ("Pagamento - Nome") e liga-o à ficha. O associado do estudante passa a ser o comissionista do pagamento mais recente.
          </p>
          <p className="text-sm">
            {r.payments} pagamentos · {r.alreadyLinked} já ligados · <b>{r.newLinks} novas ligações</b> · <b>{r.associateChanges.length} associados a acertar</b>
          </p>
          <div className="flex flex-wrap gap-2">
            {tabs.map(([k, label, n]) => (
              <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setTab(k)}>{label} ({n})</button>
            ))}
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {tab === 'changes' ? (
              <table className="w-full">
                <thead><tr>{['ID', 'Estudante', 'Antes', 'Depois'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
                <tbody>{r.associateChanges.map((c) => <tr key={c.code}><Td>{c.code}</Td><Td bold>{c.name}</Td><Td>{c.from || '—'}</Td><Td>{c.to || '—'}</Td></tr>)}</tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead><tr>{['Mês', 'Descrição', 'Valor', 'Comissionista', ...(tab === 'ambiguous' ? ['Possíveis'] : [])].map((h, i) => <Th key={h} right={i === 2}>{h}</Th>)}</tr></thead>
                <tbody>{(tab === 'unmatched' ? r.unmatched : r.ambiguous).map((e) => (
                  <tr key={e.id}>
                    <Td>{monthLabel(e.period)}</Td><Td>{e.description || '—'}</Td><Td right>{num(e.revenue)}</Td><Td>{e.commissionist || '—'}</Td>
                    {'candidates' in e && <Td>{(e as LinkResult['ambiguous'][number]).candidates.join(', ')}</Td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {tab !== 'changes' && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Estes ficam por ligar. Normalmente o estudante não está registado ou o nome está escrito de outra forma. Corrija o nome na ficha do estudante ou na descrição do lançamento e volte a carregar em "Ligar aos lançamentos".
            </p>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={busy || (!r.newLinks && !r.associateChanges.length)} onClick={apply}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Aplicar
          </button>
        </div>
      )}
    </Modal>
  );
}

function statusBadge(s: Student) {
  return s.status === 'Pago' ? <Badge text="Pago" tone="green" /> : <Badge text="Em aberto" tone="amber" />;
}

export default function FinanceStudents({ mode, associates, rate, canEdit, onChanged, creditName, creditValue }: {
  mode: 'students' | 'installments'; associates: Associate[]; rate: number; canEdit: boolean; onChanged: () => void; creditName: string; creditValue: number;
}) {
  const [rows, setRows] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [assoc, setAssoc] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ student: Student | null } | null>(null);
  const [pay, setPay] = useState<Student | null>(null);
  const [linking, setLinking] = useState(false);
  const closeLink = useCallback(() => setLinking(false), []);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/finance/students').then(({ data }) => setRows(data))
      .catch((e) => toast.error(errMsg(e, 'Erro a carregar estudantes')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [q, assoc, status, mode]);

  const nowIso = today();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !`${r.code} ${r.name} ${r.project} ${r.theme}`.toLowerCase().includes(s)) return false;
      if (assoc === '__none__' ? r.associate : assoc && r.associate?.id !== assoc) return false;
      if (status === 'overdue') return r.status !== 'Pago' && !!r.nextDueDate && r.nextDueDate.slice(0, 10) < nowIso;
      if (status && r.status !== status) return false;
      return true;
    });
  }, [rows, q, assoc, status, nowIso]);
  const totals = useMemo(() => filtered.reduce((a, r) => ({ total: a.total + r.totalValue, paid: a.paid + r.paidAmount, balance: a.balance + (r.status === 'Pago' ? 0 : r.balance) }), { total: 0, paid: 0, balance: 0 }), [filtered]);
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  const changed = () => { load(); onChanged(); };
  const remove = async (r: Student) => {
    if (!window.confirm(`Eliminar o estudante ${r.code} (${r.name})? Os lançamentos ficam, mas deixam de estar ligados a ele.`)) return;
    try {
      await api.delete(`/finance/students/${r.id}`);
      toast.success('Eliminado');
      changed();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const actions = (r: Student) => canEdit && (
    <span className="flex gap-2">
      <button onClick={() => setPay(r)} title="Registar pagamento" aria-label="Registar pagamento"><Banknote size={14} style={{ color: '#10B981' }} /></button>
      <button onClick={() => setEdit({ student: r })} aria-label="Editar"><Pencil size={13} /></button>
      <button onClick={() => remove(r)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2" style={{ color: 'var(--text-muted)' }} />
          <input className="input-base" style={{ ...inputSm, paddingLeft: 26, width: 220 }} placeholder="Nome, ID, projecto..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={assoc} onChange={(e) => setAssoc(e.target.value)}>
          <option value="">Todos os associados</option><option value="__none__">Sem associado</option>
          {associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
        <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os estados</option><option>Em aberto</option><option>Pago</option><option value="overdue">Parcela em atraso</option>
        </select>
        {canEdit && mode === 'students' && <button className="btn btn-outline ml-auto" onClick={() => setLinking(true)}><Link2 size={14} /> Ligar aos lançamentos</button>}
        {canEdit && <button className={`btn btn-primary ${mode === 'students' ? '' : 'ml-auto'}`} onClick={() => setEdit({ student: null })}><Plus size={14} /> Novo estudante</button>}
      </div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {filtered.length} estudantes · Contratado {mzn(totals.total)} · Pago {mzn(totals.paid)} · <b>Por receber {mzn(totals.balance)}</b>
      </p>
      <div className="card p-4 overflow-x-auto">
        {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : mode === 'students' ? (
          <table className="w-full">
            <thead><tr>{['ID', 'Nome', 'Associado', 'Projecto', 'Entrada', 'Fase', 'Valor total', 'Pago', 'Saldo', 'Estado', ''].map((h, i) => <Th key={i} right={[6, 7, 8].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <Td>{r.code}</Td><Td bold>{r.name}</Td><Td>{r.associate?.name || '—'}</Td><Td>{r.project || '—'}</Td><Td>{dateLabel(r.entryDate)}</Td>
                <Td>{r.currentPhase ? `F${r.currentPhase}` : '—'}</Td><Td right>{num(r.totalValue)}</Td><Td right>{num(r.paidAmount)}</Td><Td right>{num(r.balance)}</Td>
                <Td>{statusBadge(r)}</Td><Td>{actions(r)}</Td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead><tr>{['ID', 'Cliente', 'Projecto', 'Origem', 'Valor total', 'Parcelas', 'Pagas', 'Valor pago', 'Saldo', 'Entrada', 'Próxima parcela', 'Estado', ''].map((h, i) => <Th key={i} right={[4, 5, 6, 7, 8].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>{shown.map((r) => {
              const late = r.status !== 'Pago' && !!r.nextDueDate && r.nextDueDate.slice(0, 10) < nowIso;
              return (
                <tr key={r.id}>
                  <Td>{r.code}</Td><Td bold>{r.name}</Td><Td>{r.project || '—'}</Td><Td>{r.origin || '—'}</Td><Td right>{num(r.totalValue)}</Td>
                  <Td right>{r.installments ?? '—'}</Td><Td right>{r.installmentsPaid}</Td><Td right>{num(r.paidAmount)}</Td><Td right>{num(r.balance)}</Td>
                  <Td>{dateLabel(r.entryDate)}</Td><Td color={late ? '#EF4444' : undefined}>{dateLabel(r.nextDueDate)}</Td><Td>{statusBadge(r)}</Td><Td>{actions(r)}</Td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && <p className="text-center text-sm py-6" style={{ color: 'var(--text-muted)' }}>Sem estudantes</p>}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="btn" disabled={page === pages} onClick={() => setPage(page + 1)}>Seguinte</button>
        </div>
      )}
      {edit && <StudentModal student={edit.student} associates={associates} creditName={creditName} creditValue={creditValue} onClose={() => setEdit(null)} onSaved={changed} />}
      {linking && <LinkModal onClose={closeLink} onSaved={changed} />}
      {pay && <PaymentModal student={pay} associates={associates} rate={rate} onClose={() => setPay(null)} onSaved={changed} />}
    </div>
  );
}
