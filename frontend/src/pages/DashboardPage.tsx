import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import {
  Users, DollarSign, CheckSquare, Target, ArrowUpRight, ArrowDownRight,
  Clock, ExternalLink, AlertCircle, Activity as ActivityIcon, TrendingUp,
  Plus, Filter as FilterIcon, Printer, Trophy, Zap, Hourglass, Briefcase,
  AlertTriangle, X, Trash2, LayoutGrid, Eye, EyeOff, Flag, CalendarDays,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts';
import api, {
  DashboardData, RevenueData, Task, Lead, Activity, User, Pipeline,
  TeamMemberStats, LeadSourceStat, ConversionStats, GoalProgress, GoalType, HeatmapDay,
} from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

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

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  leads_created: 'Leads criados',
  leads_won: 'Negocios ganhos',
  revenue: 'Receita (MZN)',
  tasks_completed: 'Tarefas concluidas',
};

const GOAL_TYPE_COLORS: Record<GoalType, string> = {
  leads_created: '#6366F1',
  leads_won: '#10B981',
  revenue: '#0EA5E9',
  tasks_completed: '#F59E0B',
};

// =============== Modal: Gerir Metas ===============
function GoalsModal({ month, year, onClose, onChanged }: {
  month: number; year: number;
  onClose: () => void; onChanged: () => void;
}) {
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [newType, setNewType] = useState<GoalType>('leads_won');
  const [newTarget, setNewTarget] = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/goals/progress?month=${month}&year=${year}&userId=workspace`)
      .then(({ data }) => setGoals(Array.isArray(data) ? data : []))
      .catch(() => setGoals([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [month, year]);

  const handleAdd = async () => {
    if (!newTarget) { toast.error('Indica o alvo'); return; }
    try {
      await api.post('/goals', {
        type: newType, target: Number(newTarget),
        month, year, userId: null,
      });
      setNewTarget('');
      load();
      onChanged();
      toast.success('Meta guardada');
    } catch { toast.error('Erro'); }
  };

  const handleUpdate = async (id: string, target: number) => {
    try {
      await api.patch(`/goals/${id}`, { target });
      onChanged();
    } catch { toast.error('Erro'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminar esta meta?')) return;
    try {
      await api.delete(`/goals/${id}`);
      setGoals((p) => p.filter((g) => g.id !== id));
      onChanged();
      toast.success('Eliminada');
    } catch { toast.error('Erro'); }
  };

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold capitalize" style={{ color: 'var(--text-primary)' }}>
            Metas de {monthName}
          </h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        {loading ? (
          <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>A carregar...</p>
        ) : goals.length === 0 ? (
          <p className="text-center py-4 text-sm" style={{ color: 'var(--text-muted)' }}>Sem metas ainda</p>
        ) : (
          <div className="space-y-3 mb-4">
            {goals.map((g) => (
              <div key={g.id} className="p-3 rounded" style={{ background: 'var(--surface-2)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{GOAL_TYPE_LABELS[g.type]}</span>
                  <button onClick={() => handleDelete(g.id)} className="p-1 rounded hover:bg-red-50">
                    <Trash2 size={14} style={{ color: '#EF4444' }} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="number"
                    defaultValue={g.target}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== g.target) handleUpdate(g.id, v);
                    }}
                    className="input-base"
                  />
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{g.current.toLocaleString()} / {g.target.toLocaleString()}</span>
                  <span style={{ color: GOAL_TYPE_COLORS[g.type], fontWeight: 600 }}>{g.percent}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${g.percent}%`, background: GOAL_TYPE_COLORS[g.type] }} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4 mb-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Nova meta</p>
          <select value={newType} onChange={(e) => setNewType(e.target.value as GoalType)} className="input-base">
            {Object.entries(GOAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="Alvo (ex: 10)" className="input-base" />
          <button onClick={handleAdd} className="btn btn-primary w-full py-2">
            <Plus size={14} /> Adicionar / actualizar
          </button>
        </div>

        <button onClick={onClose} className="btn w-full py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
      </div>
    </div>
  );
}

// =============== Modal: Personalizar widgets ===============
const ALL_WIDGETS = [
  { id: 'goals', label: 'Metas mensais' },
  { id: 'kpis', label: 'KPIs principais' },
  { id: 'conversion', label: 'Indicadores de conversao' },
  { id: 'revenueChart', label: 'Grafico de receita 6m' },
  { id: 'wonLostPie', label: 'Estado dos leads (pizza)' },
  { id: 'funnel', label: 'Funil de conversao' },
  { id: 'sources', label: 'Origem dos leads' },
  { id: 'team', label: 'Performance da equipa' },
  { id: 'pipelineDist', label: 'Distribuicao no Pipeline' },
  { id: 'topLeads', label: 'Top leads abertos' },
  { id: 'stagnant', label: 'Leads parados' },
  { id: 'tasks', label: 'Proximas tarefas' },
  { id: 'activities', label: 'Actividades recentes' },
  { id: 'heatmap', label: 'Mapa de actividade' },
  { id: 'overview', label: 'Cards de resumo' },
];

const HIDDEN_KEY = 'kommo:dashboard-hidden';
const ORDER_KEY = 'kommo:dashboard-order';

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      // Garantir que todos os widgets actuais estao listados (em caso de novos)
      const current = new Set(arr);
      ALL_WIDGETS.forEach((w) => { if (!current.has(w.id)) arr.push(w.id); });
      // Remover ids invalidos
      const valid = new Set(ALL_WIDGETS.map((w) => w.id));
      return arr.filter((id: string) => valid.has(id));
    }
  } catch {}
  return ALL_WIDGETS.map((w) => w.id);
}

function SortableWidgetRow({ id, label, hidden, onToggle }: {
  id: string; label: string; hidden: boolean; onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}
      className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1" title="Arrastar para reordenar">
        <GripVertical size={14} style={{ color: 'var(--text-muted)' }} />
      </button>
      <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
      <button onClick={onToggle} className="p-1 rounded hover:bg-slate-100" title={hidden ? 'Mostrar' : 'Esconder'}>
        {!hidden ? <Eye size={14} style={{ color: 'var(--primary)' }} /> : <EyeOff size={14} style={{ color: 'var(--text-muted)' }} />}
      </button>
    </div>
  );
}

function CustomizeModal({ hidden, onChange, order, onOrderChange, onClose, onReset }: {
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  order: string[];
  onOrderChange: (next: string[]) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = order.indexOf(e.active.id as string);
    const newIdx = order.indexOf(e.over.id as string);
    if (oldIdx >= 0 && newIdx >= 0) onOrderChange(arrayMove(order, oldIdx, newIdx));
  };

  const widgetMap: Record<string, string> = {};
  ALL_WIDGETS.forEach((w) => { widgetMap[w.id] = w.label; });

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Personalizar dashboard</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Arrasta o icone <GripVertical size={11} className="inline" /> para reordenar. Clica no olho para mostrar/esconder.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {order.map((id) => (
                <SortableWidgetRow
                  key={id}
                  id={id}
                  label={widgetMap[id] || id}
                  hidden={hidden.has(id)}
                  onToggle={() => toggle(id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div className="flex gap-2 mt-4">
          <button onClick={onReset} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            Repor padrao
          </button>
          <button onClick={onClose} className="btn btn-primary flex-1 py-2">Fechar</button>
        </div>
      </div>
    </div>
  );
}

// =============== Componente Heatmap ===============
function HeatmapView({ data }: { data: HeatmapDay[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem actividade ainda</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const colorFor = (c: number) => {
    if (c === 0) return 'var(--surface-3)';
    const intensity = c / max;
    if (intensity < 0.25) return '#C7D2FE';
    if (intensity < 0.5) return '#A5B4FC';
    if (intensity < 0.75) return '#818CF8';
    return '#6366F1';
  };

  // Reorganizar por semanas: cada coluna e uma semana, 7 linhas (dom-sab)
  // Comecar pela primeira semana
  const weeks: HeatmapDay[][] = [];
  let currentWeek: HeatmapDay[] = [];
  data.forEach((d) => {
    const day = new Date(d.date).getDay(); // 0 = dom
    if (currentWeek.length === 0 && day !== 1) {
      // preencher inicio da semana com nulos para alinhar (semana comeca na segunda)
      const offset = (day + 6) % 7; // 0 = seg, ...6 = dom
      for (let i = 0; i < offset; i++) currentWeek.push({ date: '', count: -1 });
    }
    currentWeek.push(d);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-0.5 overflow-x-auto pb-2">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {week.map((d, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-sm"
                style={{ background: d.count < 0 ? 'transparent' : colorFor(d.count) }}
                title={d.count >= 0 ? `${d.date}: ${d.count} actividades` : ''}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span>Menos</span>
        <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--surface-3)' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: '#C7D2FE' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: '#A5B4FC' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: '#818CF8' }} />
        <div className="w-3 h-3 rounded-sm" style={{ background: '#6366F1' }} />
        <span>Mais</span>
      </div>
    </div>
  );
}

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
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [loading, setLoading] = useState(true);

  // Personalizacao
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  useEffect(() => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(hidden)));
  }, [hidden]);
  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }, [order]);
  const resetCustomization = () => {
    setHidden(new Set());
    setOrder(ALL_WIDGETS.map((w) => w.id));
  };
  const visible = (id: string) => !hidden.has(id);

  const now = new Date();
  const goalMonth = now.getMonth() + 1;
  const goalYear = now.getFullYear();

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
      api.get(`/analytics/activity-heatmap?days=90`),
      api.get(`/goals/progress?month=${goalMonth}&year=${goalYear}&userId=workspace`),
    ])
      .then(([d, r, t, l, tm, s, c, hm, g]) => {
        setDashboard(d.data);
        setRevenue(Array.isArray(r.data) ? r.data : []);
        setUpcomingTasks(Array.isArray(t.data) ? t.data : []);
        setTopLeads(Array.isArray(l.data) ? l.data : []);
        setTeam(Array.isArray(tm.data) ? tm.data : []);
        setSources(Array.isArray(s.data) ? s.data : []);
        setConvStats(c.data);
        setHeatmap(Array.isArray(hm.data) ? hm.data : []);
        setGoals(Array.isArray(g.data) ? g.data : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, customFrom, customTo, pipelineId, assignedToId]);

  const reloadGoals = () => {
    api.get(`/goals/progress?month=${goalMonth}&year=${goalYear}&userId=workspace`)
      .then(({ data }) => setGoals(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

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
    <div className="p-6 print:p-2" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ order: -100 }} className="flex items-start justify-between flex-wrap gap-3 print:gap-1">
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
          <button onClick={() => setShowCustomize(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Personalizar widgets">
            <LayoutGrid size={14} /> Personalizar
          </button>
        </div>
      </div>

      {/* Selector de periodo */}
      <div style={{ order: -99 }} className="flex flex-wrap items-center gap-1 print:hidden">
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
        <div style={{ order: -98 }} className="card p-4 flex flex-wrap items-center gap-3 print:hidden">
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

      {/* Goals / Metas */}
      {visible('goals') && (
        <div style={{ order: order.indexOf('goals') }} className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              <Flag size={16} style={{ color: '#F59E0B' }} />
              Metas do mes
              <span className="text-xs font-normal capitalize" style={{ color: 'var(--text-muted)' }}>
                ({new Date(goalYear, goalMonth - 1, 1).toLocaleDateString('pt-PT', { month: 'long' })})
              </span>
            </h3>
            <button type="button" onClick={() => setShowGoalsModal(true)} className="btn py-1.5 px-3 print:hidden" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              <Flag size={12} /> Gerir metas
            </button>
          </div>
          {goals.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
              Sem metas definidas. <button type="button" onClick={() => setShowGoalsModal(true)} className="hover:underline print:hidden" style={{ color: 'var(--primary)' }}>Definir metas</button>
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {goals.map((g) => (
                <div key={g.id} className="p-3 rounded" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{GOAL_TYPE_LABELS[g.type]}</p>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {g.current.toLocaleString()}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      / {g.target.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'var(--surface-3)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${g.percent}%`, background: GOAL_TYPE_COLORS[g.type] }} />
                  </div>
                  <p className="text-xs text-right font-medium" style={{ color: GOAL_TYPE_COLORS[g.type] }}>{g.percent}%</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      {visible('kpis') && (
      <div style={{ order: order.indexOf('kpis') }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      )}

      {/* Indicadores de conversao + forecast */}
      {visible('conversion') && convStats && (
        <div style={{ order: order.indexOf('conversion') }} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{'Leads parados (>14d)'}</span>
            </div>
            <p className="text-xl font-bold" style={{ color: convStats.stagnantLeads.length > 0 ? '#EF4444' : 'var(--text-primary)' }}>
              {convStats.stagnantLeads.length}
            </p>
          </div>
        </div>
      )}

      {/* Receita */}
      {visible('revenueChart') && (
        <div style={{ order: order.indexOf('revenueChart') }} className="card p-5">
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
      )}

      {/* Estado leads (pizza) */}
      {visible('wonLostPie') && (
        <div style={{ order: order.indexOf('wonLostPie') }} className="card p-5">
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
      )}

      {/* Funil */}
      {visible('funnel') && (
        <div style={{ order: order.indexOf('funnel') }} className="card p-5">
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
      )}

      {/* Origem leads */}
      {visible('sources') && (
        <div style={{ order: order.indexOf('sources') }} className="card p-5">
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
      )}

      {/* Performance da equipa */}
      {visible('team') && (
      <div style={{ order: order.indexOf('team') }} className="card p-5">
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
      )}

      {/* Heatmap */}
      {visible('heatmap') && (
        <div style={{ order: order.indexOf('heatmap') }} className="card p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
            <CalendarDays size={16} style={{ color: 'var(--primary)' }} />
            Mapa de actividade (ultimos 90 dias)
          </h3>
          <HeatmapView data={heatmap} />
        </div>
      )}

      {/* Distribuicao no Pipeline */}
      {visible('pipelineDist') && (
        <div style={{ order: order.indexOf('pipelineDist') }} className="card p-5">
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
      )}

      {/* Top leads */}
      {visible('topLeads') && (
        <div style={{ order: order.indexOf('topLeads') }} className="card p-5">
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
      )}

      {/* Leads parados */}
      {visible('stagnant') && convStats && convStats.stagnantLeads.length > 0 && (
        <div className="card p-5" style={{ order: order.indexOf('stagnant'), borderLeft: '4px solid #EF4444' }}>
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

      {/* Proximas tarefas */}
      {visible('tasks') && (
        <div style={{ order: order.indexOf('tasks') }} className="card p-5">
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
      )}

      {/* Actividades */}
      {visible('activities') && (
        <div style={{ order: order.indexOf('activities') }} className="card p-5">
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
      )}

      {/* Overview cards */}
      {visible('overview') && (
      <div style={{ order: order.indexOf('overview') }} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
      )}

      {showCustomize && (
        <CustomizeModal
          hidden={hidden}
          onChange={setHidden}
          order={order}
          onOrderChange={setOrder}
          onClose={() => setShowCustomize(false)}
          onReset={resetCustomization}
        />
      )}
      {showGoalsModal && <GoalsModal month={goalMonth} year={goalYear} onClose={() => setShowGoalsModal(false)} onChanged={reloadGoals} />}
    </div>
  );
}
