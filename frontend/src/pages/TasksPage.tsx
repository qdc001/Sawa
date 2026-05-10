import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useDroppable, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, Check, Calendar as CalIcon,
  List as ListIcon, RotateCcw, AlertCircle, ExternalLink, Download,
  Phone, Mail, Users as UsersIcon, Repeat, Briefcase, Circle,
  ChevronLeft, ChevronRight, CheckSquare, Square, MinusSquare,
  Tags as TagsIcon, Layout, Flag, Clock, User as UserIcon,
} from 'lucide-react';
import api, { Task, User, Lead, Tag as TagType, Pipeline, Stage } from '../lib/api';
import toast from 'react-hot-toast';
import { useUIStore } from '../store';
import { useAuthStore } from '../store';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em curso',
  COMPLETED: 'Concluida',
  CANCELLED: 'Cancelada',
};
const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: '#FEF3C7', fg: '#92400E' },
  IN_PROGRESS: { bg: '#DBEAFE', fg: '#1E40AF' },
  COMPLETED: { bg: '#D1FAE5', fg: '#065F46' },
  CANCELLED: { bg: '#F3F4F6', fg: '#374151' },
};
const TYPE_LABELS: Record<string, string> = {
  CALL: 'Chamada', EMAIL: 'Email', MEETING: 'Reuniao',
  FOLLOW_UP: 'Follow-up', DEMO: 'Demo', OTHER: 'Outro',
};
const TYPE_ICONS: Record<string, any> = {
  CALL: Phone, EMAIL: Mail, MEETING: UsersIcon,
  FOLLOW_UP: Repeat, DEMO: Briefcase, OTHER: Circle,
};
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente',
};
const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#94A3B8', MEDIUM: '#3B82F6', HIGH: '#F59E0B', URGENT: '#EF4444',
};
const RECURRENCE_LABELS: Record<string, string> = {
  '': 'Nao se repete', DAILY: 'Diariamente', WEEKLY: 'Semanalmente', MONTHLY: 'Mensalmente',
};

function isOverdue(task: Task): boolean {
  if (!task.dueAt) return false;
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

type DateFilter = '' | 'today' | 'week' | '7days' | 'overdue' | 'noDate';

function applyDateFilter(tasks: Task[], filter: DateFilter): Task[] {
  if (!filter) return tasks;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  const next7 = new Date(today); next7.setDate(today.getDate() + 7);

  return tasks.filter((t) => {
    if (filter === 'overdue') return isOverdue(t);
    if (filter === 'noDate') return !t.dueAt;
    if (!t.dueAt) return false;
    const due = new Date(t.dueAt);
    if (filter === 'today') return due >= today && due < tomorrow;
    if (filter === 'week') return due >= weekStart && due < weekEnd;
    if (filter === '7days') return due >= today && due < next7;
    return true;
  });
}

// =============== Modal: Nova/Editar Tarefa (com subtarefas) ===============
function TaskFormModal({
  task, users, leads, tags,
  onClose, onSaved, onTagsChanged, initialDate,
}: {
  task?: Task | null;
  users: User[];
  leads: Lead[];
  tags: TagType[];
  onClose: () => void;
  onSaved: (t: Task) => void;
  onTagsChanged: () => void;
  initialDate?: string;
}) {
  const isEdit = !!task?.id;
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [type, setType] = useState(task?.type || 'CALL');
  const [status, setStatus] = useState(task?.status || 'PENDING');
  const [priority, setPriority] = useState(task?.priority || 'MEDIUM');
  const [recurrence, setRecurrence] = useState(task?.recurrence || '');
  const [dueAt, setDueAt] = useState(
    task?.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16)
      : initialDate ? `${initialDate}T09:00` : ''
  );
  const [assignedToId, setAssignedToId] = useState(task?.assignedTo?.id || '');
  const [leadId, setLeadId] = useState((task as any)?.leadId || (task?.lead as any)?.id || '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(task?.tags?.map((t: any) => t.tag?.id).filter(Boolean) || []);
  const [subtasks, setSubtasks] = useState<Task[]>(task?.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [loading, setLoading] = useState(false);

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const addSubtask = async () => {
    if (!newSubtask.trim() || !task?.id) return;
    try {
      const { data } = await api.post('/tasks', {
        title: newSubtask.trim(), parentTaskId: task.id, status: 'PENDING',
      });
      setSubtasks((p) => [...p, data]);
      setNewSubtask('');
    } catch { toast.error('Erro a criar subtarefa'); }
  };

  const toggleSubtask = async (sub: Task) => {
    try {
      const newStatus = sub.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
      const { data } = await api.patch(`/tasks/${sub.id}`, { status: newStatus });
      setSubtasks((p) => p.map((s) => (s.id === sub.id ? data : s)));
    } catch { toast.error('Erro'); }
  };

  const deleteSubtask = async (sub: Task) => {
    try {
      await api.delete(`/tasks/${sub.id}`);
      setSubtasks((p) => p.filter((s) => s.id !== sub.id));
    } catch { toast.error('Erro'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Titulo obrigatorio'); return; }
    setLoading(true);
    try {
      const payload: any = {
        title, description, type, status, priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        recurrence: recurrence || null,
        assignedToId: assignedToId || undefined,
        leadId: leadId || null,
        tags: selectedTagIds,
      };
      let saved: Task;
      if (isEdit) {
        const { data } = await api.patch(`/tasks/${task!.id}`, payload);
        saved = data; toast.success('Tarefa actualizada');
      } else {
        const { data } = await api.post('/tasks', payload);
        saved = data; toast.success('Tarefa criada');
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a guardar');
    } finally { setLoading(false); }
  };

  const subDone = subtasks.filter((s) => s.status === 'COMPLETED').length;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Editar Tarefa' : 'Nova Tarefa'}
          </h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Titulo *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" required autoFocus placeholder="Ex: Ligar ao cliente" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Descricao</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Tipo</label>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="input-base">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Prioridade</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="input-base">
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Estado</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input-base">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Recorrencia</label>
              <select value={recurrence || ''} onChange={(e) => setRecurrence(e.target.value as any)} className="input-base">
                {Object.entries(RECURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Data e hora limite</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Responsavel</label>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base">
              <option value="">— Eu —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Lead associado</label>
            <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="input-base">
              <option value="">— Nenhum —</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Tags</label>
            <div className="flex flex-wrap gap-1.5 p-2 rounded mt-1" style={{ background: 'var(--surface-2)', minHeight: 40 }}>
              {tags.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem tags. Cria em "Gerir tags".</span>}
              {tags.map((tag) => {
                const sel = selectedTagIds.includes(tag.id);
                return (
                  <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                    className="text-xs px-2 py-1 rounded font-medium"
                    style={{
                      background: sel ? tag.color : tag.color + '22',
                      color: sel ? '#fff' : tag.color,
                      border: `1px solid ${tag.color}`,
                    }}>
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subtarefas (so em modo edit) */}
          {isEdit && (
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Subtarefas {subtasks.length > 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({subDone}/{subtasks.length})</span>}
              </p>
              <div className="space-y-1 mb-2">
                {subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2 p-2 rounded text-sm" style={{ background: 'var(--surface-2)' }}>
                    <button type="button" onClick={() => toggleSubtask(sub)} className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                      style={{ background: sub.status === 'COMPLETED' ? '#10B981' : 'transparent', borderColor: sub.status === 'COMPLETED' ? '#10B981' : 'var(--border)' }}>
                      {sub.status === 'COMPLETED' && <Check size={10} style={{ color: '#fff' }} />}
                    </button>
                    <span className="flex-1" style={{ color: 'var(--text-primary)', textDecoration: sub.status === 'COMPLETED' ? 'line-through' : 'none', opacity: sub.status === 'COMPLETED' ? 0.6 : 1 }}>
                      {sub.title}
                    </span>
                    <button type="button" onClick={() => deleteSubtask(sub)} className="p-1 rounded hover:bg-red-50">
                      <Trash2 size={12} style={{ color: '#EF4444' }} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                  placeholder="Adicionar subtarefa..."
                  className="input-base flex-1"
                />
                <button type="button" onClick={addSubtask} className="btn btn-primary py-2 px-3"><Plus size={14} /></button>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : isEdit ? 'Guardar' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============== Componentes Drag-Drop Calendario ===============
function DraggableTaskBadge({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const overdue = isOverdue(task);
  const done = task.status === 'COMPLETED';
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="text-left text-[10px] px-1 py-0.5 rounded hover:opacity-80 cursor-grab active:cursor-grabbing"
      style={{
        background: done ? '#D1FAE5' : overdue ? '#FEE2E2' : task.priority === 'URGENT' ? '#FEE2E2' : 'var(--primary-light)',
        color: done ? '#065F46' : overdue ? '#991B1B' : task.priority === 'URGENT' ? '#991B1B' : 'var(--primary)',
        textDecoration: done ? 'line-through' : 'none',
        opacity: isDragging ? 0.4 : 1,
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
      }}
      title={`${task.title} · ${PRIORITY_LABELS[task.priority]}`}
    >
      <span className="block truncate">{task.title}</span>
    </button>
  );
}

function DroppableDay({ dayKey, children }: { dayKey: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });
  return (
    <div ref={setNodeRef} className="contents" style={{ outline: isOver ? '2px solid var(--primary)' : 'none' }}>
      {children}
    </div>
  );
}

// =============== Vista Calendario ===============
function CalendarView({
  tasks, monthDate, onPrev, onNext, onToday, onCreateAt, onEdit, onTaskMoved,
}: {
  tasks: Task[]; monthDate: Date;
  onPrev: () => void; onNext: () => void; onToday: () => void;
  onCreateAt: (date: string) => void;
  onEdit: (t: Task) => void;
  onTaskMoved: (taskId: string, newDate: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const days: Array<{ date: Date; current: boolean }> = [];
  for (let i = startWeekday - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), current: false });
  for (let d = 1; d <= lastDay.getDate(); d++) days.push({ date: new Date(year, month, d), current: true });
  while (days.length % 7 !== 0 || days.length < 35) {
    const last = days[days.length - 1].date;
    days.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), current: false });
    if (days.length >= 42) break;
  }

  const tasksByDay: Record<string, Task[]> = {};
  tasks.forEach((t) => {
    if (!t.dueAt) return;
    const k = new Date(t.dueAt).toISOString().slice(0, 10);
    (tasksByDay[k] = tasksByDay[k] || []).push(t);
  });

  const today = new Date().toISOString().slice(0, 10);
  const monthName = monthDate.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    onTaskMoved(e.active.id as string, e.over.id as string);
  };

  const activeTask = tasks.find((t) => t.id === activeId);

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onPrev} className="p-2 rounded hover:bg-slate-100"><ChevronLeft size={16} /></button>
        <button onClick={onToday} className="btn py-1 px-2 text-xs" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Hoje</button>
        <button onClick={onNext} className="p-2 rounded hover:bg-slate-100"><ChevronRight size={16} /></button>
        <h2 className="text-lg font-bold ml-2 capitalize" style={{ color: 'var(--text-primary)' }}>{monthName}</h2>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>Arrasta tarefas para mudar a data</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
        {weekDays.map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-7 gap-1 flex-1" style={{ minHeight: 500 }}>
          {days.map((d, i) => {
            const k = d.date.toISOString().slice(0, 10);
            const isToday = k === today;
            const dayTasks = tasksByDay[k] || [];
            const { setNodeRef, isOver } = useDroppable({ id: k });
            return (
              <div
                ref={setNodeRef}
                key={i}
                className="rounded p-1 flex flex-col gap-1 overflow-hidden group"
                style={{
                  background: isOver ? 'var(--primary-light)' : d.current ? 'var(--surface)' : 'var(--surface-2)',
                  border: isToday ? '2px solid var(--primary)' : isOver ? '2px dashed var(--primary)' : '1px solid var(--border)',
                  opacity: d.current ? 1 : 0.5,
                  minHeight: 90,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: isToday ? 'var(--primary)' : 'var(--text-secondary)' }}>{d.date.getDate()}</span>
                  {d.current && (
                    <button onClick={() => onCreateAt(k)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus size={11} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 80 }}>
                  {dayTasks.slice(0, 4).map((t) => (
                    <DraggableTaskBadge key={t.id} task={t} onClick={() => onEdit(t)} />
                  ))}
                  {dayTasks.length > 4 && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>+{dayTasks.length - 4} mais</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <DragOverlay>
          {activeTask && (
            <div className="text-[10px] px-1 py-0.5 rounded shadow-lg"
              style={{ background: 'var(--primary)', color: '#fff' }}>
              {activeTask.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// =============== Vista Agenda (estilo Kommo) ===============
const AGENDA_COLUMNS = [
  { key: 'overdue', label: 'Atrasadas', color: '#EF4444' },
  { key: 'today', label: 'Hoje', color: '#10B981' },
  { key: 'tomorrow', label: 'Amanhã', color: '#3B82F6' },
  { key: 'thisWeek', label: 'Esta semana', color: '#8B5CF6' },
  { key: 'thisMonth', label: 'Este mês', color: '#F59E0B' },
  { key: 'future', label: 'Futuro', color: '#94A3B8' },
] as const;

type AgendaCol = typeof AGENDA_COLUMNS[number]['key'];

function classifyTask(t: Task): AgendaCol | null {
  if (!t.dueAt) return 'future';
  if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(t.dueAt);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  if (dueDay.getTime() < today.getTime()) return 'overdue';
  if (dueDay.getTime() === today.getTime()) return 'today';

  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (dueDay.getTime() === tomorrow.getTime()) return 'tomorrow';

  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + (7 - ((today.getDay() + 6) % 7)));
  if (dueDay <= weekEnd) return 'thisWeek';

  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (dueDay <= monthEnd) return 'thisMonth';

  return 'future';
}

function getDateForCol(col: AgendaCol): Date {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
  switch (col) {
    case 'overdue': base.setDate(base.getDate() - 1); return base;
    case 'today': return base;
    case 'tomorrow': base.setDate(base.getDate() + 1); return base;
    case 'thisWeek': base.setDate(base.getDate() + 3); return base;
    case 'thisMonth': base.setDate(base.getDate() + 14); return base;
    case 'future': base.setDate(base.getDate() + 30); return base;
  }
}

function AgendaCard({
  task, pipelines, onEdit, onChangeStage, onChangeStatus,
}: {
  task: Task;
  pipelines: Pipeline[];
  onEdit: () => void;
  onChangeStage: (stageId: string) => void;
  onChangeStatus: (status: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const Icon = TYPE_ICONS[task.type] || Circle;
  const overdue = isOverdue(task);

  const leadPipeline = task.lead ? pipelines.find((p) => p.id === (task.lead as any).pipelineId) : null;
  const stages = leadPipeline?.stages || [];

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="card p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      style={{
        opacity: isDragging ? 0.4 : 1,
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority]}`,
        marginBottom: 8,
      }}
    >
      {task.lead && (
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--primary)' }}>
          {task.lead.title}
        </div>
      )}

      <button onClick={onEdit} className="text-left w-full block">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
      </button>

      {task.description && (
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
      )}

      <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: overdue ? '#991B1B' : 'var(--text-secondary)' }}>
        <Icon size={11} />
        <span>{TYPE_LABELS[task.type]}</span>
        {task.dueAt && (
          <>
            <span>·</span>
            <span>{new Date(task.dueAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </>
        )}
      </div>

      {task.assignedTo && (
        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {task.assignedTo.name}
        </div>
      )}

      {/* Acções rápidas - mudar etapa e marcar concluído */}
      <div className="flex items-center gap-1 mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        {task.lead && stages.length > 0 && (
          <select
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); onChangeStage(e.target.value); }}
            value=""
            className="text-xs flex-1 px-1 py-0.5 rounded"
            style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            title="Mudar etapa do lead"
          >
            <option value="">Mudar etapa…</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onChangeStatus('COMPLETED'); }}
          className="text-xs px-2 py-0.5 rounded font-medium"
          style={{ background: '#D1FAE5', color: '#065F46' }}
          title="Marcar concluida"
        >
          <Check size={11} />
        </button>
      </div>
    </div>
  );
}

function AgendaColumn({
  col, label, color, tasks, pipelines, onEdit, onChangeStage, onChangeStatus,
}: {
  col: AgendaCol;
  label: string;
  color: string;
  tasks: Task[];
  pipelines: Pipeline[];
  onEdit: (t: Task) => void;
  onChangeStage: (taskId: string, stageId: string) => void;
  onChangeStatus: (taskId: string, status: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `agenda:${col}` });
  return (
    <div className="flex flex-col flex-shrink-0 w-72 h-full">
      <div className="p-3 rounded-t-lg flex flex-col items-center" style={{ background: color + '15', borderTop: `3px solid ${color}` }}>
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color }}>{label}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{tasks.length} eventos</span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto p-2 rounded-b-lg"
        style={{
          background: isOver ? color + '22' : 'var(--surface-2)',
          minHeight: 200,
          outline: isOver ? `2px dashed ${color}` : 'none',
          outlineOffset: -2,
        }}
      >
        {tasks.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem tarefas</p>
        )}
        {tasks.map((t) => (
          <AgendaCard
            key={t.id}
            task={t}
            pipelines={pipelines}
            onEdit={() => onEdit(t)}
            onChangeStage={(stageId) => onChangeStage(t.id, stageId)}
            onChangeStatus={(s) => onChangeStatus(t.id, s)}
          />
        ))}
      </div>
    </div>
  );
}

function AgendaView({
  tasks, pipelines, onEdit, onTaskMoved, onChangeStage, onChangeStatus,
}: {
  tasks: Task[];
  pipelines: Pipeline[];
  onEdit: (t: Task) => void;
  onTaskMoved: (taskId: string, newDate: Date) => void;
  onChangeStage: (taskId: string, stageId: string) => void;
  onChangeStatus: (taskId: string, status: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const tasksByCol: Record<AgendaCol, Task[]> = {
    overdue: [], today: [], tomorrow: [], thisWeek: [], thisMonth: [], future: [],
  };
  tasks.forEach((t) => {
    const col = classifyTask(t);
    if (col) tasksByCol[col].push(t);
  });

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const overId = e.over.id as string;
    if (!overId.startsWith('agenda:')) return;
    const col = overId.replace('agenda:', '') as AgendaCol;
    const newDate = getDateForCol(col);
    onTaskMoved(e.active.id as string, newDate);
  };

  const activeTask = tasks.find((t) => t.id === activeId);

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveId(e.active.id as string)} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 p-4 h-full overflow-x-auto">
        {AGENDA_COLUMNS.map((c) => (
          <AgendaColumn
            key={c.key}
            col={c.key}
            label={c.label}
            color={c.color}
            tasks={tasksByCol[c.key]}
            pipelines={pipelines}
            onEdit={onEdit}
            onChangeStage={onChangeStage}
            onChangeStatus={onChangeStatus}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="card p-3 shadow-xl" style={{ borderLeft: `3px solid ${PRIORITY_COLORS[activeTask.priority]}` }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{activeTask.title}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// =============== Vista Kanban ===============
function KanbanView({ tasks, onEdit }: { tasks: Task[]; onEdit: (t: Task) => void }) {
  const cols: Array<{ key: string; label: string }> = [
    { key: 'PENDING', label: 'Pendente' },
    { key: 'IN_PROGRESS', label: 'Em curso' },
    { key: 'COMPLETED', label: 'Concluida' },
    { key: 'CANCELLED', label: 'Cancelada' },
  ];
  return (
    <div className="flex gap-3 p-4 h-full overflow-x-auto">
      {cols.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        const colColor = STATUS_COLORS[col.key]?.fg || 'var(--text-secondary)';
        return (
          <div key={col.key} className="flex flex-col flex-shrink-0 w-72">
            <div className="p-3 rounded-t-lg flex items-center justify-between" style={{ background: STATUS_COLORS[col.key]?.bg, borderTop: `3px solid ${colColor}` }}>
              <span className="font-medium text-sm" style={{ color: colColor }}>{col.label}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: colColor, color: '#fff' }}>{colTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 rounded-b-lg space-y-2" style={{ background: 'var(--surface-2)', minHeight: 200 }}>
              {colTasks.map((t) => {
                const overdue = isOverdue(t);
                const Icon = TYPE_ICONS[t.type] || Circle;
                return (
                  <button key={t.id} onClick={() => onEdit(t)} className="card p-3 text-left w-full hover:shadow-md transition-shadow"
                    style={{ borderLeft: `3px solid ${PRIORITY_COLORS[t.priority]}` }}>
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <Icon size={10} />
                      {t.dueAt && (
                        <span style={{ color: overdue ? '#991B1B' : undefined }}>
                          {new Date(t.dueAt).toLocaleDateString('pt-PT')}
                        </span>
                      )}
                    </div>
                    {(t.tags && t.tags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {t.tags.slice(0, 3).map((tt: any) => (
                          <span key={tt.tag.id} className="text-[9px] px-1 py-0.5 rounded" style={{ background: tt.tag.color + '22', color: tt.tag.color }}>{tt.tag.name}</span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
              {colTasks.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem tarefas</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============== Modal Tags ===============
function ManageTagsModal({ tags, onClose, onChanged }: { tags: TagType[]; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<TagType[]>(tags);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366F1');
  useEffect(() => setList(tags), [tags]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      const { data } = await api.post('/tags', { name: newName.trim(), color: newColor });
      setList((p) => [...p, data]);
      setNewName(''); setNewColor('#6366F1');
      toast.success('Tag criada'); onChanged();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const handleDelete = async (tag: TagType) => {
    if (!confirm(`Eliminar a tag "${tag.name}"?`)) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      setList((p) => p.filter((t) => t.id !== tag.id));
      toast.success('Eliminada'); onChanged();
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Gerir Tags</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="space-y-2 mb-4">
          {list.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
              <span className="w-4 h-4 rounded-full" style={{ background: tag.color }} />
              <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>{tag.name}</span>
              <button onClick={() => handleDelete(tag)} className="p-1 rounded hover:bg-red-50">
                <Trash2 size={14} style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Nova tag</p>
          <div className="flex items-center gap-2">
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome" className="input-base flex-1" />
            <button onClick={handleAdd} className="btn btn-primary py-2 px-3"><Plus size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============== Pagina principal ===============
export default function TasksPage() {
  const navigate = useNavigate();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();
  const { user: currentUser } = useAuthStore();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(globalSearchQuery || '');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [onlyMine, setOnlyMine] = useState(false);

  const [view, setView] = useState<'list' | 'calendar' | 'kanban' | 'agenda'>(() => (localStorage.getItem('kommo:tasks-view') as any) || 'list');
  const [monthDate, setMonthDate] = useState(new Date());

  const [adding, setAdding] = useState(false);
  const [initialDate, setInitialDate] = useState<string | undefined>();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showTagsManager, setShowTagsManager] = useState(false);

  // Selecao multipla
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState<string>('');

  useEffect(() => { localStorage.setItem('kommo:tasks-view', view); }, [view]);
  useEffect(() => setSearch(globalSearchQuery || ''), [globalSearchQuery]);

  const loadAll = () => {
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/leads?limit=500').then(({ data }) => setLeads(data.leads || [])).catch(() => {});
    api.get('/tags').then(({ data }) => setTags(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/pipelines').then(({ data }) => setPipelines(Array.isArray(data) ? data : [])).catch(() => {});
  };
  useEffect(loadAll, []);

  const loadTags = () => api.get('/tags').then(({ data }) => setTags(Array.isArray(data) ? data : [])).catch(() => {});

  const loadTasks = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('type', typeFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (assigneeFilter) params.set('assignedToId', assigneeFilter);
    if (tagFilter) params.set('tagId', tagFilter);
    params.set('parentOnly', 'true');
    setLoading(true);
    api.get(`/tasks?${params.toString()}`)
      .then(({ data }) => setTasks(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Erro a carregar tarefas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTasks();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, typeFilter, priorityFilter, assigneeFilter, tagFilter]);

  // Aplica filtros lado-cliente: data e Minhas
  const filteredTasks = useMemo(() => {
    let arr = tasks;
    arr = applyDateFilter(arr, dateFilter);
    if (onlyMine && currentUser?.id) arr = arr.filter((t) => t.assignedTo?.id === currentUser.id);
    return arr;
  }, [tasks, dateFilter, onlyMine, currentUser]);

  const handleToggleComplete = async (t: Task) => {
    try {
      const newStatus = t.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
      const { data } = await api.patch(`/tasks/${t.id}`, { status: newStatus });
      setTasks((prev) => prev.map((x) => (x.id === t.id ? data : x)));
      // Se era recorrente, recarregar para apanhar a nova ocorrencia
      if (newStatus === 'COMPLETED' && t.recurrence) {
        setTimeout(loadTasks, 300);
      }
    } catch { toast.error('Erro'); }
  };

  const handleDelete = async (t: Task) => {
    if (!confirm(`Eliminar a tarefa "${t.title}"?`)) return;
    try {
      await api.delete(`/tasks/${t.id}`);
      setTasks((prev) => prev.filter((x) => x.id !== t.id));
      toast.success('Eliminada');
    } catch { toast.error('Erro'); }
  };

  const resetFilters = () => {
    setSearch(''); setGlobalSearchQuery('');
    setStatusFilter(''); setTypeFilter(''); setPriorityFilter('');
    setAssigneeFilter(''); setDateFilter(''); setTagFilter('');
    setOnlyMine(false);
  };

  // Bulk
  const toggleSelect = (id: string) => {
    setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const allSelected = filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.id));
  const someSelected = !allSelected && filteredTasks.some((t) => selectedIds.has(t.id));
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
  };
  const selectedArray = Array.from(selectedIds);

  const handleBulkComplete = async () => {
    try {
      await api.post('/tasks/bulk-complete', { ids: selectedArray });
      toast.success(`${selectedArray.length} concluidas`);
      setSelectedIds(new Set());
      loadTasks();
    } catch { toast.error('Erro'); }
  };
  const handleBulkDelete = async () => {
    if (!confirm(`Eliminar ${selectedArray.length} tarefas?`)) return;
    try {
      await api.post('/tasks/bulk-delete', { ids: selectedArray });
      setTasks((p) => p.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
      toast.success('Eliminadas');
    } catch { toast.error('Erro'); }
  };
  const handleBulkAssign = async () => {
    if (!bulkAssignee) return;
    try {
      await api.post('/tasks/bulk-assign', { ids: selectedArray, assignedToId: bulkAssignee });
      toast.success('Reatribuidas');
      setSelectedIds(new Set()); setBulkAssignee('');
      loadTasks();
    } catch { toast.error('Erro'); }
  };

  const handleExportCSV = () => {
    if (filteredTasks.length === 0) return toast.error('Nada para exportar');
    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = ['Titulo', 'Tipo', 'Estado', 'Prioridade', 'Data limite', 'Responsavel', 'Lead', 'Tags', 'Recorrencia', 'Criada em'];
    const rows = filteredTasks.map((t: any) => [
      t.title || '', TYPE_LABELS[t.type] || t.type, STATUS_LABELS[t.status] || t.status,
      PRIORITY_LABELS[t.priority] || t.priority,
      t.dueAt ? new Date(t.dueAt).toLocaleString('pt-PT') : '',
      t.assignedTo?.name || '', t.lead?.title || '',
      (t.tags || []).map((tt: any) => tt.tag?.name).filter(Boolean).join(';'),
      RECURRENCE_LABELS[t.recurrence || ''] || '',
      t.createdAt ? new Date(t.createdAt).toLocaleString('pt-PT') : '',
    ].map(escape).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${filteredTasks.length} exportadas`);
  };

  // Drag-and-drop no calendario muda data
  const handleTaskMoved = async (taskId: string, newDateKey: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const oldDate = t.dueAt ? new Date(t.dueAt) : new Date();
    const newDate = new Date(newDateKey + 'T' + (t.dueAt ? new Date(t.dueAt).toTimeString().slice(0, 8) : '09:00:00'));
    setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: newDate.toISOString() } : x)));
    try {
      await api.patch(`/tasks/${taskId}`, { dueAt: newDate.toISOString() });
      toast.success('Data alterada');
    } catch {
      setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: oldDate.toISOString() } : x)));
      toast.error('Erro');
    }
  };

  // Mover tarefa para coluna da agenda (atrasada/hoje/amanha/etc)
  const handleAgendaMove = async (taskId: string, newDate: Date) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const oldDate = t.dueAt ? new Date(t.dueAt) : null;
    setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: newDate.toISOString() } : x)));
    try {
      await api.patch(`/tasks/${taskId}`, { dueAt: newDate.toISOString() });
      toast.success('Data alterada');
    } catch {
      setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: oldDate?.toISOString() || null } : x)));
      toast.error('Erro');
    }
  };

  // Mudar etapa do lead associado a uma tarefa
  const handleChangeLeadStage = async (taskId: string, stageId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || !t.lead) return;
    try {
      await api.patch(`/leads/${t.lead.id}/move`, { stageId });
      toast.success('Etapa do lead alterada');
      // Recarregar tarefas para reflectir lead actualizado
      loadTasks();
    } catch {
      toast.error('Erro ao mudar etapa');
    }
  };

  const handleChangeStatus = async (taskId: string, status: string) => {
    try {
      const { data } = await api.patch(`/tasks/${taskId}`, { status });
      setTasks((p) => p.map((x) => (x.id === taskId ? data : x)));
      toast.success('Estado alterado');
    } catch { toast.error('Erro'); }
  };

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const pending = filteredTasks.filter((t) => t.status === 'PENDING').length;
    const overdue = filteredTasks.filter(isOverdue).length;
    const completed = filteredTasks.filter((t) => t.status === 'COMPLETED').length;
    return { total, pending, overdue, completed };
  }, [filteredTasks]);

  const hasFilters = !!(search || statusFilter || typeFilter || priorityFilter || assigneeFilter || dateFilter || tagFilter || onlyMine);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Tarefas</h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{stats.total} total</span>
        {stats.overdue > 0 && (
          <span className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1" style={{ background: '#FEE2E2', color: '#991B1B' }}>
            <AlertCircle size={12} /> {stats.overdue} atrasada{stats.overdue !== 1 ? 's' : ''}
          </span>
        )}
        <span className="text-xs px-2 py-1 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>{stats.pending} pendentes</span>
        <span className="text-xs px-2 py-1 rounded" style={{ background: '#D1FAE5', color: '#065F46' }}>{stats.completed} concluidas</span>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowTagsManager(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <TagsIcon size={14} /> Tags
          </button>
          <button onClick={handleExportCSV} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Download size={14} /> Exportar
          </button>
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['list', 'agenda', 'calendar', 'kanban'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs flex items-center gap-1"
                style={{ background: view === v ? 'var(--primary)' : 'var(--surface)', color: view === v ? '#fff' : 'var(--text-primary)' }}>
                {v === 'list' && <><ListIcon size={12} /> Lista</>}
                {v === 'agenda' && <><Clock size={12} /> Agenda</>}
                {v === 'calendar' && <><CalIcon size={12} /> Calendario</>}
                {v === 'kanban' && <><Layout size={12} /> Kanban</>}
              </button>
            ))}
          </div>
          <button onClick={() => { setInitialDate(undefined); setAdding(true); }} className="btn btn-primary py-2 px-3">
            <Plus size={14} /> Nova Tarefa
          </button>
        </div>
      </div>

      {/* Filtros rapidos de data */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {([
          { v: '', label: 'Todas' },
          { v: 'today', label: 'Hoje' },
          { v: 'week', label: 'Esta semana' },
          { v: '7days', label: 'Proximos 7 dias' },
          { v: 'overdue', label: 'Atrasadas' },
          { v: 'noDate', label: 'Sem data' },
        ] as Array<{ v: DateFilter; label: string }>).map((opt) => (
          <button key={opt.v} onClick={() => setDateFilter(opt.v)} className="text-xs px-2 py-1 rounded font-medium"
            style={{ background: dateFilter === opt.v ? 'var(--primary)' : 'var(--surface-3)', color: dateFilter === opt.v ? '#fff' : 'var(--text-secondary)' }}>
            {opt.label}
          </button>
        ))}
        <div className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
        <button onClick={() => setOnlyMine(!onlyMine)} className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1"
          style={{ background: onlyMine ? 'var(--primary)' : 'var(--surface-3)', color: onlyMine ? '#fff' : 'var(--text-secondary)' }}>
          <UserIcon size={11} /> Minhas
        </button>
      </div>

      {/* Filtros detalhados (so na vista lista) */}
      {view === 'list' && (
        <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div className="relative" style={{ minWidth: 200, flex: '1 1 200px' }}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." className="input-base" style={{ paddingLeft: 32 }} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Toda prioridade</option>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos tipos</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos responsaveis</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todas tags</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {hasFilters && (
            <button onClick={resetFilters} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              <RotateCcw size={14} /> Limpar
            </button>
          )}
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedArray.length > 0 && view === 'list' && (
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: 'var(--primary-light)', borderBottom: '1px solid var(--border)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>{selectedArray.length} seleccionada(s)</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>Limpar</button>
          <span className="ml-auto flex items-center gap-2">
            <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} className="input-base" style={{ padding: '4px 8px', fontSize: 12 }}>
              <option value="">Reatribuir a...</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button onClick={handleBulkAssign} disabled={!bulkAssignee} className="btn py-1 px-2 text-xs" style={{ background: 'var(--primary)', color: '#fff', opacity: bulkAssignee ? 1 : 0.5 }}>Aplicar</button>
            <button onClick={handleBulkComplete} className="btn py-1 px-2 text-xs" style={{ background: '#D1FAE5', color: '#065F46' }}>
              <Check size={12} /> Concluir
            </button>
            <button onClick={handleBulkDelete} className="btn py-1 px-2 text-xs" style={{ background: '#FEF2F2', color: '#EF4444' }}>
              <Trash2 size={12} /> Eliminar
            </button>
          </span>
        </div>
      )}

      {/* Conteudo */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
        ) : view === 'calendar' ? (
          <CalendarView
            tasks={filteredTasks}
            monthDate={monthDate}
            onPrev={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
            onNext={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
            onToday={() => setMonthDate(new Date())}
            onCreateAt={(date) => { setInitialDate(date); setAdding(true); }}
            onEdit={(t) => setEditing(t)}
            onTaskMoved={handleTaskMoved}
          />
        ) : view === 'kanban' ? (
          <KanbanView tasks={filteredTasks} onEdit={(t) => setEditing(t)} />
        ) : view === 'agenda' ? (
          <AgendaView
            tasks={filteredTasks}
            pipelines={pipelines}
            onEdit={(t) => setEditing(t)}
            onTaskMoved={handleAgendaMove}
            onChangeStage={handleChangeLeadStage}
            onChangeStatus={handleChangeStatus}
          />
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <CalIcon size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{hasFilters ? 'Nenhuma tarefa corresponde aos filtros' : 'Sem tarefas ainda'}</p>
            {!hasFilters && (
              <button onClick={() => setAdding(true)} className="btn btn-primary mt-3 py-2 px-4">
                <Plus size={14} /> Criar primeira tarefa
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="w-8 px-3 py-2">
                  <button onClick={toggleSelectAll}>
                    {allSelected ? <CheckSquare size={16} /> : someSelected ? <MinusSquare size={16} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </th>
                <th className="w-8 px-3 py-2"></th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Titulo</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Prio.</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Tipo</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Estado</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Data</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Responsavel</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Lead</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Tags</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Accoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => {
                const overdue = isOverdue(t);
                const done = t.status === 'COMPLETED';
                const Icon = TYPE_ICONS[t.type] || Circle;
                const subDone = (t.subtasks || []).filter((s: any) => s.status === 'COMPLETED').length;
                const subTotal = (t.subtasks || []).length;
                return (
                  <tr key={t.id} className="hover:bg-slate-50" style={{ borderBottom: '1px solid var(--border)', background: selectedIds.has(t.id) ? 'var(--primary-light)' : overdue ? '#FEF2F2' : undefined }}>
                    <td className="px-3 py-2">
                      <button onClick={() => toggleSelect(t.id)}>
                        {selectedIds.has(t.id) ? <CheckSquare size={16} style={{ color: 'var(--primary)' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => handleToggleComplete(t)} className="w-5 h-5 rounded border flex items-center justify-center"
                        style={{ background: done ? '#10B981' : 'transparent', borderColor: done ? '#10B981' : 'var(--border)' }}>
                        {done && <Check size={12} style={{ color: '#fff' }} />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => setEditing(t)} className="text-left hover:underline">
                        <span style={{ color: 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{t.title}</span>
                      </button>
                      {t.recurrence && <Repeat size={11} className="inline ml-2" style={{ color: 'var(--text-muted)' }} />}
                      {subTotal > 0 && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                          {subDone}/{subTotal}
                        </span>
                      )}
                      {overdue && !done && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#FEE2E2', color: '#991B1B' }}>Atrasada</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Flag size={11} style={{ color: PRIORITY_COLORS[t.priority] }} />
                        <span style={{ color: PRIORITY_COLORS[t.priority] }}>{PRIORITY_LABELS[t.priority]}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <Icon size={12} /> {TYPE_LABELS[t.type]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{ background: STATUS_COLORS[t.status]?.bg, color: STATUS_COLORS[t.status]?.fg }}>
                        {STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: overdue && !done ? '#991B1B' : 'var(--text-secondary)' }}>
                      {t.dueAt ? new Date(t.dueAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{t.assignedTo?.name || '—'}</td>
                    <td className="px-3 py-2">
                      {t.lead ? (
                        <button onClick={() => navigate(`/pipeline?leadId=${t.lead!.id}`)} className="flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--primary)' }}>
                          {t.lead.title} <ExternalLink size={11} />
                        </button>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(t.tags || []).map((tt: any) => tt.tag && (
                          <span key={tt.tag.id} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: tt.tag.color + '22', color: tt.tag.color }}>
                            {tt.tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(t)} className="p-1.5 rounded hover:bg-slate-100"><Edit3 size={14} style={{ color: 'var(--text-secondary)' }} /></button>
                        <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50"><Trash2 size={14} style={{ color: '#EF4444' }} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <TaskFormModal
          users={users} leads={leads} tags={tags}
          initialDate={initialDate}
          onClose={() => { setAdding(false); setInitialDate(undefined); }}
          onSaved={(t) => setTasks((prev) => [...prev, t])}
          onTagsChanged={loadTags}
        />
      )}
      {editing && (
        <TaskFormModal
          task={editing} users={users} leads={leads} tags={tags}
          onClose={() => setEditing(null)}
          onSaved={(t) => setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)))}
          onTagsChanged={loadTags}
        />
      )}
      {showTagsManager && (
        <ManageTagsModal tags={tags} onClose={() => setShowTagsManager(false)} onChanged={loadTags} />
      )}
    </div>
  );
}
