import { ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';

// ---------- Fases do metodo (configuraveis em Definicoes) ----------
// O id fica gravado no estudante; a posicao na lista da o "F1, F2...".
export type Phase = { id: number; name: string };
let phaseCache: Phase[] | null = null;
let phaseLoading: Promise<void> | null = null;
const phaseListeners = new Set<(p: Phase[]) => void>();

export function reloadPhases(): Promise<void> {
  phaseLoading = api.get<{ phases: Phase[] }>('/finance/phases').then(({ data }) => {
    phaseCache = data.phases;
    phaseListeners.forEach((l) => l(data.phases));
  }).finally(() => { phaseLoading = null; });
  return phaseLoading;
}
export function setPhasesCache(p: Phase[]) {
  phaseCache = p;
  phaseListeners.forEach((l) => l(p));
}
// Todas as vistas usam a mesma lista: quando muda em Definicoes, muda em todo o lado.
export function usePhases(): Phase[] | null {
  const [p, setP] = useState<Phase[] | null>(phaseCache);
  useEffect(() => {
    phaseListeners.add(setP);
    if (!phaseCache && !phaseLoading) reloadPhases().catch(() => {});
    else if (phaseCache) setP(phaseCache);
    return () => { phaseListeners.delete(setP); };
  }, []);
  return p;
}
export function phaseLabel(list: Phase[] | null, id: number | null | undefined, short = false): string {
  if (!id) return short ? '—' : 'Sem fase';
  const i = (list || []).findIndex((p) => p.id === id);
  if (i < 0) return short ? '?' : 'Fase removida';
  return short ? `F${i + 1}` : `F${i + 1} · ${list![i].name}`;
}

export const WALLETS = ['M-pesa', 'E-mola', 'BIM', 'Fisico'] as const;
export type Wallet = (typeof WALLETS)[number];

export type Associate = { id: string; code: string; name: string; whatsapp?: string | null; userId?: string | null };
export type WalletLine = { in: number; out: number; salaries: number; net: number };
export type Month = {
  period: string; dre: number; revenue: number; expense: number; balance: number;
  commissions: Record<string, number>; commissionTotal: number; newStudents: number; newStudentFee: number;
  fixedSalaries: number; salary: number; proLabore: number; reinvestment: number; reserve: number;
  profit: number; profitPct: number | null; toPay: number; paid: number; status: string;
  wallets: Record<Wallet, WalletLine>; walletTotal: number; hasActivity: boolean;
};
export type Year = {
  year: string; months: number; activeMonths: number;
  totals: Record<'dre' | 'revenue' | 'expense' | 'balance' | 'salary' | 'proLabore' | 'reinvestment' | 'reserve' | 'profit', number>;
  averages: Record<'dre' | 'revenue' | 'expense' | 'balance' | 'salary' | 'proLabore' | 'profit', number>;
  profitPct: number | null; wallets: Record<Wallet, number>; walletTotal: number;
};
export type FundKey = 'Previdencia' | 'Oportunidade' | 'Dono' | 'Expansao';
export type Flow = {
  years: Year[]; walletTotals: Record<Wallet, number>; total: number;
  workingCapital: number; workingCapitalFilled: number; distributable: number;
  afterCapitalByYear: Record<string, number>;
  funds: Record<FundKey, { pct: number; share: number; withdrawn: number; available: number }>;
};
export type FixedSalary = { name: string; amount: number; startPeriod: string; endPeriod?: string | null };
export type Settings = {
  commissionRate: number; perNewStudent: number; perNewStudentName: string; perNewStudentFrom: string;
  workingCapital: number; sealPrevidencia: number; sealOportunidade: number; sealDono: number; sealExpansao: number;
  fixedSalaries: FixedSalary[]; proLabore: number; proLaboreFrom: string; couponValidityDays: number; couponDiscount: number;
};
export type SalaryPayment = {
  id: string; period: string; payee: string; associateId: string | null; amount: number; wallet: string;
  date: string | null; notes: string | null; source: string;
};
export type Summary = { settings: Settings; months: Month[]; flow: Flow; associates: Associate[]; salaryPayments: SalaryPayment[] };
export const statusColor = (s: string) => (s === 'Pago' ? '#10B981' : s === 'Pago em parte' ? '#0EA5E9' : '#F59E0B');

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(Math.abs(n) < 0.005 ? 0 : n);
export const mzn = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${num(n)} MZN`);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(1)}%`);

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const monthName = (p: string) => MONTHS[Number(p.slice(5, 7)) - 1];
export const monthLabel = (p: string) => `${monthName(p)} ${p.slice(0, 4)}`;
export const monthShort = (p: string) => `${monthName(p).slice(0, 3)}/${p.slice(2, 4)}`;
export const dateLabel = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const errMsg = (e: any, fallback = 'Erro') => e?.response?.data?.message || fallback;
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Segunda-feira da semana do dia indicado.
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7));
// Dia de hoje em Maputo (UTC+2), igual ao do servidor.
export const maputoToday = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
// Baixa um ficheiro gerado pelo servidor. Se der erro, le a mensagem que vem dentro do blob.
export async function downloadFile(url: string, params: Record<string, string>, filename: string) {
  try {
    const { data } = await api.get(url, { params, responseType: 'blob', timeout: 120000 });
    const u = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch (e: any) {
    let msg = 'Não foi possível baixar o ficheiro';
    try { msg = JSON.parse(await e?.response?.data?.text())?.message || msg; } catch { /* sem mensagem */ }
    throw new Error(msg);
  }
}

export const CHART_GRID = 'var(--border)';
export const CHART_TICK = { fontSize: 11, fill: 'var(--text-muted)' };
export const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className={`card p-5 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto`} style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-bold mt-1" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`py-2 px-2 text-[11px] uppercase font-semibold whitespace-nowrap ${right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{children}</th>;
}
export function Td({ children, right, bold, color }: { children?: ReactNode; right?: boolean; bold?: boolean; color?: string }) {
  return <td className={`py-1.5 px-2 text-sm whitespace-nowrap ${right ? 'text-right' : ''} ${bold ? 'font-semibold' : ''}`} style={{ color, borderBottom: '1px solid var(--border)' }}>{children}</td>;
}

export function Badge({ text, tone }: { text: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const c = { green: ['#D1FAE5', '#065F46'], amber: ['#FEF3C7', '#92400E'], red: ['#FEE2E2', '#991B1B'], blue: ['#E0F2FE', '#075985'], gray: ['#E2E8F0', '#334155'] }[tone];
  return <span className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: c[0], color: c[1] }}>{text}</span>;
}

export function YearSelect({ years, value, onChange }: { years: string[]; value: string; onChange: (y: string) => void }) {
  return (
    <div className="flex gap-1">
      {years.map((y) => (
        <button key={y} onClick={() => onChange(y)} className="text-xs px-3 py-1 rounded font-medium"
          style={{ background: value === y ? 'var(--primary)' : 'var(--surface-3)', color: value === y ? '#fff' : 'var(--text-secondary)' }}>{y}</button>
      ))}
    </div>
  );
}

export const inputSm = { padding: '4px 8px', fontSize: 13 };
