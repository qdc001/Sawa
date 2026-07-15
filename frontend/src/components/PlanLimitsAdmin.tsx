// Tabela admin para configurar limites de tokens LLM por plano.
//
// Mostrada em Definicoes > Limites IA (so OWNER/ADMIN). Cada plano tem
// dois campos: tokens diarios e mensais. -1 = ilimitado.

import { useEffect, useState } from 'react';
import { Loader2, Save, Infinity as InfinityIcon } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface PlanLimit {
  planKey: string;
  label: string;
  daily: number;
  monthly: number;
  isCustom: boolean;
}

function fmt(n: number): string {
  if (n === -1) return 'sem limite';
  return n.toLocaleString('pt-PT');
}

export default function PlanLimitsAdmin() {
  const [plans, setPlans] = useState<PlanLimit[]>([]);
  const [editing, setEditing] = useState<Record<string, { daily: string; monthly: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/ai-usage/plan-limits');
      setPlans(data.planLimits || []);
      const e: Record<string, { daily: string; monthly: string }> = {};
      for (const p of data.planLimits) {
        e[p.planKey] = { daily: String(p.daily), monthly: String(p.monthly) };
      }
      setEditing(e);
    } catch {
      toast.error('Erro a carregar limites');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async (planKey: string) => {
    const e = editing[planKey];
    if (!e) return;
    const daily = parseInt(e.daily, 10);
    const monthly = parseInt(e.monthly, 10);
    if (!Number.isFinite(daily) || !Number.isFinite(monthly)) {
      toast.error('Valores invalidos. Usa numeros inteiros (-1 = sem limite)');
      return;
    }
    setSavingKey(planKey);
    try {
      await api.patch(`/ai-usage/plan-limits/${planKey}`, {
        dailyTokenLimit: daily,
        monthlyTokenLimit: monthly,
      });
      toast.success(`Limites do plano ${planKey} actualizados`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao guardar');
    } finally { setSavingKey(null); }
  };

  if (loading) {
    return <div className="card p-6 flex justify-center"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--text-muted)' }} /></div>;
  }

  return (
    <div className="card p-5">
      <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Limites de tokens LLM por plano</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Define quantos tokens (input + output) cada plano pode consumir por dia e por mês. Usa <code>-1</code> para "sem limite". Quando um workspace atinge o limite, novas chamadas à Leizy (assistente, treino, chatbot legado, copilot) são bloqueadas até ao reset (diário às 00:00 UTC, mensal no dia 1).
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--surface-2)' }}>
              <th className="text-left p-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Plano</th>
              <th className="text-left p-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Tokens/dia</th>
              <th className="text-left p-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Tokens/mês</th>
              <th className="text-left p-2 font-medium" style={{ color: 'var(--text-secondary)' }}>Origem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const e = editing[p.planKey] || { daily: String(p.daily), monthly: String(p.monthly) };
              const changed = e.daily !== String(p.daily) || e.monthly !== String(p.monthly);
              return (
                <tr key={p.planKey} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="p-2 font-medium" style={{ color: 'var(--text-primary)' }}>{p.label}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="input-base w-32 text-sm"
                        value={e.daily}
                        onChange={(ev) => setEditing((s) => ({ ...s, [p.planKey]: { ...e, daily: ev.target.value } }))}
                      />
                      {e.daily === '-1' && <InfinityIcon size={14} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>actual: {fmt(p.daily)}</p>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="input-base w-36 text-sm"
                        value={e.monthly}
                        onChange={(ev) => setEditing((s) => ({ ...s, [p.planKey]: { ...e, monthly: ev.target.value } }))}
                      />
                      {e.monthly === '-1' && <InfinityIcon size={14} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>actual: {fmt(p.monthly)}</p>
                  </td>
                  <td className="p-2">
                    <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: p.isCustom ? '#DBEAFE' : 'var(--surface-2)', color: p.isCustom ? '#1E40AF' : 'var(--text-muted)' }}>
                      {p.isCustom ? 'configurado' : 'default'}
                    </span>
                  </td>
                  <td className="p-2">
                    <button
                      className="btn btn-primary text-xs px-2 py-1 flex items-center gap-1"
                      onClick={() => save(p.planKey)}
                      disabled={!changed || savingKey === p.planKey}
                    >
                      {savingKey === p.planKey ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      Guardar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
