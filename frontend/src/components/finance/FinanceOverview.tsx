import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts';
import api from '../../lib/api';
import {
  CHART_GRID, CHART_TICK, dateLabel, errMsg, Field, FundKey, inputSm, Kpi, Modal, Month, monthLabel, monthShort, mzn, num, pct,
  statusColor, Summary, Td, Th, today, tooltipStyle, WALLETS, YearSelect,
} from './shared';

const FUND_LABELS: Record<FundKey, string> = {
  Previdencia: 'Fundo de Previdência e Longo Prazo', Oportunidade: 'Fundo de Oportunidade',
  Dono: 'Fundo de pagamento do dono', Expansao: 'Reserva Estratégica de Expansão',
};

function Chart({ title, data, lines, suffix }: { title: string; data: any[]; lines: { key: string; name: string; color: string }[]; suffix?: string }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={58} tickFormatter={(v) => (suffix ? `${v}${suffix}` : `${Math.round(v / 1000)}k`)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (suffix ? `${v}${suffix}` : mzn(Number(v)))} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 2 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FinanceOverview({ data }: { data: Summary }) {
  const { flow, months } = data;
  const series = months.map((m) => ({
    label: monthShort(m.period), receita: m.revenue, despesa: m.expense, dre: m.dre, lucro: m.profit,
    pct: m.profitPct === null ? null : Math.round(m.profitPct * 1000) / 10,
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Dinheiro existente" value={mzn(flow.total)} />
        <Kpi label="Capital de giro" value={mzn(flow.workingCapitalFilled)} hint={`Meta: ${mzn(flow.workingCapital)}`} color={flow.total >= flow.workingCapital ? '#10B981' : '#EF4444'} />
        <Kpi label="Valor a distribuir (SEAL)" value={mzn(flow.distributable)} />
        <Kpi label="Lucro líquido total" value={mzn(flow.years.reduce((a, y) => a + y.totals.profit, 0))} />
      </div>

      <div className="card p-4 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Situação financeira por ano</h3>
        <table className="w-full">
          <thead><tr>{['Ano', '', 'DRE', 'Receita', 'Despesa', 'Saldo', 'Salários', 'Pró-labore', 'Lucro líquido', '% Lucro'].map((h, i) => <Th key={i} right={i > 1}>{h}</Th>)}</tr></thead>
          <tbody>
            {flow.years.flatMap((y) => [
              <tr key={y.year}>
                <Td bold>{y.year}</Td><Td bold>Total</Td>
                <Td right>{num(y.totals.dre)}</Td><Td right>{num(y.totals.revenue)}</Td><Td right>{num(y.totals.expense)}</Td>
                <Td right>{num(y.totals.balance)}</Td><Td right>{num(y.totals.salary)}</Td><Td right>{num(y.totals.proLabore)}</Td>
                <Td right bold color={y.totals.profit >= 0 ? '#10B981' : '#EF4444'}>{num(y.totals.profit)}</Td><Td right>{pct(y.profitPct)}</Td>
              </tr>,
              <tr key={`${y.year}-m`}>
                <Td /><Td>Média ({y.activeMonths} {y.activeMonths === 1 ? 'mês' : 'meses'})</Td>
                <Td right>{num(y.averages.dre)}</Td><Td right>{num(y.averages.revenue)}</Td><Td right>{num(y.averages.expense)}</Td>
                <Td right>{num(y.averages.balance)}</Td><Td right>{num(y.averages.salary)}</Td><Td right>{num(y.averages.proLabore)}</Td>
                <Td right>{num(y.averages.profit)}</Td><Td />
              </tr>,
            ])}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4 overflow-x-auto">
          <h3 className="font-semibold text-sm mb-2">Distribuição do montante existente</h3>
          <table className="w-full">
            <thead><tr><Th>Ano</Th>{WALLETS.map((w) => <Th key={w} right>{w === 'Fisico' ? 'Físico' : w}</Th>)}<Th right>Total</Th></tr></thead>
            <tbody>
              {flow.years.map((y) => (
                <tr key={y.year}><Td bold>{y.year}</Td>{WALLETS.map((w) => <Td key={w} right>{num(y.wallets[w])}</Td>)}<Td right bold>{num(y.walletTotal)}</Td></tr>
              ))}
              <tr><Td bold>Total</Td>{WALLETS.map((w) => <Td key={w} right bold>{num(flow.walletTotals[w])}</Td>)}<Td right bold>{num(flow.total)}</Td></tr>
            </tbody>
          </table>
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            Valor depois de encher o capital de giro: {Object.entries(flow.afterCapitalByYear).map(([y, v]) => `${y}: ${mzn(v)}`).join(' · ')}
          </p>
        </div>
        <div className="card p-4 overflow-x-auto">
          <h3 className="font-semibold text-sm mb-2">Sistema Estratégico de Alocação do Lucro (SEAL)</h3>
          <table className="w-full">
            <thead><tr><Th>Fundo</Th><Th right>%</Th><Th right>Parte</Th><Th right>Já levantado</Th><Th right>Disponível</Th></tr></thead>
            <tbody>
              {(Object.keys(FUND_LABELS) as FundKey[]).map((k) => (
                <tr key={k}>
                  <Td>{FUND_LABELS[k]}</Td><Td right>{Math.round(flow.funds[k].pct * 100)}%</Td><Td right>{num(flow.funds[k].share)}</Td>
                  <Td right>{num(flow.funds[k].withdrawn)}</Td>
                  <Td right bold color={flow.funds[k].available >= 0 ? undefined : '#EF4444'}>{num(flow.funds[k].available)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.values(flow.funds).some((f) => f.available < 0) && <p className="text-xs mt-3" style={{ color: '#EF4444' }}>Valor negativo: já foi levantado mais do que a parte deste fundo.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Chart title="Receita e despesas" data={series} lines={[{ key: 'receita', name: 'Receita', color: '#10B981' }, { key: 'despesa', name: 'Despesa', color: '#EF4444' }]} />
        <Chart title="D.R.E (receita potencial)" data={series} lines={[{ key: 'dre', name: 'DRE', color: '#6366F1' }]} />
        <Chart title="Lucro líquido" data={series} lines={[{ key: 'lucro', name: 'Lucro', color: '#0EA5E9' }]} />
        <Chart title="Percentual de lucro" data={series.filter((s) => s.pct !== null)} lines={[{ key: 'pct', name: '% Lucro', color: '#F59E0B' }]} suffix="%" />
      </div>
    </div>
  );
}

const nameKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const walletLabel = (w: string) => (w === 'Fisico' ? 'Físico' : w);

type Due = { payee: string; associateId: string | null; due: number; role: string };

// Quem recebe neste mes: associados (comissao), vendas de novos estudantes,
// salarios fixos e pro-labore.
function duesFor(month: Month, data: Summary): Due[] {
  const out: Due[] = [];
  for (const a of data.associates) {
    const v = month.commissions[a.id] || 0;
    if (v > 0) out.push({ payee: a.name, associateId: a.id, due: v, role: 'Comissão' });
  }
  if (month.newStudentFee > 0) out.push({ payee: data.settings.perNewStudentName, associateId: null, due: month.newStudentFee, role: `${month.newStudents} novos estudantes` });
  for (const s of data.settings.fixedSalaries) {
    if (month.period >= s.startPeriod && (!s.endPeriod || month.period <= s.endPeriod)) out.push({ payee: s.name, associateId: null, due: s.amount, role: 'Salário fixo' });
  }
  if (month.proLabore > 0) out.push({ payee: 'Pró-labore', associateId: null, due: month.proLabore, role: 'Pró-labore' });
  return out;
}

function PayrollModal({ period, data, onClose, onSaved }: { period: string; data: Summary; onClose: () => void; onSaved: () => void }) {
  const month = data.months.find((m) => m.period === period)!;
  const payments = data.salaryPayments.filter((p) => p.period === period);
  const [proLabore, setProLabore] = useState(String(month.proLabore));
  const [reinvestment, setReinvestment] = useState(String(month.reinvestment));
  const [reserve, setReserve] = useState(String(month.reserve));
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ payee: string; associateId: string | null; amount: string; wallet: string; date: string; notes: string } | null>(null);

  // Totais antigos por carteira (planilha ate Maio), sem detalhe por pessoa.
  const legacy = WALLETS.filter((w) => w !== 'Fisico').map((w) => ({
    w, v: month.wallets[w].salaries - payments.filter((p) => p.wallet === w).reduce((a, p) => a + p.amount, 0),
  }));
  const legacyTotal = legacy.reduce((a, x) => a + x.v, 0);
  const dues = duesFor(month, data);
  const paidFor = (d: Due) => payments
    .filter((p) => (d.associateId && p.associateId === d.associateId) || nameKey(p.payee) === nameKey(d.payee))
    .reduce((a, p) => a + p.amount, 0);
  const missing = Math.max(0, month.toPay - month.paid);

  const run = async (fn: () => Promise<unknown>, ok = 'Guardado') => {
    setBusy(true);
    try { await fn(); toast.success(ok); onSaved(); return true; } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const saveMonth = () => run(() => api.patch(`/finance/payroll/${period}`, { proLabore, reinvestment, reserve }));
  const clearLegacy = () => {
    if (!window.confirm('Apagar os totais antigos por carteira deste mês? Os pagamentos por pessoa ficam.')) return;
    run(() => api.patch(`/finance/payroll/${period}`, { status: 'Por pagar' }), 'Totais antigos apagados');
  };
  const savePayment = async () => {
    if (!form) return;
    const done = await run(() => api.post('/finance/salary-payments', { ...form, period }), 'Pagamento registado');
    if (done) setForm(null);
  };
  const changeWallet = (id: string, wallet: string) => run(() => api.patch(`/finance/salary-payments/${id}`, { wallet }), 'Carteira alterada');
  const remove = (id: string) => {
    if (!window.confirm('Apagar este pagamento?')) return;
    run(() => api.delete(`/finance/salary-payments/${id}`), 'Pagamento apagado');
  };
  const startPayment = (d?: Due) => setForm({
    payee: d?.payee || '', associateId: d?.associateId || null,
    amount: d ? String(Math.max(0, Math.round((d.due - paidFor(d)) * 100) / 100) || '') : '',
    wallet: 'M-pesa', date: today(), notes: '',
  });

  return (
    <Modal title={`Salários de ${monthLabel(period)}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm">Comissões {mzn(month.commissionTotal)} + novos estudantes {mzn(month.newStudentFee)} + salários fixos {mzn(month.fixedSalaries)} = <b>{mzn(month.salary)}</b></p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Pró-labore"><input className="input-base" type="number" min={0} value={proLabore} onChange={(e) => setProLabore(e.target.value)} /></Field>
          <Field label="Reinvestimento"><input className="input-base" type="number" min={0} value={reinvestment} onChange={(e) => setReinvestment(e.target.value)} /></Field>
          <Field label="Imprevistos"><input className="input-base" type="number" min={0} value={reserve} onChange={(e) => setReserve(e.target.value)} /></Field>
        </div>
        <button className="btn btn-outline" disabled={busy} onClick={saveMonth}>Guardar valores do mês</button>

        <div className="p-3 rounded text-sm flex flex-wrap gap-x-4 gap-y-1" style={{ background: 'var(--surface-2)' }}>
          <span>A pagar: <b>{mzn(month.toPay)}</b></span>
          <span>Pago: <b>{mzn(month.paid)}</b></span>
          <span>Falta: <b style={{ color: missing > 0.5 ? '#F59E0B' : '#10B981' }}>{mzn(missing)}</b></span>
          <span style={{ color: statusColor(month.status), fontWeight: 600 }}>{month.status}</span>
        </div>

        <div className="overflow-x-auto">
          <h4 className="font-semibold text-sm mb-1">Quem recebe</h4>
          <table className="w-full">
            <thead><tr><Th>Pessoa</Th><Th>De quê</Th><Th right>A receber</Th><Th right>Pago</Th><Th right>Falta</Th><Th /></tr></thead>
            <tbody>{dues.map((d, i) => {
              const paid = paidFor(d);
              const left = d.due - paid;
              return (
                <tr key={i}>
                  <Td bold>{d.payee}</Td><Td>{d.role}</Td><Td right>{num(d.due)}</Td><Td right>{num(paid)}</Td>
                  {/* Diferencas de centimos (arredondamento da transferencia) contam como pago. */}
                  <Td right color={left >= 1 ? '#F59E0B' : left <= -1 ? '#0EA5E9' : '#10B981'}>{left >= 1 ? num(left) : left <= -1 ? `+${num(-left)} a mais` : '0'}</Td>
                  <Td>{left >= 1 && <button className="text-xs underline" onClick={() => startPayment(d)}>Registar pagamento</button>}</Td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Se alguém recebeu tudo numa só transferência (ex.: comissão + salário fixo), o pagamento aparece numa linha e a outra fica por pagar; o total do mês é o que conta.</p>
        </div>

        <div className="overflow-x-auto">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-semibold text-sm">Pagamentos feitos</h4>
            <button className="text-xs flex items-center gap-1 underline" onClick={() => startPayment()}><Plus size={12} /> Outro pagamento</button>
          </div>
          {payments.length === 0 && legacyTotal <= 0.005 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhum pagamento registado neste mês.</p>}
          {payments.length > 0 && (
            <table className="w-full">
              <thead><tr><Th>Data</Th><Th>Pessoa</Th><Th>Carteira</Th><Th right>Valor</Th><Th>Observação</Th><Th /></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id}>
                  <Td>{dateLabel(p.date)}</Td><Td bold>{p.payee}</Td>
                  <Td>
                    <select className="input-base" style={inputSm} value={p.wallet} disabled={busy} aria-label={`Carteira do pagamento a ${p.payee}`} onChange={(e) => changeWallet(p.id, e.target.value)}>
                      {WALLETS.map((w) => <option key={w} value={w}>{walletLabel(w)}</option>)}
                    </select>
                  </Td>
                  <Td right bold>{num(p.amount)}</Td><Td>{p.notes}</Td>
                  <Td><button onClick={() => remove(p.id)} aria-label={`Apagar pagamento a ${p.payee}`} disabled={busy}><Trash2 size={13} /></button></Td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {legacyTotal > 0.005 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              Totais antigos da planilha, sem detalhe por pessoa: {legacy.filter((x) => x.v > 0.005).map((x) => `${walletLabel(x.w)} ${num(x.v)}`).join(' · ')}.{' '}
              <button className="underline" onClick={clearLegacy} disabled={busy}>Apagar estes totais</button>
            </p>
          )}
        </div>

        {form && (
          <div className="p-3 rounded space-y-2" style={{ border: '1px solid var(--border)' }}>
            <h4 className="font-semibold text-sm">Registar pagamento</h4>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Pessoa">
                <input className="input-base" list="finance-payees" value={form.payee} onChange={(e) => {
                  const a = data.associates.find((x) => nameKey(x.name) === nameKey(e.target.value));
                  setForm({ ...form, payee: e.target.value, associateId: a?.id || null });
                }} />
              </Field>
              <Field label="Valor"><input className="input-base" type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Carteira">
                <select className="input-base" value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value })}>
                  {WALLETS.map((w) => <option key={w} value={w}>{walletLabel(w)}</option>)}
                </select>
              </Field>
              <Field label="Data"><input className="input-base" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            </div>
            <Field label="Observação"><input className="input-base" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <datalist id="finance-payees">{[...new Set(dues.map((d) => d.payee))].map((n) => <option key={n} value={n} />)}</datalist>
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy || !form.payee.trim() || !(Number(form.amount) > 0)} onClick={savePayment}>Guardar pagamento</button>
              <button className="btn btn-outline" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function FinanceMonths({ data, reload }: { data: Summary; reload: () => void }) {
  const years = data.flow.years.map((y) => y.year);
  const [year, setYear] = useState(years[years.length - 1] || String(new Date().getFullYear()));
  const [editing, setEditing] = useState<string | null>(null);
  const months = data.months.filter((m) => m.period.startsWith(year));
  const series = months.map((m) => ({ label: monthShort(m.period), receita: m.revenue, despesa: m.expense, dre: m.dre, lucro: m.profit, pct: m.profitPct === null ? null : Math.round(m.profitPct * 1000) / 10 }));
  return (
    <div className="space-y-4">
      <YearSelect years={years} value={year} onChange={setYear} />
      <div className="card p-4 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Resumo financeiro {year}</h3>
        <table className="w-full">
          <thead><tr>{['Mês', 'DRE', 'Receita', 'Despesa', 'Saldo', 'Salários', 'Pró-labore', 'Reinvest.', 'Imprev.', 'Lucro líquido', '% Lucro', 'Salários', ''].map((h, i) => <Th key={i} right={i > 0 && i < 11}>{h}</Th>)}</tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period}>
                <Td bold>{monthLabel(m.period).split(' ')[0]}</Td><Td right>{num(m.dre)}</Td><Td right>{num(m.revenue)}</Td><Td right>{num(m.expense)}</Td><Td right>{num(m.balance)}</Td>
                <Td right>{num(m.salary)}</Td><Td right>{num(m.proLabore)}</Td><Td right>{num(m.reinvestment)}</Td><Td right>{num(m.reserve)}</Td>
                <Td right bold color={m.profit >= 0 ? '#10B981' : '#EF4444'}>{num(m.profit)}</Td><Td right>{pct(m.profitPct)}</Td>
                <Td><span style={{ color: statusColor(m.status), fontSize: 12, fontWeight: 600 }}>{m.status}</span></Td>
                <Td><button onClick={() => setEditing(m.period)} aria-label={`Salários de ${monthLabel(m.period)}`}><Pencil size={13} /></button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card p-4 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-2">Distribuição do montante existente por mês</h3>
        <table className="w-full">
          <thead><tr><Th>Mês</Th>{WALLETS.map((w) => <Th key={w} right>{w === 'Fisico' ? 'Físico' : w}</Th>)}<Th right>Total</Th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.period}><Td bold>{monthLabel(m.period).split(' ')[0]}</Td>{WALLETS.map((w) => <Td key={w} right>{num(m.wallets[w].net)}</Td>)}<Td right bold>{num(m.walletTotal)}</Td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Chart title="Receita e despesas" data={series} lines={[{ key: 'receita', name: 'Receita', color: '#10B981' }, { key: 'despesa', name: 'Despesa', color: '#EF4444' }]} />
        <Chart title="D.R.E" data={series} lines={[{ key: 'dre', name: 'DRE', color: '#6366F1' }]} />
        <Chart title="Lucro líquido" data={series} lines={[{ key: 'lucro', name: 'Lucro', color: '#0EA5E9' }]} />
        <Chart title="Percentual de lucro" data={series.filter((s) => s.pct !== null)} lines={[{ key: 'pct', name: '% Lucro', color: '#F59E0B' }]} suffix="%" />
      </div>
      {editing && data.months.some((m) => m.period === editing) && <PayrollModal period={editing} data={data} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

const LINE_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#8B5CF6', '#EC4899', '#14B8A6'];

export function FinanceCommissions({ data }: { data: Summary }) {
  const years = data.flow.years.map((y) => y.year);
  const [year, setYear] = useState(years[years.length - 1] || String(new Date().getFullYear()));
  const months = data.months.filter((m) => m.period.startsWith(year));
  const feeName = data.settings.perNewStudentName;
  const showFee = months.some((m) => m.newStudentFee > 0);
  const series = months.map((m) => {
    const row: any = { label: monthShort(m.period), [feeName]: m.newStudentFee };
    for (const a of data.associates) row[a.name] = m.commissions[a.id] || 0;
    return row;
  });
  const total = (f: (m: Month) => number) => months.reduce((a, m) => a + f(m), 0);
  return (
    <div className="space-y-4">
      <YearSelect years={years} value={year} onChange={setYear} />
      <div className="card p-4 overflow-x-auto">
        <h3 className="font-semibold text-sm mb-1">Desempenho do lote {year}</h3>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{Math.round(data.settings.commissionRate * 100)}% de cada pagamento recebido, no mês em que foi pago.</p>
        <table className="w-full">
          <thead><tr><Th>Mês</Th>{showFee && <Th right>{feeName}</Th>}{data.associates.map((a) => <Th key={a.id} right>{a.name}</Th>)}<Th right>Total</Th></tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.period}>
                <Td bold>{monthLabel(m.period).split(' ')[0]}</Td>
                {showFee && <Td right>{num(m.newStudentFee)}</Td>}
                {data.associates.map((a) => <Td key={a.id} right>{num(m.commissions[a.id] || 0)}</Td>)}
                <Td right bold>{num(m.commissionTotal + m.newStudentFee)}</Td>
              </tr>
            ))}
            <tr>
              <Td bold>Total</Td>
              {showFee && <Td right bold>{num(total((m) => m.newStudentFee))}</Td>}
              {data.associates.map((a) => <Td key={a.id} right bold>{num(total((m) => m.commissions[a.id] || 0))}</Td>)}
              <Td right bold>{num(total((m) => m.commissionTotal + m.newStudentFee))}</Td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card p-4">
        <h3 className="font-semibold text-sm mb-3">Comissão por colaborador</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => mzn(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {data.associates.map((a, i) => <Bar key={a.id} dataKey={a.name} stackId="a" fill={LINE_COLORS[i % LINE_COLORS.length]} />)}
            {showFee && <Bar dataKey={feeName} stackId="a" fill="#94A3B8" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
