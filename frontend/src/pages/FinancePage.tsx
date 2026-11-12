import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Loader2, Wallet } from 'lucide-react';
import api from '../lib/api';
import { useAuthStore } from '../store';
import { isMetaWorkspace } from '../lib/useFinanceAccess';
import { errMsg, Summary } from '../components/finance/shared';
import { FinanceCommissions, FinanceMonths, FinanceOverview } from '../components/finance/FinanceOverview';
import FinanceLedger from '../components/finance/FinanceLedger';
import FinanceStudents from '../components/finance/FinanceStudents';
import { DEFAULT_DEFENSE_SHARES } from '../components/finance/shared';
import FinancePhaseBoard from '../components/finance/FinancePhaseBoard';
import FinanceReports from '../components/finance/FinanceReports';
import { FinanceCoupons, FinanceDistribution, FinanceInvestments, FinanceMine, FinanceProgram, FinanceSettings } from '../components/finance/FinanceOther';

type Tab = 'overview' | 'months' | 'ledger' | 'students' | 'installments' | 'phases' | 'reports' | 'program' | 'commissions' | 'investments' | 'distribution' | 'coupons' | 'settings' | 'mine';

const ADMIN_TABS: { v: Tab; label: string }[] = [
  { v: 'overview', label: 'Fluxo de caixa' },
  { v: 'months', label: 'Resumo financeiro' },
  { v: 'ledger', label: 'Lançamentos' },
  { v: 'students', label: 'Estudantes' },
  { v: 'installments', label: 'Parcelamento' },
  { v: 'phases', label: 'Quadro de fases' },
  { v: 'reports', label: 'Relatórios' },
  { v: 'program', label: 'Painel e Associados' },
  { v: 'commissions', label: 'Desempenho do lote' },
  { v: 'investments', label: 'Investimentos' },
  { v: 'distribution', label: 'Distribuição' },
  { v: 'coupons', label: 'Cupões' },
  { v: 'settings', label: 'Definições' },
];
// Abaixo de admin: so os seus estudantes, o quadro de fases e o seu desempenho do lote.
const MEMBER_TABS: { v: Tab; label: string }[] = [
  { v: 'students', label: 'Os meus estudantes' },
  { v: 'phases', label: 'Quadro de fases' },
  { v: 'mine', label: 'O meu desempenho do lote' },
];

export default function FinancePage() {
  const { user, workspace } = useAuthStore();
  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const tabs = isAdmin ? ADMIN_TABS : MEMBER_TABS;
  const [tab, setTab] = useState<Tab>(tabs[0].v);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(isAdmin);
  // Se o papel mudar (ex.: deixou de ser admin), volta para um separador que esta pessoa pode ver.
  useEffect(() => {
    if (!tabs.some((t) => t.v === tab)) setTab(tabs[0].v);
  }, [tabs, tab]);

  const load = useCallback(() => {
    if (!isAdmin) return;
    api.get('/finance/summary').then(({ data: d }) => setData(d))
      // 403 = o papel mudou entretanto; o AppLayout actualiza o papel e o ecra passa para os separadores certos.
      .catch((e) => { if (e?.response?.status !== 403) toast.error(errMsg(e, 'Erro a carregar Finanças')); })
      .finally(() => setLoading(false));
  }, [isAdmin]);
  useEffect(load, [load]);

  const [exporting, setExporting] = useState(false);
  const exportData = async () => {
    setExporting(true);
    try {
      const { data: blob } = await api.get('/finance/export', { responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financas-meta-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Não foi possível baixar os dados'); } finally { setExporting(false); }
  };

  const empty = useMemo(() => isAdmin && !!data && data.months.length === 0, [isAdmin, data]);

  if (!isMetaWorkspace(workspace?.name)) return <Navigate to="/" replace />;

  const needsData = !['students', 'phases', 'program', 'mine'].includes(tab);
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}><Wallet size={20} /> Finanças</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Lançamentos, parcelamento, comissões e a saúde financeira do M.E.T.A.</p>
        </div>
        {isAdmin && (
          <button className="btn" disabled={exporting} onClick={exportData}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Baixar dados (Excel)
          </button>
        )}
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
            <FinanceStudents mode={tab} associates={data?.associates || []} rate={data?.settings.commissionRate ?? 0.25} canEdit={isAdmin} onChanged={load}
              creditName={data?.settings.perNewStudentName ?? 'Lucília'} creditValue={data?.settings.perNewStudent ?? 250}
              shares={data?.settings.defenseShares ?? DEFAULT_DEFENSE_SHARES} />
          )}
          {tab === 'phases' && <FinancePhaseBoard associates={data?.associates || []} canEdit />}
          {tab === 'reports' && data && <FinanceReports associates={data.associates} />}
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
