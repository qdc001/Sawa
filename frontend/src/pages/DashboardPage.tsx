import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, CheckSquare, Target, ArrowUpRight, ArrowDownRight,
  Clock, ExternalLink, AlertCircle, Activity as ActivityIcon, TrendingUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import api, { DashboardData, RevenueData, Task, Lead, Activity } from '../lib/api';
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
  LEAD_CREATED: 'Lead criado',
  LEAD_UPDATED: 'Lead actualizado',
  LEAD_MOVED: 'Lead movido',
  LEAD_WON: 'Lead ganho',
  LEAD_LOST: 'Lead perdido',
  STAGE_CHANGED: 'Etapa alterada',
  TASK_CREATED: 'Tarefa criada',
  TASK_COMPLETED: 'Tarefa concluida',
  NOTE_ADDED: 'Nota adicionada',
  MESSAGE_SENT: 'Mensagem enviada',
  MESSAGE_RECEIVED: 'Mensagem recebida',
  ASSIGNED: 'Atribuido',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [revenue, setRevenue] = useState<RevenueData[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<Task[]>([]);
  const [topLeads, setTopLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [d, r, t, l] = await Promise.all([
          api.get('/analytics/dashboard'),
          api.get('/analytics/revenue'),
          api.get('/analytics/upcoming-tasks'),
          api.get('/analytics/top-leads'),
        ]);
        setDashboard(d.data);
        setRevenue(Array.isArray(r.data) ? r.data : []);
        setUpcomingTasks(Array.isArray(t.data) ? t.data : []);
        setTopLeads(Array.isArray(l.data) ? l.data : []);
      } catch {
        // silencioso
      } finally { setLoading(false); }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--primary)' }} />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sem dados</p>
      </div>
    );
  }

  const o = dashboard.overview;
  const m = dashboard.monthly;

  const statCards = [
    { label: 'Leads Criados (mes)', value: m.leadsCreated, growth: m.leadsCreatedGrowth, icon: Users, color: '#6366F1', bg: '#EEF2FF' },
    { label: 'Negocios Ganhos (mes)', value: m.leadsWon, growth: m.leadsWonGrowth, icon: Target, color: '#10B981', bg: '#ECFDF5' },
    { label: 'Receita do mes', value: `MZN ${(m.revenue / 1000).toFixed(1)}k`, growth: m.revenueGrowth, icon: DollarSign, color: '#0EA5E9', bg: '#F0F9FF', isString: true },
    { label: 'Tarefas em atraso', value: o.tasksDue, growth: 0, icon: AlertCircle, color: '#F59E0B', bg: '#FFFBEB' },
  ];

  const wonLostData = [
    { name: 'Abertos', value: o.openLeads, color: '#3B82F6' },
    { name: 'Ganhos', value: o.wonLeads, color: '#10B981' },
    { name: 'Perdidos', value: o.lostLeads, color: '#EF4444' },
  ].filter((x) => x.value > 0);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
          {greeting(user?.name)}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Resumo do teu negocio
        </p>
      </div>

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

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <TrendingUp size={16} style={{ color: 'var(--primary)' }} />
            Receita dos ultimos 6 meses
          </h3>
          {revenue.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem dados de receita</p>
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

        {/* Pie won/lost/open */}
        <div className="card p-5">
          <h3 className="font-semibold mb-4" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Estado dos leads</h3>
          {wonLostData.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem leads ainda</p>
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

      {/* Pipeline distribution + top leads */}
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
              Top leads abertos por valor
            </h3>
            <button onClick={() => navigate('/leads')} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>Ver todos</button>
          </div>
          {topLeads.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem leads abertos</p>
          ) : (
            <div className="space-y-2">
              {topLeads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => navigate(`/pipeline?leadId=${lead.id}`)}
                  className="w-full flex items-center justify-between p-2 rounded hover:bg-slate-50 text-left"
                >
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
                    <ExternalLink size={12} style={{ color: 'var(--text-muted)' }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tarefas + Actividades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              <Clock size={16} style={{ color: 'var(--primary)' }} />
              Proximas tarefas
            </h3>
            <button onClick={() => navigate('/tasks')} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>Ver todas</button>
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
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem actividades ainda</p>
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
