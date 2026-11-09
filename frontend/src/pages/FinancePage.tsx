import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Wallet } from 'lucide-react';
import api from '../lib/api';
import { useAuthStore } from '../store';
import { errMsg, Summary } from '../components/finance/shared';
import { FinanceCommissions, FinanceMonths, FinanceOverview } from '../components/finance/FinanceOverview';
import FinanceLedger from '../components/finance/FinanceLedger';
import FinanceStudents from '../components/finance/FinanceStudents';
import { FinanceCoupons, FinanceDistribution, FinanceInvestments, FinanceMine, FinanceProgram, FinanceSettings } from '../components/finance/FinanceOther';

type Tab = 'overview' | 'months' | 'ledger' | 'students' | 'installments' | 'program' | 'commissions' | 'investments' | 'distribution' | 'coupons' | 'settings' | 'mine';

const ADMIN_TABS: { v: Tab; label: string }[] = [
  { v: 'overview', label: 'Fluxo de caixa' },
  { v: 'months', label: 'Resumo financeiro' },
  { v: 'ledger', label: 'Lançamentos' },
  { v: 'students', label: 'Estudantes' },
  { v: 'installments', label: 'Parcelamento' },
  { v: 'program', label: 'Painel e Associados' },
  { v: 'commissions', label: 'Desempenho do lote' },
  { v: 'investments', label: 'Investimentos' },
  { v: 'distribution', label: 'Distribuição' },
  { v: 'coupons', label: 'Cupões' },
  { v: 'settings', label: 'Definições' },
];
const MEMBER_TABS: { v: Tab; label: string }[] = [
  { v: 'mine', label: 'A minha comissão' },
  { v: 'students', label: 'Os meus estudantes' },
  { v: 'program', label: 'Painel' },
];

export default function FinancePage() {
  const { user, workspace } = useAuthStore();
  // uiMode chega depois do login: so se sai quando se sabe que nao e legacy.
  const uiMode = (workspace as any)?.uiMode;
  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const tabs = isAdmin ? ADMIN_TABS : MEMBER_TABS;
  const [tab, setTab] = useState<Tab>(tabs[0].v);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(isAdmin);

  const load = useCallback(() => {
    if (!isAdmin) return;
    api.get('/finance/summary').then(({ data: d }) => setData(d))
      .catch((e) => toast.error(errMsg(e, 'Erro a carregar Finanças')))
      .finally(() => setLoading(false));
  }, [isAdmin]);
  useEffect(load, [load]);

  const empty = useMemo(() => isAdmin && !!data && data.months.length === 0, [isAdmin, data]);

  if (uiMode === 'clinical') return <Navigate to="/" replace />;

  const needsData = !['students', 'program', 'mine'].includes(tab);
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}><Wallet size={20} /> Finanças</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Lançamentos, parcelamento, comissões e a saúde financeira do M.E.T.A.</p>
      </div>
      <div className="flex gap-1 flex-wrap">
        {tabs.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)} className="text-xs px-3 py-1.5 rounded font-medium"
            style={{ background: tab === t.v ? 'var(--primary)' : 'var(--surface-3)', color: tab === t.v ? '#fff' : 'var(--text-secondary)' }}>{t.label}</button>
        ))}
      </div>

      {empty && tab !== 'settings' && (
        <div className="card p-4 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>Ainda não há dados. Importa a planilha para começar.</span>
          <button className="btn btn-primary" onClick={() => setTab('settings')}>Ir para a importação</button>
        </div>
      )}

      {isAdmin && needsData && (loading || !data) ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <>
          {tab === 'overview' && data && <FinanceOverview data={data} />}
          {tab === 'months' && data && <FinanceMonths data={data} reload={load} />}
          {tab === 'ledger' && data && <FinanceLedger data={data} reload={load} />}
          {(tab === 'students' || tab === 'installments') && (
            <FinanceStudents mode={tab} associates={data?.associates || []} rate={data?.settings.commissionRate ?? 0.25} canEdit={isAdmin} onChanged={load} />
          )}
          {tab === 'program' && <FinanceProgram canEdit={isAdmin} onChanged={load} />}
          {tab === 'commissions' && data && <FinanceCommissions data={data} />}
          {tab === 'investments' && <FinanceInvestments reload={load} />}
          {tab === 'distribution' && <FinanceDistribution />}
          {tab === 'coupons' && <FinanceCoupons />}
          {tab === 'settings' && data && <FinanceSettings key={JSON.stringify(data.settings)} data={data} reload={load} />}
          {tab === 'mine' && <FinanceMine />}
        </>
      )}
    </div>
  );
}
