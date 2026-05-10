import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, MoreVertical, Phone, Mail, Calendar, DollarSign,
  User as UserIcon, Tag as TagIcon, X, Loader2, Trash2, Edit3, Settings, Mouse, Layers,
} from 'lucide-react';
import api, { Lead, Pipeline, Stage } from '../lib/api';
import toast from 'react-hot-toast';

// ============== Hook: pan-scroll com botao do rato ==============
// scrollButton: 0 = esquerdo, 1 = meio, 2 = direito; -1 = desactivado
function useDragScroll(ref: React.RefObject<HTMLElement | null>, scrollButton: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el || scrollButton < 0) return;

    let isPanning = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== scrollButton) return;
      // ignorar se clicou num lead card (deixa o dnd-kit funcionar)
      const target = e.target as HTMLElement;
      if (target.closest('[data-lead-card="true"]')) return;
      // ignorar se clicou em botoes/inputs/links
      if (target.closest('button, input, select, textarea, a')) return;

      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
      if (scrollButton !== 0) e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      el.scrollLeft = startLeft - (e.clientX - startX);
      el.scrollTop = startTop - (e.clientY - startY);
    };

    const stop = () => {
      if (!isPanning) return;
      isPanning = false;
      el.style.cursor = '';
      el.style.userSelect = '';
    };

    const onContextMenu = (e: MouseEvent) => {
      if (scrollButton === 2) e.preventDefault();
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('mouseleave', stop);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('mouseleave', stop);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [ref, scrollButton]);
}

// ============== Lead Card ==============
function LeadCard({ lead, onClick, external = false }: { lead: Lead; onClick: () => void; external?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id, disabled: external });

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
      {...(external ? {} : attributes)}
      {...(external ? {} : listeners)}
      onClick={onClick}
      data-lead-card="true"
      className={`card p-3 mb-2 hover:shadow-md transition-shadow ${external ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
    >
      {external && lead.pipeline && (
        <div className="mb-1.5">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-medium"
            style={{ background: lead.pipeline.color + '22', color: lead.pipeline.color }}
            title={`Pipeline: ${lead.pipeline.name}`}
          >
            <Layers size={10} /> {lead.pipeline.name}
          </span>
        </div>
      )}

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
  isExternal,
}: {
  stage: Stage;
  leads: Lead[];
  onAddLead: (stageId: string) => void;
  onLeadClick: (lead: Lead) => void;
  isExternal?: (lead: Lead) => boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
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

      {/* Cards (drop zone) */}
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto p-2 rounded-b-lg transition-colors"
        style={{
          background: isOver ? stage.color + '22' : 'var(--surface-2)',
          minHeight: 200,
          outline: isOver ? `2px dashed ${stage.color}` : 'none',
          outlineOffset: -2,
        }}
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onClick={() => onLeadClick(lead)}
              external={isExternal ? isExternal(lead) : false}
            />
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

// ============== Manage Stages Modal ==============
const STAGE_COLORS = ['#6B7280', '#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#14B8A6', '#F97316', '#06B6D4'];

function ManageStagesModal({
  pipeline,
  onClose,
  onChanged,
}: {
  pipeline: Pipeline;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [stages, setStages] = useState<Stage[]>(pipeline.stages);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(STAGE_COLORS[0]);

  const updateField = (id: string, key: keyof Stage, value: any) =>
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)));

  const handleSave = async () => {
    setLoading(true);
    try {
      // Atualiza cada etapa modificada
      await Promise.all(
        stages.map((s) => {
          const original = pipeline.stages.find((o) => o.id === s.id);
          if (!original) return null;
          if (original.name !== s.name || original.color !== s.color) {
            return api.patch(`/stages/${s.id}`, { name: s.name, color: s.color });
          }
          return null;
        })
      );
      toast.success('Etapas actualizadas');
      onChanged();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (stage: Stage) => {
    if (!confirm(`Eliminar a etapa "${stage.name}"? Os leads nesta etapa precisam de ser movidos primeiro.`)) return;
    try {
      await api.delete(`/stages/${stage.id}`);
      setStages((prev) => prev.filter((s) => s.id !== stage.id));
      toast.success('Etapa eliminada');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Nao foi possivel eliminar (talvez tenha leads)');
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error('Indica o nome da etapa');
      return;
    }
    try {
      const { data } = await api.post('/stages', {
        name: newName.trim(),
        color: newColor,
        pipelineId: pipeline.id,
        position: stages.length,
      });
      setStages((prev) => [...prev, data]);
      setNewName('');
      setNewColor(STAGE_COLORS[0]);
      toast.success('Etapa adicionada');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao adicionar');
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Gerir Etapas
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className="flex items-center gap-2 p-2 rounded"
              style={{ background: 'var(--surface-2)' }}
            >
              <input
                type="color"
                value={stage.color}
                onChange={(e) => updateField(stage.id, 'color', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0"
                title="Cor"
              />
              <input
                value={stage.name}
                onChange={(e) => updateField(stage.id, 'name', e.target.value)}
                className="input-base flex-1"
              />
              <span
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: stage.type === 'WON' ? '#D1FAE5' : stage.type === 'LOST' ? '#FEE2E2' : 'var(--surface-3)',
                  color: stage.type === 'WON' ? '#065F46' : stage.type === 'LOST' ? '#991B1B' : 'var(--text-muted)',
                }}
              >
                {stage.type}
              </span>
              <button
                onClick={() => handleDelete(stage)}
                className="p-2 rounded hover:bg-red-50"
                title="Eliminar"
              >
                <Trash2 size={16} style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t pt-4 mb-4" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Nova etapa
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da etapa"
              className="input-base flex-1"
            />
            <button onClick={handleAdd} className="btn btn-primary py-2 px-3">
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="btn flex-1 py-2"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          >
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar alterações'}
          </button>
        </div>
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

// ============== Manage Pipelines Modal ==============
function ManagePipelinesModal({
  pipelines,
  activePipelineId,
  onClose,
  onChanged,
  onSwitchPipeline,
}: {
  pipelines: Pipeline[];
  activePipelineId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSwitchPipeline: (id: string) => void;
}) {
  const [list, setList] = useState<Pipeline[]>(pipelines);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366F1');

  useEffect(() => {
    setList(pipelines);
  }, [pipelines]);

  const updateField = (id: string, key: keyof Pipeline, value: any) =>
    setList((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));

  const handleSave = async () => {
    setLoading(true);
    try {
      await Promise.all(
        list.map((p) => {
          const original = pipelines.find((o) => o.id === p.id);
          if (!original) return null;
          // Pipeline Principal: so a cor pode mudar
          if (p.isDefault) {
            if (original.color !== p.color) {
              return api.patch(`/pipelines/${p.id}`, { color: p.color });
            }
            return null;
          }
          if (original.name !== p.name || original.color !== p.color) {
            return api.patch(`/pipelines/${p.id}`, { name: p.name, color: p.color });
          }
          return null;
        })
      );
      toast.success('Pipelines actualizados');
      await onChanged();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (pipeline: Pipeline) => {
    if (pipeline.isDefault) {
      toast.error('O Pipeline Principal nao pode ser eliminado');
      return;
    }
    if (list.length <= 1) {
      toast.error('Tem de existir pelo menos um pipeline');
      return;
    }
    if (!confirm(`Eliminar o pipeline "${pipeline.name}"? As etapas e leads associados serao removidos.`)) return;
    try {
      await api.delete(`/pipelines/${pipeline.id}`);
      const remaining = list.filter((p) => p.id !== pipeline.id);
      setList(remaining);
      toast.success('Pipeline eliminado');
      if (activePipelineId === pipeline.id && remaining[0]) {
        onSwitchPipeline(remaining[0].id);
      }
      await onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Nao foi possivel eliminar');
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast.error('Indica o nome do pipeline');
      return;
    }
    try {
      const { data } = await api.post('/pipelines', {
        name: newName.trim(),
        color: newColor,
      });
      setList((prev) => [...prev, data]);
      setNewName('');
      setNewColor('#6366F1');
      toast.success('Pipeline criado');
      await onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro ao criar pipeline');
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Gerir Pipelines
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {list.map((pipeline) => {
            const isProtected = pipeline.isDefault;
            return (
              <div
                key={pipeline.id}
                className="flex items-center gap-2 p-2 rounded"
                style={{ background: 'var(--surface-2)' }}
              >
                <input
                  type="color"
                  value={pipeline.color}
                  onChange={(e) => updateField(pipeline.id, 'color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0"
                  title="Cor"
                />
                <input
                  value={pipeline.name}
                  onChange={(e) => updateField(pipeline.id, 'name', e.target.value)}
                  className="input-base flex-1"
                  disabled={isProtected}
                  readOnly={isProtected}
                  title={isProtected ? 'O nome do Pipeline Principal nao pode ser alterado' : undefined}
                  style={isProtected ? { background: 'var(--surface-3)', cursor: 'not-allowed', color: 'var(--text-muted)' } : undefined}
                />
                {isProtected && (
                  <span
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                    title="Vista agregada de todos os pipelines"
                  >
                    Padrao
                  </span>
                )}
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
                  title="Numero de etapas"
                >
                  {pipeline.stages?.length || 0} etapas
                </span>
                <button
                  onClick={() => handleDelete(pipeline)}
                  className="p-2 rounded hover:bg-red-50"
                  title={isProtected ? 'O Pipeline Principal nao pode ser eliminado' : 'Eliminar'}
                  disabled={isProtected || list.length <= 1}
                  style={{ opacity: isProtected || list.length <= 1 ? 0.4 : 1, cursor: isProtected ? 'not-allowed' : 'pointer' }}
                >
                  <Trash2 size={16} style={{ color: '#EF4444' }} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-4 mb-4" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Novo pipeline
          </p>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Cria com 4 etapas padrao: Novo, Em Progresso, Ganho, Perdido
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do pipeline (ex: Vendas B2B)"
              className="input-base flex-1"
            />
            <button onClick={handleAdd} className="btn btn-primary py-2 px-3">
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="btn flex-1 py-2"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          >
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar alterações'}
          </button>
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
  const [managingStages, setManagingStages] = useState(false);
  const [managingPipelines, setManagingPipelines] = useState(false);
  const [showMouseSettings, setShowMouseSettings] = useState(false);
  const [scrollButton, setScrollButton] = useState<number>(() => {
    const saved = localStorage.getItem('kommo:scrollButton');
    return saved !== null ? parseInt(saved, 10) : 1; // default: meio
  });

  const boardRef = useRef<HTMLDivElement>(null);
  useDragScroll(boardRef, scrollButton);

  // Query param ?leadId=... vindo da pesquisa global
  const [searchParams, setSearchParams] = useSearchParams();
  const queryLeadId = searchParams.get('leadId');
  useEffect(() => {
    if (!queryLeadId) return;
    const inLoaded = leads.find((l) => l.id === queryLeadId);
    if (inLoaded) {
      setSelectedLead(inLoaded);
      // limpa o param da URL
      const next = new URLSearchParams(searchParams);
      next.delete('leadId');
      setSearchParams(next, { replace: true });
    } else {
      // tenta carregar directamente da API
      api
        .get(`/leads/${queryLeadId}`)
        .then(({ data }) => {
          setSelectedLead(data);
          const next = new URLSearchParams(searchParams);
          next.delete('leadId');
          setSearchParams(next, { replace: true });
        })
        .catch(() => toast.error('Lead nao encontrado'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryLeadId, leads]);

  useEffect(() => {
    localStorage.setItem('kommo:scrollButton', String(scrollButton));
  }, [scrollButton]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const activePipeline = pipelines.find((p) => p.id === activePipelineId);

  const reloadPipelines = async () => {
    try {
      const { data } = await api.get('/pipelines');
      setPipelines(data);
    } catch {
      toast.error('Erro ao recarregar pipelines');
    }
  };

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
  // Pipeline padrao (isDefault) agrega leads de TODOS os pipelines do workspace
  const isAggregated = activePipeline?.isDefault === true;
  useEffect(() => {
    if (!activePipelineId || !activePipeline) return;
    const loadLeads = async () => {
      try {
        const url = isAggregated
          ? `/leads?limit=500`
          : `/leads?pipelineId=${activePipelineId}&limit=200`;
        const { data } = await api.get(url);
        setLeads(data.leads || []);
      } catch {
        toast.error('Erro ao carregar leads');
      }
    };
    loadLeads();
  }, [activePipelineId, isAggregated]);

  // Mapeia o lead para a coluna correcta no Pipeline Principal (vista agregada)
  const mapToColumnStageId = (lead: Lead): string | null => {
    if (!isAggregated || !activePipeline) return lead.stageId;
    if (lead.pipelineId === activePipelineId) return lead.stageId;
    const principalRegular = activePipeline.stages
      .filter((s) => s.type === 'REGULAR')
      .sort((a, b) => a.position - b.position);
    const wonId = activePipeline.stages.find((s) => s.type === 'WON')?.id;
    const lostId = activePipeline.stages.find((s) => s.type === 'LOST')?.id;
    if (lead.stage?.type === 'WON') return wonId || null;
    if (lead.stage?.type === 'LOST') return lostId || null;
    if (principalRegular.length === 0) return null;
    const idx = Math.min(Math.max(0, lead.stage?.position ?? 0), principalRegular.length - 1);
    return principalRegular[idx].id;
  };

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

    // Na vista agregada nao se podem mover leads de outros pipelines
    if (isAggregated && activeLead.pipelineId !== activePipelineId) {
      toast('Para mover este lead, abre o pipeline original', { icon: 'ℹ️' });
      return;
    }

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
      <div className="flex items-center gap-4 p-4 flex-shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
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
            <option key={p.id} value={p.id}>
              {p.name}{p.isDefault ? ' (vista agregada)' : ''}
            </option>
          ))}
        </select>

        {isAggregated && (
          <span
            className="text-xs px-2 py-1 rounded font-medium"
            style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
            title="Mostra leads de todos os pipelines"
          >
            <Layers size={11} className="inline mr-1" />
            A mostrar todos os pipelines
          </span>
        )}

        <button
          onClick={() => setManagingPipelines(true)}
          className="btn"
          style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          title="Gerir pipelines"
        >
          <Layers size={14} />
          <span>Gerir Pipelines</span>
        </button>

        <button
          onClick={() => setManagingStages(true)}
          className="btn"
          style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          title="Gerir etapas"
        >
          <Settings size={14} />
          <span>Gerir Etapas</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMouseSettings((v) => !v)}
            className="btn"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            title="Configurar pan-scroll"
          >
            <Mouse size={14} />
            <span>Rato</span>
          </button>
          {showMouseSettings && (
            <div
              className="absolute top-full mt-2 left-0 z-40 card p-2 w-56"
              style={{ background: 'var(--surface)' }}
            >
              <p className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>
                Botao do rato para mover a vista
              </p>
              {[
                { v: -1, label: 'Desactivado' },
                { v: 0, label: 'Esquerdo (cuidado: usa-se p/ cards)' },
                { v: 1, label: 'Meio (roda)' },
                { v: 2, label: 'Direito' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => {
                    setScrollButton(opt.v);
                    setShowMouseSettings(false);
                  }}
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-slate-100"
                  style={{
                    color: 'var(--text-primary)',
                    background: scrollButton === opt.v ? 'var(--primary-light)' : 'transparent',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

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
      <div ref={boardRef} className="flex-1 overflow-auto p-4" style={{ background: 'var(--surface-2)' }}>
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
                leads={leads.filter((l) => mapToColumnStageId(l) === stage.id)}
                onAddLead={setAddingToStage}
                onLeadClick={setSelectedLead}
                isExternal={(lead) => isAggregated && lead.pipelineId !== activePipelineId}
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

      {managingStages && activePipeline && (
        <ManageStagesModal
          pipeline={activePipeline}
          onClose={() => setManagingStages(false)}
          onChanged={reloadPipelines}
        />
      )}

      {managingPipelines && (
        <ManagePipelinesModal
          pipelines={pipelines}
          activePipelineId={activePipelineId}
          onClose={() => setManagingPipelines(false)}
          onChanged={reloadPipelines}
          onSwitchPipeline={setActivePipelineId}
        />
      )}
    </div>
  );
}