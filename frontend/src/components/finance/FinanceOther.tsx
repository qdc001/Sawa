import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../../lib/api';
import {
  Badge, CHART_GRID, CHART_TICK, dateLabel, errMsg, Field, FixedSalary, inputSm, Kpi, Modal, monthLabel, monthShort, mzn, num,
  Settings, Summary, Td, Th, today, tooltipStyle, WALLETS,
} from './shared';
import { PHASES, PHASE_STATES } from './FinanceStudents';

// ---------- Programa (Painel + Associados + Estatisticas) ----------
type Academic = {
  total: number; averagePhase: number; deliveredF7: number; active: number; alerts: number; phaseCounts: number[];
  states: Record<string, number>;
  byAssociate: { id: string; code: string; name: string; whatsapp: string | null; userId: string | null; total: number; early: number; middle: number; final: number; alerts: number; completed: number }[];
  byProject: { name: string; count: number; value: number }[]; byOrigin: { name: string; count: number; value: number }[];
};
type AppUser = { id: string; name: string };

function useAcademic() {
  const [data, setData] = useState<Academic | null>(null);
  const load = useCallback(() => {
    api.get('/finance/academic').then(({ data: d }) => setData(d)).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(load, [load]);
  return { data, load };
}

function SimpleBars({ title, data, dataKey, money }: { title: string; data: any[]; dataKey: string; money?: boolean }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="name" tick={CHART_TICK} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={money ? (v) => `${Math.round(v / 1000)}k` : undefined} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (money ? mzn(Number(v)) : num(Number(v)))} />
          <Bar dataKey={dataKey} fill="#6366F1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AssociateModal({ associate, users, onClose, onSaved }: { associate: Academic['byAssociate'][number] | null; users: AppUser[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(associate?.name || '');
  const [whatsapp, setWhatsapp] = useState(associate?.whatsapp || '');
  const [userId, setUserId] = useState(associate?.userId || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name, whatsapp, userId: userId || null };
      if (associate) await api.patch(`/finance/associates/${associate.id}`, body);
      else await api.post('/finance/associates', body);
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={associate ? `Associado ${associate.code}` : 'Novo associado'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome"><input className="input-base" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="WhatsApp"><input className="input-base" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} /></Field>
        <Field label="Utilizador do CRM">
          <select className="input-base" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Sem ligação</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Com a ligação, esta pessoa vê a sua comissão e os seus estudantes em Finanças.</p>
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

export function FinanceProgram({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const { data, load } = useAcademic();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [edit, setEdit] = useState<{ a: Academic['byAssociate'][number] | null } | null>(null);
  useEffect(() => {
    if (canEdit) api.get('/users').then(({ data: d }) => setUsers(Array.isArray(d) ? d : d.users || [])).catch(() => {});
  }, [canEdit]);
  if (!data) return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>;
  const phaseData = PHASES.map((p, i) => ({ name: `F${i + 1}`, full: p, estudantes: data.phaseCounts[i] }));
  const totalStates = Object.values(data.states).reduce((a, b) => a + b, 0);
  const changed = () => { load(); onChanged(); };
  const remove = async (id: string) => {
    if (!window.confirm('Eliminar este associado?')) return;
    try {
      await api.delete(`/finance/associates/${id}`);
      toast.success('Eliminado');
      changed();
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Total de estudantes" value={num(data.total)} />
        <Kpi label="Fase média" value={num(data.averagePhase)} />
        <Kpi label="Entregues na F7" value={num(data.deliveredF7)} />
        <Kpi label="Activos" value={num(data.active)} />
        <Kpi label="Alertas (+14 dias)" value={num(data.alerts)} color={data.alerts ? '#EF4444' : undefined} />
      </div>
      <div className="card p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Associados</h3>
          {canEdit && <button className="btn btn-primary" onClick={() => setEdit({ a: null })}><Plus size={14} /> Novo associado</button>}
        </div>
        <table className="w-full">
          <thead><tr>{['Código', 'Nome', 'Estudantes', 'Fase ≤3', 'Fase 4-6', 'Fase 7', 'Concluídos', 'Alertas', 'WhatsApp', ''].map((h, i) => <Th key={i} right={i >= 2 && i <= 7}>{h}</Th>)}</tr></thead>
          <tbody>
            {data.byAssociate.map((a) => (
              <tr key={a.id}>
                <Td>{a.code}</Td><Td bold>{a.name}</Td><Td right>{a.total}</Td><Td right>{a.early}</Td><Td right>{a.middle}</Td><Td right>{a.final}</Td><Td right>{a.completed}</Td>
                <Td right color={a.alerts ? '#EF4444' : undefined}>{a.alerts}</Td><Td>{a.whatsapp || '—'}</Td>
                <Td>{canEdit && (
                  <span className="flex gap-2">
                    <button onClick={() => setEdit({ a })} aria-label="Editar"><Pencil size={13} /></button>
                    <button onClick={() => remove(a.id)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
                  </span>
                )}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SimpleBars title="Estudantes por fase actual" data={phaseData} dataKey="estudantes" />
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-sm mb-2">Fases do programa</h3>
            <table className="w-full"><tbody>{PHASES.map((p, i) => <tr key={p}><Td>F{i + 1} · {p}</Td><Td right>{data.phaseCounts[i]}</Td></tr>)}</tbody></table>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">Distribuição de estados</h3>
            <table className="w-full"><tbody>{PHASE_STATES.map((s) => (
              <tr key={s}><Td>{s}</Td><Td right>{data.states[s]}</Td><Td right>{totalStates ? `${Math.round((data.states[s] / totalStates) * 100)}%` : '—'}</Td></tr>
            ))}</tbody></table>
          </div>
        </div>
      </div>
      {edit && <AssociateModal associate={edit.a} users={users} onClose={() => setEdit(null)} onSaved={changed} />}
    </div>
  );
}

export function FinanceDistribution() {
  const { data } = useAcademic();
  if (!data) return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SimpleBars title="Número de clientes por serviço" data={data.byProject} dataKey="count" />
        <SimpleBars title="Valor recebido por serviço" data={data.byProject} dataKey="value" money />
        <SimpleBars title="Origem dos clientes" data={data.byOrigin} dataKey="count" />
        <div className="card p-4 overflow-x-auto">
          <h3 className="font-semibold text-sm mb-2">Distribuição dos clientes por serviço</h3>
          <table className="w-full">
            <thead><tr><Th>Serviço</Th><Th right>Clientes</Th><Th right>Valor</Th></tr></thead>
            <tbody>{data.byProject.map((p) => <tr key={p.name}><Td>{p.name}</Td><Td right>{p.count}</Td><Td right>{num(p.value)}</Td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Investimentos ----------
type Investment = { id: string; date: string | null; description: string | null; investment: number; returnAmount: number; potentialReturn: number; paymentMethod: string | null; notes: string | null; fund: string | null };
const FUND_OPTIONS = [['Dono', 'Dono'], ['Previdencia', 'Previdência'], ['Oportunidade', 'Oportunidade'], ['Expansao', 'Expansão'], ['Empresa', 'Empresa']];

function InvestmentModal({ item, onClose, onSaved }: { item: Investment | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    date: item?.date?.slice(0, 10) || today(), description: item?.description || '', investment: item?.investment ? String(item.investment) : '',
    returnAmount: item?.returnAmount ? String(item.returnAmount) : '', potentialReturn: item?.potentialReturn ? String(item.potentialReturn) : '',
    paymentMethod: WALLETS.find((w) => w === item?.paymentMethod) || '', notes: item?.notes || '', fund: item?.fund || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.paymentMethod) { toast.error('Escolhe a forma de pagamento'); return; }
    setBusy(true);
    try {
      if (item) await api.patch(`/finance/investments/${item.id}`, f);
      else await api.post('/finance/investments', f);
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? 'Editar investimento' : 'Novo investimento'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data"><input className="input-base" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Forma de pagamento">
            <select className="input-base" value={f.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              <option value="">Escolher</option>{WALLETS.map((w) => <option key={w} value={w}>{w === 'Fisico' ? 'Físico' : w}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Descrição"><input className="input-base" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Investimento (sai)"><input className="input-base" type="number" min={0} value={f.investment} onChange={(e) => set('investment', e.target.value)} /></Field>
          <Field label="Retorno (entra)"><input className="input-base" type="number" min={0} value={f.returnAmount} onChange={(e) => set('returnAmount', e.target.value)} /></Field>
          <Field label="Retorno potencial"><input className="input-base" type="number" min={0} value={f.potentialReturn} onChange={(e) => set('potentialReturn', e.target.value)} /></Field>
        </div>
        <Field label="Fundo">
          <select className="input-base" value={f.fund} onChange={(e) => set('fund', e.target.value)}>
            <option value="">Sem fundo</option>{FUND_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Observação"><input className="input-base" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

export function FinanceInvestments({ reload }: { reload: () => void }) {
  const [rows, setRows] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ item: Investment | null } | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    api.get('/finance/investments').then(({ data }) => setRows(data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const changed = () => { load(); reload(); };
  const remove = async (i: Investment) => {
    if (!window.confirm('Eliminar este registo?')) return;
    try {
      await api.delete(`/finance/investments/${i.id}`);
      toast.success('Eliminado');
      changed();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const totals = useMemo(() => rows.reduce((a, r) => ({ inv: a.inv + r.investment, ret: a.ret + r.returnAmount, pot: a.pot + r.potentialReturn }), { inv: 0, ret: 0, pot: 0 }), [rows]);
  const byMonth = useMemo(() => {
    const m = new Map<string, Record<string, { ret: number; inv: number }>>();
    for (const r of rows) {
      if (!r.date || !r.paymentMethod) continue;
      const p = r.date.slice(0, 7);
      const row = m.get(p) || {};
      const c = row[r.paymentMethod] || { ret: 0, inv: 0 };
      c.ret += r.returnAmount; c.inv += r.investment;
      row[r.paymentMethod] = c;
      m.set(p, row);
    }
    return [...m].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Total investido" value={mzn(totals.inv)} color="#EF4444" />
        <Kpi label="Retorno recebido" value={mzn(totals.ret)} color="#10B981" />
        <Kpi label="Retorno potencial" value={mzn(totals.pot)} />
      </div>
      <div className="card p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Registos</h3>
          <button className="btn btn-primary" onClick={() => setEdit({ item: null })}><Plus size={14} /> Novo investimento</button>
        </div>
        {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
          <table className="w-full">
            <thead><tr>{['Data', 'Descrição', 'Investimento', 'Retorno', 'Potencial', 'Forma', 'Fundo', 'Observação', ''].map((h, i) => <Th key={i} right={[2, 3, 4].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <Td>{dateLabel(r.date)}</Td><Td>{r.description || '—'}</Td><Td right color="#EF4444">{r.investment ? num(r.investment) : ''}</Td>
                <Td right color="#10B981">{r.returnAmount ? num(r.returnAmount) : ''}</Td><Td right>{r.potentialReturn ? num(r.potentialReturn) : ''}</Td>
                <Td>{r.paymentMethod || '—'}</Td><Td>{r.fund || '—'}</Td><Td>{r.notes || ''}</Td>
                <Td><span className="flex gap-2">
                  <button onClick={() => setEdit({ item: r })} aria-label="Editar"><Pencil size={13} /></button>
                  <button onClick={() => remove(r)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
                </span></Td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="card p-4 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Entradas e saídas por mês e carteira</h3>
        <table className="w-full">
          <thead><tr><Th>Mês</Th>{WALLETS.flatMap((w) => [<Th key={`${w}r`} right>{w} entra</Th>, <Th key={`${w}i`} right>{w} sai</Th>])}</tr></thead>
          <tbody>{byMonth.map(([p, row]) => (
            <tr key={p}><Td bold>{monthShort(p)}</Td>{WALLETS.flatMap((w) => [<Td key={`${w}r`} right>{num(row[w]?.ret || 0)}</Td>, <Td key={`${w}i`} right>{num(row[w]?.inv || 0)}</Td>])}</tr>
          ))}</tbody>
        </table>
      </div>
      {edit && <InvestmentModal item={edit.item} onClose={() => setEdit(null)} onSaved={changed} />}
    </div>
  );
}

// ---------- Cupoes ----------
type Coupon = { id: string; code: string; discount: number; validUntil: string | null; maxUses: number; usedCount: number; clientName: string | null; usedAt: string | null; status: string };

function CouponModal({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const [clientName, setClient] = useState(coupon?.clientName || '');
  const [usedCount, setUsed] = useState(String(coupon?.usedCount ?? 0));
  const [usedAt, setUsedAt] = useState(coupon?.usedAt?.slice(0, 10) || '');
  const [validUntil, setValid] = useState(coupon?.validUntil?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (coupon) await api.patch(`/finance/coupons/${coupon.id}`, { clientName, usedCount, usedAt: usedAt || null, validUntil: validUntil || null });
      else await api.post('/finance/coupons', { clientName });
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={coupon ? `Cupão ${coupon.code}` : 'Novo cupão'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Cliente"><input className="input-base" value={clientName} onChange={(e) => setClient(e.target.value)} /></Field>
        {coupon ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Válido até"><input className="input-base" type="date" value={validUntil} onChange={(e) => setValid(e.target.value)} /></Field>
              <Field label="Usos realizados"><input className="input-base" type="number" min={0} value={usedCount} onChange={(e) => setUsed(e.target.value)} /></Field>
            </div>
            <Field label="Data de uso"><input className="input-base" type="date" value={usedAt} onChange={(e) => setUsedAt(e.target.value)} /></Field>
          </>
        ) : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>O código, o desconto e a validade são criados automaticamente.</p>}
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

export function FinanceCoupons() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ c: Coupon | null } | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    api.get('/finance/coupons').then(({ data }) => setRows(data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const remove = async (c: Coupon) => {
    if (!window.confirm(`Eliminar o cupão ${c.code}?`)) return;
    try {
      await api.delete(`/finance/coupons/${c.id}`);
      toast.success('Eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const tone = (s: string) => (s === 'Aberto' ? 'blue' : s === 'Usado' ? 'green' : 'red') as 'blue' | 'green' | 'red';
  return (
    <div className="card p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Cupões de desconto</h3>
        <button className="btn btn-primary" onClick={() => setEdit({ c: null })}><Plus size={14} /> Novo cupão</button>
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
        <table className="w-full">
          <thead><tr>{['Código', 'Desconto', 'Válido até', 'Máx.', 'Usos', 'Cliente', 'Data de uso', 'Estado', ''].map((h, i) => <Th key={i} right={[1, 3, 4].includes(i)}>{h}</Th>)}</tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id}>
              <Td bold>{c.code}</Td><Td right>{num(c.discount)}</Td><Td>{dateLabel(c.validUntil)}</Td><Td right>{c.maxUses}</Td><Td right>{c.usedCount}</Td>
              <Td>{c.clientName || '—'}</Td><Td>{dateLabel(c.usedAt)}</Td><Td><Badge text={c.status} tone={tone(c.status)} /></Td>
              <Td><span className="flex gap-2">
                <button onClick={() => setEdit({ c })} aria-label="Editar"><Pencil size={13} /></button>
                <button onClick={() => remove(c)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
              </span></Td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit && <CouponModal coupon={edit.c} onClose={() => setEdit(null)} onSaved={load} />}
    </div>
  );
}

// ---------- O meu resumo ----------
export function FinanceMine() {
  const [data, setData] = useState<{ associate: { code: string; name: string } | null; months: { period: string; commission: number; revenue: number; payments: number }[] } | null>(null);
  useEffect(() => { api.get('/finance/me').then(({ data: d }) => setData(d)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!data) return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>;
  if (!data.associate) return <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>A tua conta ainda não está ligada a um associado. Pede ao administrador para fazer a ligação.</div>;
  return (
    <div className="card p-4 overflow-x-auto">
      <h3 className="font-semibold text-sm mb-2">A minha comissão · {data.associate.name} ({data.associate.code})</h3>
      <table className="w-full">
        <thead><tr><Th>Mês</Th><Th right>Pagamentos</Th><Th right>Valor recebido</Th><Th right>Comissão</Th></tr></thead>
        <tbody>{data.months.map((m) => <tr key={m.period}><Td bold>{monthLabel(m.period)}</Td><Td right>{m.payments}</Td><Td right>{num(m.revenue)}</Td><Td right bold>{num(m.commission)}</Td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- Definicoes e importacao ----------
type Preview = {
  token: string; checked: number; lostEntries: number; warnings: string[];
  differences: { area: string; item: string; excel: number; crm: number; diff: number }[];
  counts: Record<string, number>;
};

function ImportBox({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [fixSpaces, setFix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const analyse = async (f: File, fix: boolean) => {
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('fixSpaces', String(fix));
      const { data } = await api.post('/finance/import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      setPreview(data);
    } catch (e) { toast.error(errMsg(e, 'Não foi possível ler o ficheiro')); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview) return;
    const warn = preview.lostEntries ? `\n\nATENÇÃO: ${preview.lostEntries} lançamentos feitos no CRM vão ser apagados.` : '';
    if (!window.confirm(`Substituir todos os dados de Finanças pelos desta planilha?${warn}\n\nIsto não se pode desfazer.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/finance/import/commit', { token: preview.token }, { timeout: 180000 });
      toast.success(`Importado: ${data.students} estudantes (${data.linkedContacts} ligados a contactos)`);
      setPreview(null); setFile(null);
      if (ref.current) ref.current.value = '';
      onDone();
    } catch (e) { toast.error(errMsg(e, 'Erro a importar')); } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold text-sm">Importar a planilha</h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Lê o ficheiro Excel e mostra a comparação antes de gravar. Importar substitui todos os dados de Finanças.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={ref} type="file" accept=".xlsm,.xlsx" className="text-sm" onChange={(e) => {
          const f = e.target.files?.[0] || null;
          setFile(f);
          if (f) analyse(f, fixSpaces);
        }} />
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Inclui comissões e carteiras com espaços a mais nos nomes, que o Excel não soma.">
          <input type="checkbox" checked={fixSpaces} onChange={(e) => { setFix(e.target.checked); if (file) analyse(file, e.target.checked); }} />
          Corrigir nomes com espaços a mais
        </label>
        {busy && <Loader2 size={16} className="animate-spin" />}
      </div>
      {preview && (
        <div className="space-y-3">
          <p className="text-sm">
            {preview.counts.students} estudantes · {preview.counts.entries} lançamentos · {preview.counts.investments} investimentos · {preview.counts.coupons} cupões · {preview.counts.associates} associados · {preview.counts.months} meses
          </p>
          <p className="text-sm"><b>{preview.checked - preview.differences.length}</b> de {preview.checked} valores iguais ao Excel.</p>
          {preview.warnings.map((w, i) => <p key={i} className="text-xs" style={{ color: '#F59E0B' }}>{w}</p>)}
          {preview.differences.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><Th>Onde</Th><Th>Valor</Th><Th right>Excel</Th><Th right>CRM</Th><Th right>Diferença</Th></tr></thead>
                <tbody>{preview.differences.map((d, i) => <tr key={i}><Td>{d.area}</Td><Td>{d.item}</Td><Td right>{num(d.excel)}</Td><Td right>{num(d.crm)}</Td><Td right bold>{num(d.diff)}</Td></tr>)}</tbody>
              </table>
            </div>
          )}
          <button className="btn btn-primary" disabled={busy} onClick={commit}><Upload size={14} /> Importar estes dados</button>
        </div>
      )}
    </div>
  );
}

export function FinanceSettings({ data, reload }: { data: Summary; reload: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({
    commissionRate: String(s.commissionRate * 100), perNewStudent: String(s.perNewStudent), perNewStudentName: s.perNewStudentName, perNewStudentFrom: s.perNewStudentFrom,
    workingCapital: String(s.workingCapital), proLabore: String(s.proLabore), proLaboreFrom: s.proLaboreFrom,
    sealPrevidencia: String(s.sealPrevidencia * 100), sealOportunidade: String(s.sealOportunidade * 100), sealDono: String(s.sealDono * 100), sealExpansao: String(s.sealExpansao * 100),
    couponValidityDays: String(s.couponValidityDays), couponDiscount: String(s.couponDiscount),
  });
  const [fixed, setFixed] = useState<FixedSalary[]>(s.fixedSalaries);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const input = (k: keyof typeof f, type = 'number') => <input className="input-base" type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />;
  const sealSum = ['sealPrevidencia', 'sealOportunidade', 'sealDono', 'sealExpansao'].reduce((a, k) => a + (Number(f[k as keyof typeof f]) || 0), 0);
  const save = async () => {
    setBusy(true);
    try {
      const pctToRate = (v: string) => (Number(v) || 0) / 100;
      await api.put('/finance/settings', {
        ...f, commissionRate: pctToRate(f.commissionRate), sealPrevidencia: pctToRate(f.sealPrevidencia), sealOportunidade: pctToRate(f.sealOportunidade),
        sealDono: pctToRate(f.sealDono), sealExpansao: pctToRate(f.sealExpansao), fixedSalaries: fixed,
      });
      toast.success('Definições guardadas');
      reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const editFixed = (i: number, k: keyof FixedSalary, v: string) => setFixed((p) => p.map((x, j) => (j === i ? { ...x, [k]: k === 'amount' ? Number(v) || 0 : v } : x)));
  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Comissão (%)">{input('commissionRate')}</Field>
          <Field label="Valor por estudante novo">{input('perNewStudent')}</Field>
          <Field label="Quem recebe">{input('perNewStudentName', 'text')}</Field>
          <Field label="Desde (mês)">{input('perNewStudentFrom', 'month')}</Field>
          <Field label="Capital de giro">{input('workingCapital')}</Field>
          <Field label="Pró-labore">{input('proLabore')}</Field>
          <Field label="Pró-labore desde">{input('proLaboreFrom', 'month')}</Field>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Distribuição SEAL (%)</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Previdência">{input('sealPrevidencia')}</Field>
            <Field label="Oportunidade">{input('sealOportunidade')}</Field>
            <Field label="Dono">{input('sealDono')}</Field>
            <Field label="Expansão">{input('sealExpansao')}</Field>
          </div>
          {Math.abs(sealSum - 100) > 0.01 && <p className="text-xs mt-1" style={{ color: '#F59E0B' }}>A soma está em {sealSum}%: devia dar 100%.</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">Salários fixos</h4>
            <button className="btn" onClick={() => setFixed((p) => [...p, { name: '', amount: 0, startPeriod: new Date().toISOString().slice(0, 7) }])}><Plus size={13} /> Adicionar</button>
          </div>
          <div className="space-y-1.5 overflow-x-auto">
            {fixed.map((x, i) => (
              <div key={i} className="grid grid-cols-[minmax(140px,1fr)_110px_150px_150px_24px] gap-2 items-center">
                <input className="input-base" style={inputSm} placeholder="Cargo" value={x.name} onChange={(e) => editFixed(i, 'name', e.target.value)} />
                <input className="input-base" style={inputSm} type="number" min={0} value={x.amount} onChange={(e) => editFixed(i, 'amount', e.target.value)} />
                <input className="input-base" style={inputSm} type="month" title="Desde" value={x.startPeriod} onChange={(e) => editFixed(i, 'startPeriod', e.target.value)} />
                <input className="input-base" style={inputSm} type="month" title="Até (opcional)" value={x.endPeriod || ''} onChange={(e) => editFixed(i, 'endPeriod', e.target.value)} />
                <button onClick={() => setFixed((p) => p.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Validade dos cupões (dias)">{input('couponValidityDays')}</Field>
          <Field label="Desconto do cupão">{input('couponDiscount')}</Field>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Guardar definições</button>
      </div>
      <ImportBox onDone={reload} />
    </div>
  );
}

export type { Settings };
