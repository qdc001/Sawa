import { useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts';
import api from '../../lib/api';
import {
  CHART_GRID, CHART_TICK, errMsg, Field, FundKey, Kpi, Modal, Month, monthLabel, monthShort, mzn, num, pct, Summary,
  Td, Th, tooltipStyle, WALLETS, YearSelect,
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

function PayrollModal({ month, onClose, onSaved }: { month: Month; onClose: () => void; onSaved: () => void }) {
  const [proLabore, setProLabore] = useState(String(month.proLabore));
  const [reinvestment, setReinvestment] = useState(String(month.reinvestment));
  const [reserve, setReserve] = useState(String(month.reserve));
  const [status, setStatus] = useState(month.status);
  const [mpesa, setMpesa] = useState(String(month.wallets['M-pesa'].salaries));
  const [emola, setEmola] = useState(String(month.wallets['E-mola'].salaries));
  const [bim, setBim] = useState(String(month.wallets.BIM.salaries));
  const [busy, setBusy] = useState(false);
  const toPay = month.salary + (Number(proLabore) || 0);
  const paid = (Number(mpesa) || 0) + (Number(emola) || 0) + (Number(bim) || 0);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/finance/payroll/${month.period}`, { proLabore, reinvestment, reserve, status, paidMpesa: mpesa, paidEmola: emola, paidBim: bim });
      toast.success('Guardado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Salários de ${monthLabel(month.period)}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">Comissões {mzn(month.commissionTotal)} + novos estudantes {mzn(month.newStudentFee)} + salários fixos {mzn(month.fixedSalaries)} = <b>{mzn(month.salary)}</b></p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Pró-labore"><input className="input-base" type="number" min={0} value={proLabore} onChange={(e) => setProLabore(e.target.value)} /></Field>
          <Field label="Reinvestimento"><input className="input-base" type="number" min={0} value={reinvestment} onChange={(e) => setReinvestment(e.target.value)} /></Field>
          <Field label="Imprevistos"><input className="input-base" type="number" min={0} value={reserve} onChange={(e) => setReserve(e.target.value)} /></Field>
        </div>
        <Field label="Situação">
          <select className="input-base" value={status} onChange={(e) => setStatus(e.target.value)}><option>Por pagar</option><option>Pago</option></select>
        </Field>
        {status === 'Pago' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Pago por M-pesa"><input className="input-base" type="number" min={0} value={mpesa} onChange={(e) => setMpesa(e.target.value)} /></Field>
              <Field label="Pago por E-mola"><input className="input-base" type="number" min={0} value={emola} onChange={(e) => setEmola(e.target.value)} /></Field>
              <Field label="Pago por BIM"><input className="input-base" type="number" min={0} value={bim} onChange={(e) => setBim(e.target.value)} /></Field>
            </div>
            <p className="text-xs" style={{ color: Math.abs(paid - toPay) > 0.01 ? '#F59E0B' : 'var(--text-muted)' }}>A pagar: {mzn(toPay)} · Indicado: {mzn(paid)}</p>
          </>
        )}
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

export function FinanceMonths({ data, reload }: { data: Summary; reload: () => void }) {
  const years = data.flow.years.map((y) => y.year);
  const [year, setYear] = useState(years[years.length - 1] || String(new Date().getFullYear()));
  const [editing, setEditing] = useState<Month | null>(null);
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
                <Td><span style={{ color: m.status === 'Pago' ? '#10B981' : '#F59E0B', fontSize: 12, fontWeight: 600 }}>{m.status}</span></Td>
                <Td><button onClick={() => setEditing(m)} aria-label="Editar salários"><Pencil size={13} /></button></Td>
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
      {editing && <PayrollModal month={editing} onClose={() => setEditing(null)} onSaved={reload} />}
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
