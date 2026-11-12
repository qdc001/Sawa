import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { Associate, dateLabel, DEFAULT_DEFENSE_SHARES, errMsg, Field, Kpi, Modal, monthLabel, mzn, num, Summary, Td, Th, today, WALLETS, inputSm } from './shared';
import { SplitPreview, Student } from './FinanceStudents';

type Entry = {
  id: string; period: string; date: string | null; description: string | null; type: string; category: string | null;
  potentialRevenue: number; expense: number; revenue: number; commission: number; commissionistRaw: string | null;
  paymentMethod: string | null; notes: string | null; associate: { id: string; name: string } | null; student: { id: string; code: string; name: string } | null;
  defenseAmount: number; defenseCommission: number; defenseAssociate: { id: string; name: string } | null;
};

const studentLabel = (s: { code: string; name: string }) => `${s.code} · ${s.name}`;

function EntryModal({ entry, associates, students, rate, shares, onClose, onSaved }: {
  entry: Entry | null; associates: Associate[]; students: Student[]; rate: number; shares: Record<string, number>; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState(entry?.type || 'RECEITA');
  const [date, setDate] = useState(entry?.date?.slice(0, 10) || today());
  const [description, setDescription] = useState(entry?.description || '');
  const [category, setCategory] = useState(entry?.category || '');
  const [amount, setAmount] = useState(entry ? String(entry.type === 'DESPESA' ? entry.expense : entry.revenue) : '');
  const [potentialRevenue, setPotential] = useState(entry?.potentialRevenue ? String(entry.potentialRevenue) : '');
  const [associateId, setAssociate] = useState(entry?.associate?.id || '');
  const [paymentMethod, setMethod] = useState(WALLETS.find((w) => w === entry?.paymentMethod) || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  // Estudante do painel: o pagamento entra no saldo dele em vez de ficar so com um nome escrito.
  const [studentId, setStudentId] = useState(entry?.student?.id || '');
  const [studentText, setStudentText] = useState(entry?.student ? studentLabel(entry.student) : '');
  const [busy, setBusy] = useState(false);
  const student = students.find((s) => s.id === studentId) || null;
  const pickStudent = (txt: string) => {
    setStudentText(txt);
    const st = students.find((s) => studentLabel(s) === txt.trim()) || null;
    setStudentId(st?.id || '');
    if (!st || entry) return;
    if (!description.trim() || description.startsWith('Pagamento - ')) setDescription(`Pagamento - ${st.name}`);
    if (!category.trim() && st.project) setCategory(st.project);
    setAssociate(st.associate?.id || '');
    if (!potentialRevenue && st.installmentsPaid === 0 && !st.paidAmount && st.totalValue) setPotential(String(st.totalValue));
  };
  const save = async () => {
    if (!paymentMethod) { toast.error('Escolhe a forma de pagamento'); return; }
    if (type === 'RECEITA' && studentText.trim() && !studentId) { toast.error('Escolhe o estudante da lista (ou apaga o campo)'); return; }
    setBusy(true);
    const body: Record<string, unknown> = { date, description, category, amount, potentialRevenue, associateId: associateId || null, paymentMethod, notes };
    if (type === 'RECEITA' && (!entry || (entry.student?.id || '') !== studentId)) body.studentId = studentId || null;
    try {
      if (entry) await api.patch(`/finance/entries/${entry.id}`, body);
      else await api.post('/finance/entries', { ...body, type });
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={entry ? 'Editar lançamento' : 'Novo lançamento'} onClose={onClose}>
      <div className="space-y-3">
        {!entry && (
          <Field label="Tipo">
            <select className="input-base" value={type} onChange={(e) => setType(e.target.value)}><option value="RECEITA">Receita</option><option value="DESPESA">Despesa</option></select>
          </Field>
        )}
        {type === 'RECEITA' && (
          <Field label="Estudante (pagamento de um estudante do painel)">
            <input className="input-base" list="ledger-students" value={studentText} placeholder="Escreve o nome ou o ID e escolhe da lista" onChange={(e) => pickStudent(e.target.value)} />
            <datalist id="ledger-students">{students.map((s) => <option key={s.id} value={studentLabel(s)} />)}</datalist>
          </Field>
        )}
        {type === 'RECEITA' && studentText.trim() && !studentId && <p className="text-xs" style={{ color: '#F59E0B' }}>Ainda não escolheste um estudante da lista.</p>}
        {student && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {student.project || 'Sem projecto'}{student.packageTier ? ` · ${student.packageTier}` : ''} · Pago {mzn(student.paidAmount)} de {mzn(student.totalValue)} · Saldo <b>{mzn(student.balance)}</b>
            {student.ledgerBalance ? ' · o saldo actualiza sozinho com este lançamento.' : ' · estudante antigo: o saldo é o da ficha.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data"><input className="input-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor (MZN)"><input className="input-base" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </div>
        <Field label="Descrição"><input className="input-base" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {type === 'RECEITA' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Categoria"><input className="input-base" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: Monografia - Completo" /></Field>
            <Field label="Receita potencial"><input className="input-base" type="number" min={0} value={potentialRevenue} onChange={(e) => setPotential(e.target.value)} /></Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {type === 'RECEITA' && (
            <Field label="Comissionista">
              <select className="input-base" value={associateId} onChange={(e) => setAssociate(e.target.value)}>
                <option value="">Sem comissão</option>
                {associates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Forma de pagamento">
            <select className="input-base" value={paymentMethod} onChange={(e) => setMethod(e.target.value as any)}>
              <option value="">Escolher</option>{WALLETS.map((w) => <option key={w} value={w}>{w === 'Fisico' ? 'Físico' : w}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Observações"><input className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={student ? 'Automática (ex.: Segunda parcela)' : ''} /></Field>
        {!entry && student && Number(amount) > 0 && date.length === 10 && (
          <SplitPreview student={student} value={Number(amount)} rate={rate} shares={shares} associateName={associates.find((a) => a.id === associateId)?.name || null} period={date.slice(0, 7)} />
        )}
        {entry && (entry.defenseAmount > 0) && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{mzn(entry.defenseAmount)} deste pagamento são da parte da defesa ({entry.defenseAssociate?.name}).</p>
        )}
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

export default function FinanceLedger({ data, reload }: { data: Summary; reload: () => void }) {
  const nowPeriod = new Date().toISOString().slice(0, 7);
  const periods = useMemo(() => [...new Set([...data.months.map((m) => m.period), nowPeriod])].sort().reverse(), [data.months, nowPeriod]);
  const [period, setPeriod] = useState(periods.find((p) => data.months.some((m) => m.period === p && m.hasActivity)) || periods[0]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ entry: Entry | null } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const loadStudents = useCallback(() => {
    api.get('/finance/students').then(({ data: d }) => setStudents(d)).catch(() => {});
  }, []);
  useEffect(loadStudents, [loadStudents]);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/finance/entries?period=${period}`)
      .then(({ data: d }) => setEntries(d))
      .catch((e) => toast.error(errMsg(e, 'Erro a carregar lançamentos')))
      .finally(() => setLoading(false));
  }, [period]);
  useEffect(load, [load]);

  const month = data.months.find((m) => m.period === period);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? entries.filter((e) => `${e.description} ${e.category} ${e.notes} ${e.associate?.name} ${e.student?.code} ${e.student?.name}`.toLowerCase().includes(s)) : entries;
  }, [entries, q]);

  const changed = () => { load(); reload(); loadStudents(); };
  const remove = async (e: Entry) => {
    if (!window.confirm(`Eliminar "${e.description || 'lançamento'}"?${e.student ? ' O pagamento sai também do parcelamento do estudante.' : ''}`)) return;
    try {
      await api.delete(`/finance/entries/${e.id}`);
      toast.success('Eliminado');
      changed();
    } catch (err) { toast.error(errMsg(err)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
        </select>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2" style={{ color: 'var(--text-muted)' }} />
          <input className="input-base" style={{ ...inputSm, paddingLeft: 26, width: 220 }} placeholder="Pesquisar..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-primary ml-auto" onClick={() => setModal({ entry: null })}><Plus size={14} /> Novo lançamento</button>
      </div>

      {month && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Receita potencial" value={mzn(month.dre)} />
          <Kpi label="Receita" value={mzn(month.revenue)} color="#10B981" />
          <Kpi label="Despesas" value={mzn(month.expense)} color="#EF4444" />
          <Kpi label="Comissões" value={mzn(month.commissionTotal)} />
        </div>
      )}

      <div className="card p-4 overflow-x-auto">
        {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
          <table className="w-full">
            <thead><tr>{['Data', 'Descrição', 'Categoria', 'Potencial', 'Despesa', 'Receita', 'Comissionista', 'Comissão', 'Forma', 'Observações', ''].map((h, i) => <Th key={i} right={[3, 4, 5, 7].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <Td>{dateLabel(e.date)}</Td>
                  <Td>
                    {e.description || '—'}
                    {e.student && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title={`Ligado ao estudante ${e.student.name}`}>{e.student.code}</span>}
                  </Td>
                  <Td>{e.category || '—'}</Td>
                  <Td right>{e.potentialRevenue ? num(e.potentialRevenue) : ''}</Td>
                  <Td right color="#EF4444">{e.expense ? num(e.expense) : ''}</Td>
                  <Td right color="#10B981">{e.revenue ? num(e.revenue) : ''}</Td>
                  <Td>
                    {e.associate?.name || e.commissionistRaw || '—'}
                    {e.defenseAssociate && e.defenseCommission > 0 && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Defesa: {e.defenseAssociate.name}</div>}
                  </Td>
                  <Td right>
                    {e.commission || e.defenseCommission > 0 ? num(e.commission) : ''}
                    {e.defenseCommission > 0 && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }} title={`${num(e.defenseAmount)} da parte da defesa`}>+ {num(e.defenseCommission)}</div>}
                  </Td>
                  <Td>{e.paymentMethod || '—'}</Td><Td>{e.notes || ''}</Td>
                  <Td>
                    <span className="flex gap-2">
                      <button onClick={() => setModal({ entry: e })} aria-label="Editar"><Pencil size={13} /></button>
                      <button onClick={() => remove(e)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
                    </span>
                  </Td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={11} className="text-center text-sm py-6" style={{ color: 'var(--text-muted)' }}>Sem lançamentos neste mês</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {month && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-2">Comissão por colaborador</h3>
            <table className="w-full"><tbody>
              {data.associates.map((a) => <tr key={a.id}><Td>{a.name}</Td><Td right>{num(month.commissions[a.id] || 0)}</Td></tr>)}
            </tbody></table>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold text-sm mb-2">Por forma de pagamento</h3>
            <table className="w-full">
              <thead><tr><Th>Forma</Th><Th right>Receita</Th><Th right>Despesa</Th></tr></thead>
              <tbody>{WALLETS.map((w) => <tr key={w}><Td>{w === 'Fisico' ? 'Físico' : w}</Td><Td right>{num(month.wallets[w].in)}</Td><Td right>{num(month.wallets[w].out)}</Td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      {modal && (
        <EntryModal entry={modal.entry} associates={data.associates} students={students} rate={data.settings.commissionRate}
          shares={data.settings.defenseShares ?? DEFAULT_DEFENSE_SHARES} onClose={() => setModal(null)} onSaved={changed} />
      )}
    </div>
  );
}
