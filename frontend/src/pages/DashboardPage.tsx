import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, CheckSquare, Target, ArrowUpRight, ArrowDownRight,
  Clock, ExternalLink, AlertCircle, Activity as ActivityIcon, TrendingUp,
  Plus, Filter as FilterIcon, Printer, Trophy, Zap, Hourglass, Briefcase,
  AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts';
import api, {
  DashboardData, RevenueData, Task, Lead, Activity, User, Pipeline,
  TeamMemberStats, LeadSourceStat, ConversionStats,
} from '../lib/api';
import { useAuthStore } from '../store';

function greeting(name?: string) {
  const h = new Date().getHours();
  const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return name ? `${g}, ${name.split(' ')[0]}` : g;
}

function timeAgo(date: string): string {
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)} min atras`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atras`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d atras`;
  return d.toLocaleDateString('pt-PT');
}

const ACTIVITY_LABELS: Record<string, string> = {
  LEAD_CREATED: 'Lead criado', LEAD_UPDATED: 'Lead actualizado', LEAD_MOVED: 'Lead movido',
  LEAD_WON: 'Lead ganho', LEAD_LOST: 'Lead perdido', STAGE_CHANGED: 'Etapa alterada',
  TASK_CREATED: 'Tarefa criada', TASK_COMPLETED: 'Tarefa concluida',
  NOTE_ADDED: 'Nota adicionada', MESSAGE_SENT: 'Mensagem enviada',
  MESSAGE_RECEIVED: 'Mensagem recebida', ASSIGNED: 'Atribuido',
};

type Period = 'today' | '7d' | '30d' | '3m' | '6m' | '1y' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje', '7d': '7 dias', '30d': '30 dias', '3m': '3 meses',
  '6m': '6 meses', '1y': '1 ano', custom: 'Personalizado',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Filtros
  const [period, setPeriod] = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Dados
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [revenue, setRevenue] = useState<RevenueData[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<Task[]>([]);
  const [topLeads, setTopLeads] = useState<Lead[]>([]);
  const [team, setTeam] = useState<TeamMemberStats[]>([]);
  const [sources, setSources] = useState<LeadSourceStat[]>([]);
  const [convStats, setConvStats] = useState<ConversionStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Carregar listas auxiliares uma vez
  useEffect(() => {
    api.get('/pipelines').then(({ data }) => setPipelines(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  // Carregar dados quando filtros mudam
  useEffect(() => {
    const params = new URLSearchParams();
    if (period === 'custom') {
      if (customFrom) params.set('from', new Date(customFrom).toISOString());
      if (customTo) params.set('to', new Date(customTo).toISOString());
    } else {
      params.set('period', period);
    }
    if (pipelineId) params.set('pipelineId', pipelineId);
    if (assignedToId) params.set('assignedToId', assignedToId);
    const q = `?${params.toString()}`;

    setLoading(true);
    Promise.all([
      api.get(`/analytics/dashboard${q}`),
      api.get(`/analytics/revenue${q}`),
      api.get(`/analytics/upcoming-tasks${q}`),
      api.get(`/analytics/top-leads${q}`),
      api.get(`/analytics/team-performance${q}`),
      api.get(`/analytics/lead-sources${q}`),
      api.get(`/analytics/conversion-stats${q}`),
    ])
      .then(([d, r, t, l, tm, s, c]) => {
        setDashboard(d.data);
        setRevenue(Array.isArray(r.data) ? r.data : []);
        setUpcomingTasks(Array.isArray(t.data) ? t.data : []);
        setTopLeads(Array.isArray(l.data) ? l.data : []);
        setTeam(Array.isArray(tm.data) ? tm.data : []);
        setSources(Array.isArray(s.data) ? s.data : []);
        setConvStats(c.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo, pipelineId, assignedToId]);

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--primary)' }} />
      </div>
    );
  }

  if (!dashboard) {
    return <div className="flex items-center justify-center h-full"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sem dados</p></div>;
  }

  const o = dashboard.overview;
  const m = dashboard.monthly;

  const statCards = [
    { label: 'Leads Criados', value: m.leadsCreated, growth: m.leadsCreatedGrowth, icon: Users, color: '#6366F1', bg: '#EEF2FF' },
    { label: 'Negocios Ganhos', value: m.leadsWon, growth: m.leadsWonGrowth, icon: Target, color: '#10B981', bg: '#ECFDF5' },
    { label: 'Receita', value: `MZN ${(m.revenue / 1000).toFixed(1)}k`, growth: m.revenueGrowth, icon: DollarSign, color: '#0EA5E9', bg: '#F0F9FF', isString: true },
    { label: 'Tarefas em atraso', value: o.tasksDue, growth: 0, icon: AlertCircle, color: '#F59E0B', bg: '#FFFBEB' },
  ];

  const wonLostData = [
    { name: 'Abertos', value: o.openLeads, color: '#3B82F6' },
    { name: 'Ganhos', value: o.wonLeads, color: '#10B981' },
    { name: 'Perdidos', value: o.lostLeads, color: '#EF4444' },
  ].filter((x) => x.value > 0);

  // Funil: usar etapas tipo REGULAR ordenadas + WON no fim
  const funnelData = [
    ...dashboard.pipeline
      .filter((s: any) => s.type === 'REGULAR')
      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      .map((s) => ({ name: s.name, value: s.count, fill: s.color })),
  ];
  const wonStage = dashboard.pipeline.find((s: any) => s.type === 'WON');
  if (wonStage) funnelData.push({ name: wonStage.name, value: wonStage.count, fill: wonStage.color });

  return (
    <div className="p-6 space-y-6 animate-fade-in print:p-2">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 print:gap-1">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            {greeting(user?.name)}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {PERIOD_LABELS[period]}
            {pipelineId && ` · ${pipelines.find((p) => p.id === pipelineId)?.name}`}
            {assignedToId && ` · ${users.find((u) => u.id === assignedToId)?.name}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap print:hidden">
          <button onClick={() => navigate('/leads')} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Plus size={14} /> Lead
          </button>
          <button onClick={() => navigate('/contacts')} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Plus size={14} /> Contacto
          </button>
          <button onClick={() => navigate('/tasks')} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Plus size={14} /> Tarefa
          </button>
          <button onClick={() => window.print()} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Imprimir / Exportar PDF">
            <Printer size={14} /> Exportar
          </button>
          <button onClick={() => setShowFilters(!showFilters)} className="btn py-2 px-3"
            style={{ background: showFilters ? 'var(--primary)' : 'var(--surface-3)', color: showFilters ? '#fff' : 'var(--text-primary)' }}>
            <FilterIcon size={14} /> Filtros
          </button>
        </div>
      </div>

      {/* Selector de periodo */}
      <div className="flex flex-wrap items-center gap-1 print:hidden">
        {(Object.keys(PERIOD_LABELS) as Period[]).filter((p) => p !== 'custom').map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className="text-xs px-2 py-1 rounded font-medium"
            style={{ background: period === p ? 'var(--primary)' : 'var(--surface-3)', color: period === p ? '#fff' : 'var(--text-secondary)' }}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
        <button onClick={() => setPeriod('custom')} className="text-xs px-2 py-1 rounded font-medium"
          style={{ background: period === 'custom' ? 'var(--primary)' : 'var(--surface-3)', color: period === 'custom' ? '#fff' : 'var(--text-secondary)' }}>
          Personalizado
        </button>
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input-base" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>a</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input-base" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} />
          </>
        )}
      </div>

      {/* Filtros */}
      {showFilters && (
        <div className="card p-4 flex flex-wrap items-center gap-3 print:hidden">
          <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos os pipelines</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Toda a equipa</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {(pipelineId || assignedToId) && (
            <button onClick={() => { setPipelineId(''); setAssignedToId(''); }} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          const isPositive = card.growth >= 0;
          return (
            <div key={card.label} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: card.bg }}>
                  <Icon size={20} style={{ color: card.color }} />
                </div>
                {card.growth !== 0 && (
                  <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
                    style={{ background: isPositive ? '#ECFDF5' : '#FEF2F2', color: isPositive ? '#10B981' : '#EF4444' }}>
                    {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {Math.abs(card.growth)}%
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', color: 'var(--text-primary)' }}>
                {card.isString ? card.value : card.value.toLocaleString()}
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
            </div>
          );
        })}
      </div>

      {/* Indicadores de conversao + forecast */}
      {convStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Hourglass size={16} style={{ color: '#8B5CF6' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Tempo medio para fechar</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {convStats.avgConversionDays} <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>dias</span>
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} style={{ color: '#10B981' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Forecast (proj.)</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              MZN {(convStats.forecastValue / 1000).toFixed(1)}k
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              de {(convStats.forecastBaseValue / 1000).toFixed(0)}k abertos · {convStats.winRateGlobal}% win-rate
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Briefcase size={16} style={{ color: '#0EA5E9' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Leads abertos com valor</span>
            </div>
            <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{convStats.forecastOpenCount}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} style={{ color: '#EF4444' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Leads parados (>14d)</span>
            </div>
            <p className="text-xl font-bold" style={{ color: convStats.stagnantLeads.length > 0 ? '#EF4444' : 'var(--text-primary)' }}>
              {convStats.stagnantLeads.length}
            </p>
          </div>
        </div>
      )}

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <TrendingUp size={16} style={{ color: 'var(--primary)' }} />
            Receita dos ultimos 6 meses
          </h3>
          {revenue.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenue} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => [`MZN ${Number(v).toLocaleString()}`, 'Receita']} contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13 }} />
                <Bar dataKey="revenue" fill="#6366F1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Estado dos leads</h3>
          {wonLostData.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem leads</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={wonLostData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                  {wonLostData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Funil + Origens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Funil de conversao</h3>
          {funnelData.length === 0 || funnelData.every((f) => f.value === 0) ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
          ) : (
            <div className="space-y-2">
              {funnelData.map((f, i) => {
                const max = Math.max(...funnelData.map((x) => x.value));
                const pct = max > 0 ? (f.value / max) * 100 : 0;
                const prev = i > 0 ? funnelData[i - 1].value : null;
                const dropRate = prev && prev > 0 ? Math.round(((prev - f.value) / prev) * 100) : null;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{f.name}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {f.value} {dropRate !== null && dropRate > 0 && (
                          <span className="ml-2" style={{ color: '#EF4444' }}>-{dropRate}%</span>
                        )}
                      </span>
                    </div>
                    <div className="h-6 rounded relative overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: f.fill }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Origem dos leads</h3>
          {sources.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados de origem</p>
          ) : (
            <div className="space-y-2">
              {sources.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-2 rounded" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.source}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {s.total} leads · {s.won} ganhos · MZN {Number(s.revenue).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded font-medium ml-2"
                    style={{ background: s.winRate >= 30 ? '#D1FAE5' : '#FEF3C7', color: s.winRate >= 30 ? '#065F46' : '#92400E' }}>
                    {s.winRate}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Performance da equipa */}
      <div className="card p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          <Trophy size={16} style={{ color: '#F59E0B' }} />
          Performance da equipa
        </h3>
        {team.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Membro</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Criados</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Ganhos</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Win-rate</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Receita</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Em aberto</th>
                  <th className="text-right py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Tarefas</th>
                </tr>
              </thead>
              <tbody>
                {team.map((m, i) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {i === 0 && team.length > 1 && <Trophy size={14} style={{ color: '#F59E0B' }} />}
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                          {m.name?.[0]?.toUpperCase()}
                        </div>
                        <span style={{ color: 'var(--text-primary)' }}>{m.name}</span>
                      </div>
                    </td>
                    <td className="text-right py-2" style={{ color: 'var(--text-secondary)' }}>{m.created}</td>
                    <td className="text-right py-2 font-medium" style={{ color: '#10B981' }}>{m.won}</td>
                    <td className="text-right py-2">
                      <span className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{ background: m.winRate >= 50 ? '#D1FAE5' : m.winRate >= 25 ? '#FEF3C7' : '#FEE2E2', color: m.winRate >= 50 ? '#065F46' : m.winRate >= 25 ? '#92400E' : '#991B1B' }}>
                        {m.winRate}%
                      </span>
                    </td>
                    <td className="text-right py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                      MZN {(m.revenue / 1000).toFixed(0)}k
                    </td>
                    <td className="text-right py-2" style={{ color: 'var(--text-secondary)' }}>
                      {m.openCount} <span className="text-xs">({(m.openValue / 1000).toFixed(0)}k)</span>
                    </td>
                    <td className="text-right py-2" style={{ color: m.tasksOpen > 5 ? '#F59E0B' : 'var(--text-secondary)' }}>{m.tasksOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pipeline + top leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Distribuicao no Pipeline</h3>
          {dashboard.pipeline.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem etapas</p>
          ) : (
            <div className="space-y-3">
              {dashboard.pipeline.map((stage) => {
                const total = dashboard.pipeline.reduce((a, b) => a + b.count, 0);
                const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0;
                return (
                  <div key={stage.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--text-secondary)' }}>{stage.name}</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{stage.count}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: stage.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              <DollarSign size={16} style={{ color: 'var(--primary)' }} />
              Top leads abertos
            </h3>
            <button onClick={() => navigate('/leads')} className="text-xs hover:underline print:hidden" style={{ color: 'var(--primary)' }}>Ver todos</button>
          </div>
          {topLeads.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem leads abertos</p>
          ) : (
            <div className="space-y-2">
              {topLeads.map((lead) => (
                <button key={lead.id} onClick={() => navigate(`/pipeline?leadId=${lead.id}`)}
                  className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-50 text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{lead.title}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {lead.pipeline?.name} · {lead.stage?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold" style={{ color: '#10B981' }}>
                      MZN {Number(lead.value || 0).toLocaleString()}
                    </span>
                    <ExternalLink size={12} style={{ color: 'var(--text-muted)' }} className="print:hidden" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leads parados */}
      {convStats && convStats.stagnantLeads.length > 0 && (
        <div className="card p-5" style={{ borderLeft: '4px solid #EF4444' }}>
          <h3 className="font-semibold mb-3 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#991B1B' }}>
            <AlertTriangle size={16} /> Leads parados (sem actividade ha mais de 14 dias)
          </h3>
          <div className="space-y-2">
            {convStats.stagnantLeads.map((lead: any) => (
              <button key={lead.id} onClick={() => navigate(`/pipeline?leadId=${lead.id}`)}
                className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-50 text-left">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{lead.title}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {lead.pipeline?.name} · {lead.stage?.name} · ultima alteracao {timeAgo(lead.updatedAt)}
                  </p>
                </div>
                <ExternalLink size={12} style={{ color: 'var(--text-muted)' }} className="print:hidden" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tarefas + Actividades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              <Clock size={16} style={{ color: 'var(--primary)' }} />
              Proximas tarefas
            </h3>
            <button onClick={() => navigate('/tasks')} className="text-xs hover:underline print:hidden" style={{ color: 'var(--primary)' }}>Ver todas</button>
          </div>
          {upcomingTasks.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem tarefas pendentes</p>
          ) : (
            <div className="space-y-2">
              {upcomingTasks.map((t) => {
                const overdue = t.dueAt && new Date(t.dueAt) < new Date();
                return (
                  <div key={t.id} className="flex items-start gap-2 p-2 rounded" style={{ background: overdue ? '#FEF2F2' : 'var(--surface-2)' }}>
                    <CheckSquare size={14} className="mt-0.5 flex-shrink-0" style={{ color: overdue ? '#EF4444' : 'var(--text-muted)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                      <p className="text-xs" style={{ color: overdue ? '#991B1B' : 'var(--text-muted)' }}>
                        {t.dueAt ? new Date(t.dueAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem data'}
                        {t.lead && ` · ${t.lead.title}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <ActivityIcon size={16} style={{ color: 'var(--primary)' }} />
            Actividades recentes
          </h3>
          {(!dashboard.recentActivities || dashboard.recentActivities.length === 0) ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem actividades</p>
          ) : (
            <div className="space-y-2">
              {dashboard.recentActivities.slice(0, 6).map((a: Activity) => (
                <div key={a.id} className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: 'var(--primary)' }}>
                    {a.user?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      <strong>{a.user?.name || 'Sistema'}</strong>{' · '}
                      <span style={{ color: 'var(--text-secondary)' }}>{ACTIVITY_LABELS[a.type] || a.type}</span>
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                      {a.description} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Leads', value: o.totalLeads, color: '#6366F1' },
          { label: 'Leads Abertos', value: o.openLeads, color: '#0EA5E9' },
          { label: 'Leads Ganhos', value: o.wonLeads, color: '#10B981' },
          { label: 'Leads Perdidos', value: o.lostLeads, color: '#EF4444' },
          { label: 'Contactos', value: o.totalContacts, color: '#8B5CF6' },
          { label: 'Conversao', value: `${o.conversionRate}%`, color: '#F59E0B', isString: true },
        ].map((item) => (
          <div key={item.label} className="card p-4 text-center">
            <p className="text-xl font-bold" style={{ color: item.color, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {item.isString ? item.value : item.value.toLocaleString()}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
