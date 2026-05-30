import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, ExternalLink,
  ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown,
  Filter as FilterIcon, RotateCcw, RefreshCw,
} from 'lucide-react';
import api, { Lead, Pipeline, User } from '../lib/api';
import { LeadScoreBadge } from '../lib/leadScore';
import toast from 'react-hot-toast';
import { LeadDetailModal } from './PipelinePage';
import { useUIStore } from '../store';

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#94A3B8',
  MEDIUM: '#3B82F6',
  HIGH: '#F59E0B',
  URGENT: '#EF4444',
};
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  WON: 'Ganho',
  LOST: 'Perdido',
};
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: '#DBEAFE', fg: '#1E40AF' },
  WON: { bg: '#D1FAE5', fg: '#065F46' },
  LOST: { bg: '#FEE2E2', fg: '#991B1B' },
};

type SortKey = 'createdAt' | 'title' | 'value' | 'updatedAt';
type SortDir = 'asc' | 'desc';

// ====== Modal: Novo Lead com selector de pipeline+etapa ======
function AddLeadFromListModal({
  pipelines,
  users,
  onClose,
  onCreated,
}: {
  pipelines: Pipeline[];
  users: User[];
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}) {
  const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
  const [pipelineId, setPipelineId] = useState<string>(defaultPipeline?.id || '');
  const activePipeline = pipelines.find((p) => p.id === pipelineId);
  const [stageId, setStageId] = useState<string>(activePipeline?.stages?.[0]?.id || '');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [assignedToId, setAssignedToId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activePipeline?.stages?.[0]?.id) {
      setStageId(activePipeline.stages[0].id);
    }
  }, [pipelineId]); // eslint-disable-line

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !pipelineId || !stageId) {
      toast.error('Preenche titulo, pipeline e etapa');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/leads', {
        title,
        value: value ? Number(value) : undefined,
        priority,
        pipelineId,
        stageId,
        assignedToId: assignedToId || undefined,
      });
      toast.success('Lead criado');
      onCreated(data);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao criar lead');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Novo Lead</h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Titulo *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Venda de software para Empresa X"
              className="input-base"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Pipeline *</label>
              <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="input-base" required>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Etapa *</label>
              <select value={stageId} onChange={(e) => setStageId(e.target.value)} className="input-base" required>
                {activePipeline?.stages?.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Valor (MZN)</label>
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" className="input-base" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Prioridade</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-base">
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Responsavel</label>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base">
              <option value="">— Sem atribuir —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Criar Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ====== Pagina principal ======
export default function LeadsPage() {
  const navigate = useNavigate();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();

  // Filtros
  const [search, setSearch] = useState(globalSearchQuery || '');
  const [pipelineId, setPipelineId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [priority, setPriority] = useState<string>('');
  const [assignedToId, setAssignedToId] = useState<string>('');

  // Ordenacao
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Paginacao
  const [page, setPage] = useState(1);
  const limit = 20;
  const [total, setTotal] = useState(0);

  // Dados
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Modais
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);

  // Multi-selecção
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Sincronizar pesquisa com store global
  useEffect(() => {
    setSearch(globalSearchQuery || '');
  }, [globalSearchQuery]);

  // Carregar pipelines e users (independentes para uma falha nao impedir a outra)
  useEffect(() => {
    api.get('/pipelines')
      .then(({ data }) => setPipelines(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('pipelines error:', err);
        toast.error('Erro a carregar pipelines');
      });

    api.get('/users')
      .then(({ data }) => setUsers(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error('users error:', err);
        toast.error('Erro a carregar utilizadores');
      });
  }, []);

  const activePipeline = pipelines.find((p) => p.id === pipelineId);

  // Quando muda pipeline, reset etapa
  useEffect(() => {
    setStageId('');
  }, [pipelineId]);

  // Reset pagina quando muda filtros
  useEffect(() => {
    setPage(1);
  }, [search, pipelineId, stageId, status, priority, assignedToId]);

  // Carregar leads
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search.trim()) params.set('search', search.trim());
    if (pipelineId) params.set('pipelineId', pipelineId);
    if (stageId) params.set('stageId', stageId);
    if (status) params.set('status', status);
    if (assignedToId) params.set('assignedToId', assignedToId);

    setLoading(true);
    api.get(`/leads?${params.toString()}`)
      .then(({ data }) => {
        let list: Lead[] = data.leads || [];
        // Prioridade: filtragem cliente (backend nao suporta)
        if (priority) list = list.filter((l) => l.priority === priority);
        setLeads(list);
        setTotal(data.total || 0);
      })
      .catch(() => toast.error('Erro a carregar leads'))
      .finally(() => setLoading(false));
  }, [page, search, pipelineId, stageId, status, priority, assignedToId]);

  const sortedLeads = useMemo(() => {
    const arr = [...leads];
    arr.sort((a: any, b: any) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'value') {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      } else if (sortKey === 'createdAt' || sortKey === 'updatedAt') {
        av = new Date(av || 0).getTime();
        bv = new Date(bv || 0).getTime();
      } else {
        av = String(av || '').toLowerCase();
        bv = String(bv || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [leads, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={12} />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const resetFilters = () => {
    setSearch('');
    setGlobalSearchQuery('');
    setPipelineId('');
    setStageId('');
    setStatus('');
    setPriority('');
    setAssignedToId('');
  };

  const [syncing, setSyncing] = useState(false);
  const handleSyncStatuses = async () => {
    if (!confirm('Sincronizar o estado de todos os leads com a etapa em que estao? (Aberto/Ganho/Perdido)')) return;
    setSyncing(true);
    try {
      const { data } = await api.post('/leads/sync-statuses');
      toast.success(data.message || 'Sincronizado');
      // Recarrega a lista
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search.trim()) params.set('search', search.trim());
      if (pipelineId) params.set('pipelineId', pipelineId);
      if (stageId) params.set('stageId', stageId);
      if (status) params.set('status', status);
      if (assignedToId) params.set('assignedToId', assignedToId);
      const { data: refreshed } = await api.get(`/leads?${params.toString()}`);
      let list: Lead[] = refreshed.leads || [];
      if (priority) list = list.filter((l) => l.priority === priority);
      setLeads(list);
      setTotal(refreshed.total || 0);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao sincronizar');
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (lead: Lead) => {
    if (!confirm(`Eliminar o lead "${lead.title}"?`)) return;
    try {
      await api.delete(`/leads/${lead.id}`);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success('Lead eliminado');
    } catch {
      toast.error('Erro a eliminar');
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Eliminar ${ids.length} leads seleccionados? Esta acção não pode ser desfeita.`)) return;
    try {
      await Promise.all(ids.map((id) => api.delete(`/leads/${id}`)));
      setLeads((prev) => prev.filter((l) => !selectedIds.has(l.id)));
      setSelectedIds(new Set());
      setTotal((t) => Math.max(0, t - ids.length));
      toast.success(`${ids.length} leads eliminados`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao eliminar');
    }
  };

  const handleBulkAssign = async (userId: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => api.patch(`/leads/${id}`, { assignedToId: userId })));
      setLeads((prev) => prev.map((l) => selectedIds.has(l.id) ? { ...l, assignedToId: userId, assignedTo: users.find((u) => u.id === userId) as any } : l));
      setSelectedIds(new Set());
      toast.success('Leads reatribuídos');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(search || pipelineId || stageId || status || priority || assignedToId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Leads</h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
          {total} total
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleSyncStatuses}
            disabled={syncing}
            className="btn py-2 px-3"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            title="Corrigir estados que nao correspondem a etapa"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sincronizar estados
          </button>
          <button
            onClick={() => setAdding(true)}
            className="btn btn-primary py-2 px-3"
          >
            <Plus size={14} /> Novo Lead
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2 flex items-center gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)', background: 'var(--primary-light)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>
            {selectedIds.size} lead{selectedIds.size > 1 ? 's' : ''} seleccionado{selectedIds.size > 1 ? 's' : ''}
          </span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
            Limpar selecção
          </button>
          <div className="flex-1" />
          <select
            onChange={(e) => { if (e.target.value) handleBulkAssign(e.target.value); e.target.value = ''; }}
            className="input-base text-xs"
            style={{ width: 200 }}
            defaultValue=""
          >
            <option value="" disabled>Atribuir a...</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={handleBulkDelete} className="btn text-xs py-1.5 px-3" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            <Trash2 size={12} /> Eliminar
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="relative" style={{ minWidth: 200, flex: '1 1 200px' }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por titulo..."
            className="input-base"
            style={{ paddingLeft: 32 }}
          />
        </div>

        <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Todos pipelines</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {activePipeline && (
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="input-base"
            style={{ width: 'auto', minWidth: 140 }}
          >
            <option value="">Todas etapas</option>
            {activePipeline.stages?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 110 }}>
          <option value="">Todos estados</option>
          <option value="OPEN">Aberto</option>
          <option value="WON">Ganho</option>
          <option value="LOST">Perdido</option>
        </select>

        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 120 }}>
          <option value="">Toda prioridade</option>
          <option value="LOW">Baixa</option>
          <option value="MEDIUM">Media</option>
          <option value="HIGH">Alta</option>
          <option value="URGENT">Urgente</option>
        </select>

        <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Todos os responsaveis</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="btn py-2 px-3"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            title="Limpar filtros"
          >
            <RotateCcw size={14} /> Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : sortedLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <FilterIcon size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {hasFilters ? 'Nenhum lead corresponde aos filtros' : 'Sem leads ainda'}
            </p>
            {!hasFilters && (
              <button
                onClick={() => setAdding(true)}
                className="btn btn-primary mt-3 py-2 px-4"
              >
                <Plus size={14} /> Criar primeiro lead
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={leads.length > 0 && selectedIds.size === leads.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(leads.map((l) => l.id)));
                      else setSelectedIds(new Set());
                    }}
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('title')} className="flex items-center gap-1 text-xs uppercase">
                    Titulo {sortIcon('title')}
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Contacto
                </th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('value')} className="flex items-center gap-1 text-xs uppercase">
                    Valor {sortIcon('value')}
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Pipeline / Etapa
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Estado
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Prioridade
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Responsavel
                </th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('createdAt')} className="flex items-center gap-1 text-xs uppercase">
                    Criado {sortIcon('createdAt')}
                  </button>
                </th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>
                  Accoes
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className="hover:bg-slate-50"
                  style={{ borderBottom: '1px solid var(--border)', background: selectedIds.has(lead.id) ? 'var(--primary-light)' : undefined }}
                >
                  <td className="px-2 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(lead.id)}
                      onChange={() => toggleSel(lead.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditing(lead)}
                        className="font-medium hover:underline text-left"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {lead.title}
                      </button>
                      <LeadScoreBadge lead={lead} compact />
                    </div>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {lead.contact ? `${lead.contact.firstName} ${lead.contact.lastName || ''}`.trim() : '—'}
                  </td>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                    {lead.value ? `MZN ${Number(lead.value).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{lead.pipeline?.name}</span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded inline-block w-fit mt-0.5"
                        style={{ background: (lead.stage?.color || '#6B7280') + '22', color: lead.stage?.color || 'var(--text-primary)' }}
                      >
                        {lead.stage?.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{
                        background: STATUS_COLORS[lead.status]?.bg || 'var(--surface-3)',
                        color: STATUS_COLORS[lead.status]?.fg || 'var(--text-primary)',
                      }}
                    >
                      {STATUS_LABELS[lead.status] || lead.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLORS[lead.priority] }} />
                      {PRIORITY_LABELS[lead.priority] || lead.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {lead.assignedTo?.name || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(lead.createdAt).toLocaleDateString('pt-PT')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditing(lead)}
                        className="p-1.5 rounded hover:bg-slate-100"
                        title="Editar"
                      >
                        <Edit3 size={14} style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button
                        onClick={() => navigate(`/pipeline?leadId=${lead.id}`)}
                        className="p-1.5 rounded hover:bg-slate-100"
                        title="Ver no pipeline"
                      >
                        <ExternalLink size={14} style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(lead)}
                        className="p-1.5 rounded hover:bg-red-50"
                        title="Eliminar"
                      >
                        <Trash2 size={14} style={{ color: '#EF4444' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginacao */}
      {total > limit && (
        <div className="flex items-center justify-between p-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Pagina {page} de {totalPages} · {total} leads
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn py-1.5 px-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page <= 1 ? 0.5 : 1 }}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn py-1.5 px-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page >= totalPages ? 0.5 : 1 }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Modais */}
      {adding && (
        <AddLeadFromListModal
          pipelines={pipelines}
          users={users}
          onClose={() => setAdding(false)}
          onCreated={(lead) => {
            setLeads((prev) => [lead, ...prev]);
            setTotal((t) => t + 1);
          }}
        />
      )}

      {editing && (
        <LeadDetailModal
          lead={editing}
          onClose={() => setEditing(null)}
          onUpdated={(updated) =>
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
          }
          onDeleted={(id) => {
            setLeads((prev) => prev.filter((l) => l.id !== id));
            setTotal((t) => Math.max(0, t - 1));
          }}
        />
      )}
    </div>
  );
}
