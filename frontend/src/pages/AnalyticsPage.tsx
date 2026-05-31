import { useEffect, useState } from 'react';
import {
  BarChart3, TrendingUp, Users, GitBranch, MessageCircle, Hourglass, Target,
  Loader2, Trophy, Calendar as CalIcon,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import api, { TeamMemberStats, LeadSourceStat, ConversionStats, RevenueData, DashboardData } from '../lib/api';

type Period = 'today' | '7d' | '30d' | '3m' | '6m' | '1y';
const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje', '7d': '7 dias', '30d': '30 dias', '3m': '3 meses', '6m': '6 meses', '1y': '1 ano',
};

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d');
  const [section, setSection] = useState<'trends' | 'team' | 'sources' | 'pipeline'>('trends');
  const [loading, setLoading] = useState(true);

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [revenue, setRevenue] = useState<RevenueData[]>([]);
  const [team, setTeam] = useState<TeamMemberStats[]>([]);
  const [sources, setSources] = useState<LeadSourceStat[]>([]);
  const [conv, setConv] = useState<ConversionStats | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/analytics/dashboard?period=${period}`),
      api.get(`/analytics/revenue?months=12`),
      api.get(`/analytics/team-performance?period=${period}`),
      api.get(`/analytics/lead-sources?period=${period}`),
      api.get(`/analytics/conversion-stats?period=${period}`),
    ]).then(([d, r, t, s, c]) => {
      setDashboard(d.data);
      setRevenue(Array.isArray(r.data) ? r.data : []);
      setTeam(Array.isArray(t.data) ? t.data : []);
      setSources(Array.isArray(s.data) ? s.data : []);
      setConv(c.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  if (loading && !dashboard) {
    return <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>;
  }

  const sectionsList = [
    { v: 'trends' as const, label: 'Tendências', icon: TrendingUp },
    { v: 'team' as const, label: 'Equipa', icon: Trophy },
    { v: 'sources' as const, label: 'Origens', icon: GitBranch },
    { v: 'pipeline' as const, label: 'Pipeline', icon: Target },
  ];

  // Transformar revenue para LineChart com mais dados
  const chartData = revenue.map((r) => ({ ...r, deals: r.deals || 0 }));

  // Pizza de origens
  const sourcesPie = sources.slice(0, 5).map((s) => ({ name: s.source, value: s.total }));
  const PIE_COLORS = ['#C8553D', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9'];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
            <BarChart3 size={20} /> Análises
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Relatórios detalhados do teu negócio</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className="text-xs px-2 py-1 rounded font-medium"
              style={{ background: period === p ? 'var(--primary)' : 'var(--surface-3)', color: period === p ? '#fff' : 'var(--text-secondary)' }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }}>
        {sectionsList.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.v} onClick={() => setSection(s.v)} className="px-4 py-2 text-sm font-medium flex items-center gap-2"
              style={{
                borderBottom: section === s.v ? '2px solid var(--primary)' : '2px solid transparent',
                color: section === s.v ? 'var(--primary)' : 'var(--text-secondary)',
                marginBottom: -1,
              }}>
              <Icon size={14} /> {s.label}
            </button>
          );
        })}
      </div>

      {/* Tendências */}
      {section === 'trends' && (
        <div className="space-y-4">
          {/* Receita 12 meses */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp size={16} /> Receita dos últimos 12 meses</h3>
            {chartData.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" name="Receita (MZN)" stroke="#C8553D" strokeWidth={2} dot={{ r: 4 }} />
                  <Line yAxisId="right" type="monotone" dataKey="deals" name="Negócios" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* KPIs principais */}
          {dashboard && conv && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Leads criados', value: dashboard.monthly.leadsCreated, growth: dashboard.monthly.leadsCreatedGrowth, color: '#C8553D' },
                { label: 'Negócios ganhos', value: dashboard.monthly.leadsWon, growth: dashboard.monthly.leadsWonGrowth, color: '#10B981' },
                { label: 'Tempo medio fecho', value: `${conv.avgConversionDays} dias`, color: '#8B5CF6' },
                { label: 'Win-rate global', value: `${conv.winRateGlobal}%`, color: '#F59E0B' },
              ].map((k) => (
                <div key={k.label} className="card p-4">
                  <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</p>
                  {k.growth !== undefined && k.growth !== 0 && (
                    <p className="text-xs mt-1" style={{ color: k.growth > 0 ? '#10B981' : '#EF4444' }}>
                      {k.growth > 0 ? '↑' : '↓'} {Math.abs(k.growth)}% vs período anterior
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Forecast */}
          {conv && (
            <div className="card p-5" style={{ background: 'linear-gradient(135deg, #F6E3DC, #F0F9FF)' }}>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Target size={16} style={{ color: 'var(--primary)' }} /> Forecast (próximos meses)
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pipeline aberto</p>
                  <p className="text-xl font-bold">MZN {(conv.forecastBaseValue / 1000).toFixed(0)}k</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{conv.forecastOpenCount} leads</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Win-rate aplicada</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{conv.winRateGlobal}%</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>baseado em histórico</p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Receita projectada</p>
                  <p className="text-xl font-bold" style={{ color: '#10B981' }}>MZN {(conv.forecastValue / 1000).toFixed(0)}k</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Equipa */}
      {section === 'team' && (
        <div className="space-y-4">
          {/* Gráfico de barras: receita por membro */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><Trophy size={16} style={{ color: '#F59E0B' }} /> Receita por membro</h3>
            {team.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={team}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => `MZN ${Number(v).toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="#C8553D" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Tabela leaderboard */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4">Leaderboard detalhado</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>#</th>
                    <th className="text-left py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Membro</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Criados</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Ganhos</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Perdidos</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Win-rate</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Receita</th>
                    <th className="text-right py-2 text-xs uppercase" style={{ color: 'var(--text-muted)' }}>Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td className="py-2 font-medium" style={{ color: i === 0 ? '#F59E0B' : 'var(--text-muted)' }}>
                        {i === 0 ? <Trophy size={14} className="inline" /> : `#${i + 1}`}
                      </td>
                      <td className="py-2 font-medium">{m.name}</td>
                      <td className="py-2 text-right">{m.created}</td>
                      <td className="py-2 text-right" style={{ color: '#10B981' }}>{m.won}</td>
                      <td className="py-2 text-right" style={{ color: '#EF4444' }}>{m.lost}</td>
                      <td className="py-2 text-right">
                        <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                          background: m.winRate >= 50 ? '#D1FAE5' : m.winRate >= 25 ? '#FEF3C7' : '#FEE2E2',
                          color: m.winRate >= 50 ? '#065F46' : m.winRate >= 25 ? '#92400E' : '#991B1B',
                        }}>{m.winRate}%</span>
                      </td>
                      <td className="py-2 text-right font-semibold">MZN {(m.revenue / 1000).toFixed(0)}k</td>
                      <td className="py-2 text-right">{m.openCount} ({(m.openValue / 1000).toFixed(0)}k)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Origens */}
      {section === 'sources' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-4">Distribuicao por origem</h3>
            {sourcesPie.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados de origem</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={sourcesPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {sourcesPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-semibold mb-4">Performance por origem</h3>
            <div className="space-y-2">
              {sources.map((s, i) => (
                <div key={i} className="p-3 rounded" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium">{s.source}</p>
                    <span className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{ background: s.winRate >= 30 ? '#D1FAE5' : '#FEF3C7', color: s.winRate >= 30 ? '#065F46' : '#92400E' }}>
                      {s.winRate}% win
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <div>Total: <strong>{s.total}</strong></div>
                    <div>Ganhos: <strong style={{ color: '#10B981' }}>{s.won}</strong></div>
                    <div>Receita: <strong>MZN {(s.revenue / 1000).toFixed(0)}k</strong></div>
                  </div>
                </div>
              ))}
              {sources.length === 0 && <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem dados</p>}
            </div>
          </div>
        </div>
      )}

      {/* Pipeline */}
      {section === 'pipeline' && dashboard && (
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-4">Distribuicao por etapa</h3>
            {dashboard.pipeline.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem etapas</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dashboard.pipeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#C8553D" radius={[4, 4, 0, 0]}>
                    {dashboard.pipeline.map((stage: any, i) => <Cell key={i} fill={stage.color || '#C8553D'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Funil visual */}
          <div className="card p-5">
            <h3 className="font-semibold mb-4">Funil de conversao</h3>
            <div className="space-y-2">
              {dashboard.pipeline.filter((s: any) => s.type === 'REGULAR' || s.type === 'WON').map((stage, i, arr) => {
                const max = Math.max(...arr.map((x) => x.count));
                const pct = max > 0 ? (stage.count / max) * 100 : 0;
                const prev = i > 0 ? arr[i - 1].count : null;
                const dropRate = prev && prev > 0 ? Math.round(((prev - stage.count) / prev) * 100) : null;
                return (
                  <div key={stage.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium">{stage.name}</span>
                      <span>
                        {stage.count}
                        {dropRate !== null && dropRate > 0 && <span className="ml-2" style={{ color: '#EF4444' }}>-{dropRate}%</span>}
                      </span>
                    </div>
                    <div className="h-8 rounded relative overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: stage.color || '#C8553D' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Indicadores */}
          {conv && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="card p-4">
                <Hourglass size={16} style={{ color: '#8B5CF6' }} />
                <p className="text-2xl font-bold mt-2">{conv.avgConversionDays}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Dias medios para fechar</p>
              </div>
              <div className="card p-4">
                <Target size={16} style={{ color: '#10B981' }} />
                <p className="text-2xl font-bold mt-2">{conv.winRateGlobal}%</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Win-rate global</p>
              </div>
              <div className="card p-4">
                <Users size={16} style={{ color: '#0EA5E9' }} />
                <p className="text-2xl font-bold mt-2">{conv.forecastOpenCount}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Leads abertos com valor</p>
              </div>
              <div className="card p-4">
                <CalIcon size={16} style={{ color: '#EF4444' }} />
                <p className="text-2xl font-bold mt-2">{conv.stagnantLeads.length}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{'Leads parados (>14d)'}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
