// Barras de progresso de quota de tokens LLM do workspace.
//
// Mostradas no topo da pagina IA Vendedora. Cada barra mostra uso vs limite,
// com cores progressivas (verde -> amarelo -> vermelho) conforme aproxima do
// limite. Quando ultrapassa, fica vermelho saturado.

import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Infinity as InfinityIcon } from 'lucide-react';
import api from '../lib/api';

interface QuotaBar {
  used: number;
  limit: number;
  unlimited: boolean;
  percent: number;
  resetAt: string;
}

interface Stats {
  planKey: string;
  daily: QuotaBar;
  monthly: QuotaBar;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('pt-PT');
}

function barColor(percent: number): string {
  if (percent >= 100) return '#DC2626';
  if (percent >= 90) return '#EA580C';
  if (percent >= 70) return '#F59E0B';
  return '#16A34A';
}

function Bar({ label, q }: { label: string; q: QuotaBar }) {
  const color = barColor(q.percent);
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-xs">
        <span style={{ color: 'var(--text-secondary)' }} className="font-medium">{label}</span>
        {q.unlimited ? (
          <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <InfinityIcon size={12} /> sem limite
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>
            <strong style={{ color: q.percent >= 90 ? '#DC2626' : 'var(--text-primary)' }}>{fmt(q.used)}</strong> / {fmt(q.limit)} tokens ({q.percent}%)
          </span>
        )}
      </div>
      {!q.unlimited && (
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full transition-all"
            style={{ width: `${Math.min(100, q.percent)}%`, background: color }}
          />
        </div>
      )}
      {q.percent >= 90 && !q.unlimited && (
        <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: '#DC2626' }}>
          <AlertTriangle size={11} /> {q.percent >= 100 ? 'Quota esgotada, chamadas serao bloqueadas ate ao reset.' : 'Quase no limite.'}
        </p>
      )}
    </div>
  );
}

export default function AiUsageBars() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get('/ai-usage/stats');
        if (alive) setStats(data);
      } catch { /* silent */ } finally { if (alive) setLoading(false); }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className="card p-4 mb-4 flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <Loader2 size={14} className="animate-spin" /> A carregar consumo...
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Consumo de tokens LLM
        </p>
        <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
          Plano {stats.planKey}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Bar label="Hoje" q={stats.daily} />
        <Bar label="Este mês" q={stats.monthly} />
      </div>
    </div>
  );
}
