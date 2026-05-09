import { useEffect, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, MoreVertical, Phone, Mail, Calendar, DollarSign,
  User as UserIcon, Tag as TagIcon, X, Loader2, Trash2, Edit3,
} from 'lucide-react';
import api, { Lead, Pipeline, Stage } from '../lib/api';
import toast from 'react-hot-toast';

// ============== Lead Card ==============
function LeadCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const priorityColors: Record<string, string> = {
    LOW: '#94A3B8',
    MEDIUM: '#3B82F6',
    HIGH: '#F59E0B',
    URGENT: '#EF4444',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="card p-3 mb-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
          {lead.title}
        </h4>
        <div
          className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
          style={{ background: priorityColors[lead.priority] }}
          title={lead.priority}
        />
      </div>

      {lead.value !== undefined && lead.value !== null && (
        <div className="flex items-center gap-1 text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
          <DollarSign size={12} />
          <span className="font-medium">MZN {Number(lead.value).toLocaleString()}</span>
        </div>
      )}

      {lead.contact && (
        <div className="flex items-center gap-1.5 text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
          <UserIcon size={12} />
          <span>{lead.contact.firstName} {lead.contact.lastName || ''}</span>
        </div>
      )}

      {lead.assignedTo && (
        <div className="flex items-center gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: 'var(--primary)' }}
          >
            {lead.assignedTo.name?.[0]?.toUpperCase()}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {lead.assignedTo.name}
          </span>
        </div>
      )}
    </div>
  );
}

// ============== Stage Column ==============
function StageColumn({
  stage,
  leads,
  onAddLead,
  onLeadClick,
}: {
  stage: Stage;
  leads: Lead[];
  onAddLead: (stageId: string) => void;
  onLeadClick: (lead: Lead) => void;
}) {
  const totalValue = leads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

  return (
    <div className="flex flex-col flex-shrink-0 w-72 h-full">
      {/* Header */}
      <div
        className="p-3 rounded-t-lg flex items-center justify-between"
        style={{ background: stage.color + '15', borderTop: `3px solid ${stage.color}` }}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {stage.name}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: stage.color, color: 'white' }}
            >
              {leads.length}
            </span>
          </div>
          {totalValue > 0 && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              MZN {totalValue.toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => onAddLead(stage.id)}
          className="p-1 rounded hover:bg-white/50 transition-colors"
          title="Adicionar lead"
        >
          <Plus size={16} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Cards */}
      <div
        className="flex-1 overflow-y-auto p-2 rounded-b-lg"
        style={{ background: 'var(--surface-2)', minHeight: 200 }}
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-8 text-center text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            <p>Sem leads nesta etapa</p>
            <button
              onClick={() => onAddLead(stage.id)}
              className="mt-2 text-xs underline"
              style={{ color: 'var(--primary)' }}
            >
              + Adicionar primeiro lead
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== Add Lead Modal ==============
function AddLeadModal({
  stageId,
  pipelineId,
  onClose,
  onCreated,
}: {
  stageId: string;
  pipelineId: string;
  onClose: () => void;
  onCreated: (lead: Lead) => void;
}) {
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const { data } = await api.post('/leads', {
        title,
        value: value ? Number(value) : undefined,
        priority,
        stageId,
        pipelineId,
      });
      toast.success('Lead criado com sucesso');
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
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Novo Lead
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Título *
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Venda de software para Empresa X"
              className="input-base"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Valor (MZN)
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className="input-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Prioridade
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="input-base"
            >
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn flex-1 py-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            >
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

// ============== Lead Detail Modal ==============
function LeadDetailModal({
  lead,
  onClose,
  onUpdated,
  onDeleted,
}: {
  lead: Lead;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onDeleted: (leadId: string) => void;
}) {
  const [title, setTitle] = useState(lead.title);
  const [value, setValue] = useState(lead.value?.toString() || '');
  const [priority, setPriority] = useState(lead.priority);
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const { data } = await api.patch(`/leads/${lead.id}`, {
        title,
        value: value ? Number(value) : null,
        priority,
      });
      toast.success('Lead actualizado');
      onUpdated(data);
      onClose();
    } catch {
      toast.error('Erro ao actualizar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Tem a certeza que quer eliminar este lead?')) return;
    setLoading(true);
    try {
      await api.delete(`/leads/${lead.id}`);
      toast.success('Lead eliminado');
      onDeleted(lead.id);
      onClose();
    } catch {
      toast.error('Erro ao eliminar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Editar Lead
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Título
            </label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Valor (MZN)
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="input-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Prioridade
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="input-base"
            >
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleDelete}
              disabled={loading}
              className="btn py-2 px-3"
              style={{ background: '#FEF2F2', color: '#EF4444' }}
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="btn flex-1 py-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            >
              Cancelar
            </button>
            <button onClick={handleUpdate} disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============== Main Pipeline Page ==============
export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string>('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDragLead, setActiveDragLead] = useState<Lead | null>(null);
  const [addingToStage, setAddingToStage] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  // Load pipelines
  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get('/pipelines');
        setPipelines(data);
        if (data[0]) setActivePipelineId(data[0].id);
      } catch {
        toast.error('Erro ao carregar pipelines');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Load leads when pipeline changes
  useEffect(() => {
    if (!activePipelineId) return;
    const loadLeads = async () => {
      try {
        const { data } = await api.get(`/leads?pipelineId=${activePipelineId}&limit=200`);
        setLeads(data.leads || []);
      } catch {
        toast.error('Erro ao carregar leads');
      }
    };
    loadLeads();
  }, [activePipelineId]);

  const handleDragStart = (event: DragStartEvent) => {
    const lead = leads.find((l) => l.id === event.active.id);
    if (lead) setActiveDragLead(lead);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragLead(null);
    const { active, over } = event;
    if (!over) return;

    const activeLeadId = active.id as string;
    const overId = over.id as string;

    const activeLead = leads.find((l) => l.id === activeLeadId);
    if (!activeLead) return;

    let newStageId: string | null = null;

    // Dropping over a stage column directly
    const stageDirect = activePipeline?.stages.find((s) => s.id === overId);
    if (stageDirect) {
      newStageId = stageDirect.id;
    } else {
      // Dropping over another lead — get that lead's stage
      const overLead = leads.find((l) => l.id === overId);
      if (overLead) newStageId = overLead.stageId;
    }

    if (!newStageId || newStageId === activeLead.stageId) return;

    // Optimistic update
    const oldStageId = activeLead.stageId;
    setLeads((prev) =>
      prev.map((l) => (l.id === activeLeadId ? { ...l, stageId: newStageId! } : l))
    );

    try {
      await api.patch(`/leads/${activeLeadId}/move`, { stageId: newStageId });
    } catch {
      // Rollback
      setLeads((prev) =>
        prev.map((l) => (l.id === activeLeadId ? { ...l, stageId: oldStageId } : l))
      );
      toast.error('Erro ao mover lead');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (!activePipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
          Sem pipelines disponíveis.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-4 p-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Pipeline
        </h1>

        <select
          value={activePipelineId}
          onChange={(e) => setActivePipelineId(e.target.value)}
          className="input-base"
          style={{ width: 'auto', minWidth: 200 }}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>Total: <strong style={{ color: 'var(--text-primary)' }}>{leads.length}</strong> leads</span>
          <span>•</span>
          <span>
            Valor: <strong style={{ color: 'var(--text-primary)' }}>
              MZN {leads.reduce((s, l) => s + (Number(l.value) || 0), 0).toLocaleString()}
            </strong>
          </span>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto p-4" style={{ background: 'var(--surface-2)' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 h-full" style={{ minHeight: 'calc(100vh - 200px)' }}>
            {activePipeline.stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={leads.filter((l) => l.stageId === stage.id)}
                onAddLead={setAddingToStage}
                onLeadClick={setSelectedLead}
              />
            ))}
          </div>

          <DragOverlay>
            {activeDragLead && <LeadCard lead={activeDragLead} onClick={() => {}} />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Modals */}
      {addingToStage && (
        <AddLeadModal
          stageId={addingToStage}
          pipelineId={activePipelineId}
          onClose={() => setAddingToStage(null)}
          onCreated={(lead) => setLeads((prev) => [...prev, lead])}
        />
      )}

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={(updated) =>
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
          }
          onDeleted={(id) => setLeads((prev) => prev.filter((l) => l.id !== id))}
        />
      )}
    </div>
  );
}