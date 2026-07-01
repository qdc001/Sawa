import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useDroppable, useDraggable, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, Check, Calendar as CalIcon,
  List as ListIcon, RotateCcw, AlertCircle, ExternalLink, Download, Upload,
  Phone, Mail, Users as UsersIcon, Repeat, Briefcase, Circle,
  ChevronLeft, ChevronRight, CheckSquare, Square, MinusSquare,
  Tags as TagsIcon, Layout, Flag, Clock, User as UserIcon, MessageSquare, FileSpreadsheet,
} from 'lucide-react';
import api, {
  Task, User, Lead, Tag as TagType, Pipeline, Stage, TaskOption,
  DEFAULT_TASK_TYPES, DEFAULT_TASK_PRIORITIES, DEFAULT_TASK_STATUSES, DEFAULT_TASK_RECURRENCES, DEFAULT_TASK_TITLES,
} from '../lib/api';
import toast from 'react-hot-toast';
import { useUIStore } from '../store';
import { useAuthStore } from '../store';
import { useTaskOptions } from '../lib/taskOptions';
import { useDragScroll, useScrollButton } from '../lib/useDragScroll';
import MouseSettingsButton from '../components/MouseSettingsButton';
import ChatPreviewModal from '../components/ChatPreviewModal';
import TaskConflictDialog, { ExistingTask as ConflictTask } from '../components/TaskConflictDialog';

// Ícones associados a tipos predefinidos. Opções custom (criadas em Definições) caem para Circle.
const TYPE_ICONS: Record<string, any> = {
  CALL: Phone, EMAIL: Mail, MEETING: UsersIcon,
  FOLLOW_UP: Repeat, DEMO: Briefcase, OTHER: Circle,
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

// =============== Lead Search Picker (pesquisa em vez de dropdown longo) ===============
function LeadSearchPicker({ leads, value, onChange }: { leads: Lead[]; value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const selected = leads.find((l) => l.id === value);
  const filtered = search.trim()
    ? leads.filter((l) =>
        l.title.toLowerCase().includes(search.toLowerCase()) ||
        (l.contact && `${l.contact.firstName} ${l.contact.lastName || ''}`.toLowerCase().includes(search.toLowerCase()))
      ).slice(0, 20)
    : leads.slice(0, 20);

  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
        <span className="text-sm flex-1 truncate">{selected.title}</span>
        <button type="button" onClick={() => onChange('')} className="p-1 rounded hover:bg-red-50">
          <X size={12} style={{ color: '#EF4444' }} />
        </button>
        <button type="button" onClick={() => setOpen(true)} className="text-xs underline" style={{ color: 'var(--primary)' }}>
          mudar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Pesquisar lead por título ou contacto..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        className="input-base"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full card max-h-56 overflow-y-auto" style={{ background: 'var(--surface)' }}>
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 italic"
            style={{ color: 'var(--text-muted)' }}
          >
            — Nenhum —
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Sem resultados</p>
          ) : (
            filtered.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => { onChange(l.id); setOpen(false); setSearch(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
              >
                <p className="font-medium">{l.title}</p>
                {l.contact && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {l.contact.firstName} {l.contact.lastName || ''}
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =============== ColoredSelect: dropdown com chip colorido por opção ===============
function ColoredSelect({ value, options, onChange, placeholder }: {
  value: string;
  options: TaskOption[];
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-base w-full flex items-center justify-between gap-2 text-left"
        style={{ minHeight: 38 }}
      >
        <span className="flex items-center gap-2 min-w-0">
          {current?.color && (
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ background: current.color, boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
            />
          )}
          <span className="truncate" style={{ color: current ? 'var(--text-primary)' : 'var(--text-muted)' }}>
            {current?.label || placeholder || '— Selecionar —'}
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>▾</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg shadow-lg max-h-60 overflow-y-auto"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              style={{ color: 'var(--text-primary)' }}
            >
              {o.color ? (
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: o.color, boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
                />
              ) : (
                <span className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="text-sm flex-1">{o.label}</span>
              {value === o.value && <Check size={14} style={{ color: 'var(--primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Badge colorida que reaproveita a cor de uma TaskOption — usar em listas/kanban
export function TaskOptionBadge({ option, size = 'sm' }: { option?: TaskOption; size?: 'sm' | 'md' }) {
  if (!option) return null;
  const padding = size === 'md' ? 'px-2 py-1' : 'px-1.5 py-0.5';
  const fontSize = size === 'md' ? '12px' : '11px';
  const color = option.color || '#94A3B8';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${padding}`}
      style={{
        background: `${color}22`,
        color,
        fontSize,
        lineHeight: 1.2,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {option.label}
    </span>
  );
}

// =============== Modal: Nova/Editar Tarefa (versão simplificada) ===============
function TaskFormModalV2({
  task, users, leads, tags,
  onClose, onSaved, onTagsChanged, initialDate, onOpenExisting,
}: {
  task?: Task | null;
  users: User[];
  leads: Lead[];
  tags: TagType[];
  onClose: () => void;
  onSaved: (t: Task) => void;
  onTagsChanged: () => void;
  initialDate?: string;
  onOpenExisting?: (t: Task) => void;
}) {
  const isEdit = !!task?.id;
  const navigate = useNavigate();
  const { workspace } = useAuthStore();
  const wsTaskTypes = (workspace?.taskTypes && (workspace.taskTypes as any).length > 0) ? (workspace.taskTypes as any) : DEFAULT_TASK_TYPES;
  const wsTaskPriorities = (workspace?.taskPriorities && (workspace.taskPriorities as any).length > 0) ? (workspace.taskPriorities as any) : DEFAULT_TASK_PRIORITIES;
  const wsTaskStatuses = (workspace?.taskStatuses && (workspace.taskStatuses as any).length > 0) ? (workspace.taskStatuses as any) : DEFAULT_TASK_STATUSES;
  const wsTaskRecurrences = (workspace?.taskRecurrences && (workspace.taskRecurrences as any).length > 0) ? (workspace.taskRecurrences as any) : DEFAULT_TASK_RECURRENCES;
  const wsTaskTitles = ((workspace as any)?.taskTitles && ((workspace as any).taskTitles as any).length > 0) ? ((workspace as any).taskTitles as any) : DEFAULT_TASK_TITLES;
  const wsLabels = ((workspace as any)?.taskFieldLabels || {}) as any;
  const L = {
    title: wsLabels.title || 'Título',
    description: wsLabels.description || 'Descrição',
    type: wsLabels.type || 'Tipo',
    priority: wsLabels.priority || 'Prioridade',
    dueAt: wsLabels.dueAt || 'Data e hora limite',
    assignee: wsLabels.assignee || 'Responsável',
    contact: wsLabels.contact || 'Contacto associado',
  };
  const [title, setTitle] = useState(task?.title || wsTaskTitles[0]?.value || '');
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
  const [contactId, setContactId] = useState((task as any)?.contactId || (task?.contact as any)?.id || '');
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<{ id: string; firstName: string; lastName?: string }[]>([]);
  const [contactObj, setContactObj] = useState<any>(task?.contact || null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(task?.tags?.map((t: any) => t.tag?.id).filter(Boolean) || []);
  const [subtasks, setSubtasks] = useState<Task[]>(task?.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [newSubtaskDue, setNewSubtaskDue] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState<ConflictTask | null>(null);

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const addSubtask = async () => {
    if (!newSubtask.trim() || !task?.id) return;
    try {
      const { data } = await api.post('/tasks', {
        title: newSubtask.trim(),
        parentTaskId: task.id,
        status: 'PENDING',
        dueAt: newSubtaskDue ? new Date(newSubtaskDue).toISOString() : null,
        assignedToId: task.assignedToId,
      });
      setSubtasks((p) => [...p, data]);
      setNewSubtask('');
      setNewSubtaskDue('');
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
    if (!title.trim()) { toast.error('Título obrigatório'); return; }
    setLoading(true);
    // Tarefa ligada apenas ao contacto. Estado/Recorrência/Tags/Subtarefas/Lead foram
    // removidos do form principal. Edição de estado faz-se via "Marcar concluída" no ViewTaskModal.
    const payload: any = {
      title, description, type, priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      assignedToId: assignedToId || undefined,
      contactId: contactId || null,
    };
    // Preservar estado/recorrência existentes ao editar
    if (isEdit) {
      payload.status = status;
      payload.recurrence = recurrence || null;
    }
    try {
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
      if (err.response?.status === 409 && err.response?.data?.existingTask) {
        setConflict(err.response.data.existingTask as ConflictTask);
      } else {
        toast.error(err.response?.data?.message || 'Erro a guardar');
      }
    } finally { setLoading(false); }
  };

  const subDone = subtasks.filter((s) => s.status === 'COMPLETED').length;

  return (
    <>
    {conflict && (
      <TaskConflictDialog
        existingTask={conflict}
        onCancel={() => setConflict(null)}
        onEditExisting={(t) => {
          setConflict(null);
          onClose();
          if (onOpenExisting) onOpenExisting(t as unknown as Task);
          else navigate(`/tarefas?editTask=${t.id}`);
        }}
      />
    )}
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? '⚡ Editar Tarefa' : '⚡ Nova Tarefa'}
          </h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.title} *</label>
            <ColoredSelect value={title} options={wsTaskTitles} onChange={(v) => setTitle(v)} placeholder={`Escolhe ${L.title.toLowerCase()}`} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.description}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" rows={2} />
          </div>
          <div className="flex items-center justify-between -mb-1">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Edita/personaliza as opções (cores, etiquetas, ordem) em Definições
            </span>
            <button
              type="button"
              onClick={() => { onClose(); navigate('/settings?tab=workspace#task-options'); }}
              className="text-[11px] underline"
              style={{ color: 'var(--primary)' }}
            >
              Abrir Definições
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.type}</label>
              <ColoredSelect value={type} options={wsTaskTypes} onChange={(v) => setType(v as any)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.priority}</label>
              <ColoredSelect value={priority} options={wsTaskPriorities} onChange={(v) => setPriority(v as any)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.dueAt}</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.assignee}</label>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base">
              <option value="">— Eu —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{L.contact}</label>
            {contactObj ? (
              <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
                <UserIcon size={14} style={{ color: 'var(--primary)' }} />
                <span className="text-sm flex-1">{contactObj.firstName} {contactObj.lastName || ''}</span>
                <button type="button" onClick={() => { setContactObj(null); setContactId(''); }} className="p-1 rounded hover:bg-red-50">
                  <X size={12} style={{ color: '#EF4444' }} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={contactSearch}
                  onChange={async (e) => {
                    const v = e.target.value;
                    setContactSearch(v);
                    if (v.trim().length >= 1) {
                      try {
                        const { data } = await api.get(`/contacts?search=${encodeURIComponent(v)}&limit=50`);
                        setContactResults(data.contacts || []);
                      } catch { setContactResults([]); }
                    } else setContactResults([]);
                  }}
                  onFocus={async () => {
                    if (!contactSearch.trim() && contactResults.length === 0) {
                      try {
                        const { data } = await api.get('/contacts?limit=50');
                        setContactResults(data.contacts || []);
                      } catch {}
                    }
                  }}
                  placeholder="Procurar contacto por nome ou telefone..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  className="input-base"
                />
                {contactResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full card max-h-48 overflow-y-auto" style={{ background: 'var(--surface)' }}>
                    {contactResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setContactObj(c);
                          setContactId(c.id);
                          setContactSearch('');
                          setContactResults([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100"
                      >
                        {c.firstName} {c.lastName || ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : isEdit ? 'Guardar' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}

// =============== Componentes Drag-Drop Calendário ===============
function DraggableTaskBadge({ task, onClick }: { task: Task; onClick: () => void }) {
  const { lookupPriority } = useTaskOptions();
  const prio = lookupPriority(task.priority);
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
        borderLeft: `3px solid ${prio.color || '#94A3B8'}`,
      }}
      title={`${task.title} · ${prio.label}`}
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

// =============== Vista Calendário ===============
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
  task, pipelines, onEdit, onChangeStage, onChangeStatus, onPreviewChat,
}: {
  task: Task;
  pipelines: Pipeline[];
  onEdit: () => void;
  onChangeStage: (stageId: string) => void;
  onChangeStatus: (status: string) => void;
  onPreviewChat: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const { lookupType, lookupPriority } = useTaskOptions();
  const typeOpt = lookupType(task.type);
  const prio = lookupPriority(task.priority);
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
        borderLeft: `3px solid ${prio.color || '#94A3B8'}`,
        marginBottom: 8,
      }}
    >
      {(task.lead || task.contact) && (
        <div className="text-xs font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--primary)' }}>
          <span className="truncate flex-1">
            {task.lead?.title || (task.contact ? `${task.contact.firstName} ${task.contact.lastName || ''}`.trim() : '')}
          </span>
          {(task.lead?.id || task.contact?.id) && (
            <button
              onClick={(e) => { e.stopPropagation(); onPreviewChat(task); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded hover:bg-white/20 flex-shrink-0"
              title="Pré-visualizar conversa"
            >
              <MessageSquare size={11} />
            </button>
          )}
        </div>
      )}

      <button onClick={onEdit} className="text-left w-full block">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
      </button>

      {task.description && (
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
      )}

      <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: overdue ? '#991B1B' : 'var(--text-secondary)' }}>
        <Icon size={11} style={{ color: typeOpt.color || undefined }} />
        <span>{typeOpt.label}</span>
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
  col, label, color, tasks, pipelines, onEdit, onChangeStage, onChangeStatus, onPreviewChat,
}: {
  col: AgendaCol;
  label: string;
  color: string;
  tasks: Task[];
  pipelines: Pipeline[];
  onEdit: (t: Task) => void;
  onPreviewChat: (t: Task) => void;
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
            onPreviewChat={onPreviewChat}
          />
        ))}
      </div>
    </div>
  );
}

function AgendaView({
  tasks, pipelines, onEdit, onTaskMoved, onChangeStage, onChangeStatus, onPreviewChat,
}: {
  tasks: Task[];
  pipelines: Pipeline[];
  onEdit: (t: Task) => void;
  onTaskMoved: (taskId: string, newDate: Date) => void;
  onChangeStage: (taskId: string, stageId: string) => void;
  onChangeStatus: (taskId: string, status: string) => void;
  onPreviewChat: (t: Task) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const { lookupPriority } = useTaskOptions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollButton] = useScrollButton();
  useDragScroll(scrollRef, scrollButton);

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
      <div ref={scrollRef} className="flex gap-3 p-4 h-full overflow-auto">
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
            onPreviewChat={onPreviewChat}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="card p-3 shadow-xl" style={{ borderLeft: `3px solid ${lookupPriority(activeTask.priority).color || '#94A3B8'}` }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{activeTask.title}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// =============== Vista Kanban ===============
function KanbanView({ tasks, onEdit }: { tasks: Task[]; onEdit: (t: Task) => void }) {
  const { statuses, lookupPriority } = useTaskOptions();
  const cols = statuses;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollButton] = useScrollButton();
  useDragScroll(scrollRef, scrollButton);
  return (
    <div ref={scrollRef} className="flex gap-3 p-4 h-full overflow-auto">
      {cols.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.value);
        const colColor = col.color || 'var(--text-secondary)';
        const bg = col.color ? `${col.color}22` : 'var(--surface-3)';
        return (
          <div key={col.value} className="flex flex-col flex-shrink-0 w-72">
            <div className="p-3 rounded-t-lg flex items-center justify-between" style={{ background: bg, borderTop: `3px solid ${colColor}` }}>
              <span className="font-medium text-sm" style={{ color: colColor }}>{col.label}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: colColor, color: '#fff' }}>{colTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 rounded-b-lg space-y-2" style={{ background: 'var(--surface-2)', minHeight: 200 }}>
              {colTasks.map((t) => {
                const overdue = isOverdue(t);
                const Icon = TYPE_ICONS[t.type] || Circle;
                const prio = lookupPriority(t.priority);
                return (
                  <button key={t.id} onClick={() => onEdit(t)} className="card p-3 text-left w-full hover:shadow-md transition-shadow"
                    style={{ borderLeft: `3px solid ${prio.color || '#94A3B8'}` }}>
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
  const [newColor, setNewColor] = useState('#C8553D');
  useEffect(() => setList(tags), [tags]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      const { data } = await api.post('/tags', { name: newName.trim(), color: newColor });
      setList((p) => [...p, data]);
      setNewName(''); setNewColor('#C8553D');
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

// =============== Modal: Importar tarefas (CSV ou .ics do Kommo) ===============
function ImportTasksModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'csv' | 'ics' | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [delim, setDelim] = useState<',' | ';'>(',');
  const [icsTasks, setIcsTasks] = useState<any[]>([]);

  // Parser de iCalendar (.ics) — devolve já no formato esperado por /tasks/bulk-import
  const parseICS = (text: string): any[] => {
    // 1) Line unfolding: linhas que começam com espaço/tab pertencem à anterior
    const unfolded: string[] = [];
    text.split(/\r?\n/).forEach((line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
        unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    });

    // 2) Agrupar VEVENTs
    const events: Record<string, string>[] = [];
    let current: Record<string, string> | null = null;
    for (const line of unfolded) {
      if (line === 'BEGIN:VEVENT') current = {};
      else if (line === 'END:VEVENT') { if (current) events.push(current); current = null; }
      else if (current) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        // Chave pode ter parâmetros: DTSTART;TZID=...
        const keyPart = line.slice(0, colon);
        const key = keyPart.split(';')[0].toUpperCase();
        const val = line.slice(colon + 1);
        current[key] = val;
      }
    }

    // 3) Mapear cada VEVENT para o formato do bulk-import
    const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
    const parseIcsDate = (raw: string): Date | null => {
      if (!raw) return null;
      // Formatos: YYYYMMDDTHHMMSSZ  (UTC)  ou  YYYYMMDD  (só data)
      const utcMatch = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
      if (utcMatch) {
        const [, y, mo, d, h, mi, s] = utcMatch;
        return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
      }
      const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (dateOnly) {
        const [, y, mo, d] = dateOnly;
        return new Date(+y, +mo - 1, +d, 9, 0);
      }
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    return events.map((ev) => {
      const summary = unescape(ev.SUMMARY || '');
      const description = unescape(ev.DESCRIPTION || '');
      const contactRaw = unescape(ev.CONTACT || '');
      const start = parseIcsDate(ev.DTSTART || '');

      // SUMMARY do Kommo: "Chamada, relacionadas com" | "Reunião, relacionada a" | "Tarefas, relacionadas a"
      const type = summary.split(',')[0].trim();

      // Título = primeira linha útil da descrição (antes do "\n . Contato:")
      let title = description.split(/\n\s*\.\s*Contato:/i)[0].trim();
      // Remove sufixo " - Nome" no fim (autor) se ficar muito comprido
      if (!title) title = summary || 'Tarefa';
      // Limitar a 200 chars
      if (title.length > 200) title = title.slice(0, 197) + '...';

      // Contacto: "Contato: Gilda das Neves" → "Gilda das Neves"
      const contact = contactRaw.replace(/^\.?\s*Contato:\s*/i, '').trim();

      // Tentar extrair telefone do CONTACT ou da DESCRIPTION (formatos comuns: +258..., 258..., 8X XXX XXXX)
      const phoneRegex = /(\+?\d[\d\s().-]{6,}\d)/g;
      const haystack = `${contactRaw} ${description}`;
      let contactPhone: string | null = null;
      const phoneMatch = haystack.match(phoneRegex);
      if (phoneMatch) {
        // pegar a sequência mais longa que pareça telefone (≥ 9 dígitos)
        for (const candidate of phoneMatch) {
          const digits = candidate.replace(/\D/g, '');
          if (digits.length >= 9 && digits.length <= 15) { contactPhone = digits; break; }
        }
      }

      return {
        title,
        description: description || null,
        type,
        dueAt: start ? start.toISOString() : null,
        contact: contact || null,
        contactPhone,
        status: 'PENDING',
      };
    }).filter((t) => t.title);
  };

  const TARGET_FIELDS = [
    { key: 'title', label: 'Título / Texto *' },
    { key: 'description', label: 'Descrição' },
    { key: 'dueAt', label: 'Data limite' },
    { key: 'type', label: 'Tipo (Chamada/Reunião/...)' },
    { key: 'status', label: 'Estado' },
    { key: 'priority', label: 'Prioridade' },
    { key: 'responsibleUser', label: 'Responsável (nome ou email)' },
    { key: 'contact', label: 'Contacto (nome)' },
    { key: 'contactPhone', label: 'Telefone do contacto' },
    { key: 'lead', label: 'Lead (título)' },
  ];

  const parseCSV = (text: string, sep: string): string[][] => {
    const result: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === sep) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (cell !== '' || row.length > 0) { row.push(cell); result.push(row); row = []; cell = ''; }
          if (ch === '\r' && next === '\n') i++;
        } else cell += ch;
      }
    }
    if (cell !== '' || row.length > 0) { row.push(cell); result.push(row); }
    return result.filter((r) => r.some((c) => c.trim() !== ''));
  };

  const handleFile = async (f: File, sep: string = delim) => {
    setFile(f);
    let text = await f.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // Detectar ICS (extensão .ics ou conteúdo BEGIN:VCALENDAR)
    const isIcs = /\.ics$/i.test(f.name) || /^BEGIN:VCALENDAR/m.test(text.slice(0, 200));
    if (isIcs) {
      setMode('ics');
      const tasks = parseICS(text);
      setIcsTasks(tasks);
      if (tasks.length === 0) toast.error('Nenhuma tarefa encontrada no .ics');
      return;
    }

    setMode('csv');
    // Detectar separador auto se primeira linha tem ; mas não tem ,
    let chosen = sep;
    const firstLine = text.split('\n')[0] || '';
    if (firstLine.includes(';') && !firstLine.includes(',')) { chosen = ';'; setDelim(';'); }
    const parsed = parseCSV(text, chosen);
    if (parsed.length === 0) { toast.error('CSV vazio'); return; }
    const hdrs = parsed[0].map((h) => h.trim());
    setHeaders(hdrs);
    setPreviewRows(parsed.slice(1, 6));
    // Auto-map (PT + EN + Kommo)
    const auto: Record<string, string> = {};
    TARGET_FIELDS.forEach(({ key }) => {
      const lowered = hdrs.map((h) => h.toLowerCase());
      const find = (...needles: string[]) => {
        for (const n of needles) {
          const idx = lowered.findIndex((h) => h === n || h.includes(n));
          if (idx >= 0) return hdrs[idx];
        }
        return undefined;
      };
      let found: string | undefined;
      if (key === 'title') found = find('título', 'título', 'title', 'texto', 'text', 'tarefa', 'task name', 'subject');
      else if (key === 'description') found = find('descrição', 'descrição', 'description', 'notas', 'notes');
      else if (key === 'dueAt') found = find('complete till', 'data limite', 'due date', 'due_at', 'data', 'deadline', 'date');
      else if (key === 'type') found = find('tipo', 'type', 'task type');
      else if (key === 'status') found = find('estado', 'status');
      else if (key === 'priority') found = find('prioridade', 'priority');
      else if (key === 'responsibleUser') found = find('responsável', 'responsável', 'responsible', 'assignee', 'owner');
      else if (key === 'contact') found = find('contacto', 'contato', 'contact');
      else if (key === 'contactPhone') found = find('telefone', 'phone');
      else if (key === 'lead') found = find('lead', 'deal', 'negócio', 'negócio');
      if (found) auto[key] = found;
    });
    setMapping(auto);
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      let tasks: any[];
      if (mode === 'ics') {
        tasks = icsTasks;
        if (!tasks.length) { toast.error('Sem tarefas para importar'); setLoading(false); return; }
      } else {
        if (!mapping.title) { toast.error('Mapeia o campo Título'); setLoading(false); return; }
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const parsed = parseCSV(text, delim);
        const all = parsed.slice(1);
        const idx: Record<string, number> = {};
        Object.keys(mapping).forEach((k) => { idx[k] = headers.indexOf(mapping[k]); });
        tasks = all.map((r) => {
          const obj: any = {};
          Object.keys(idx).forEach((k) => { if (idx[k] >= 0) obj[k] = r[idx[k]]; });
          return obj;
        }).filter((t) => t.title);
      }

      const { data } = await api.post('/tasks/bulk-import', { tasks });
      toast.success(`${data.created} tarefas importadas (${data.skipped} ignoradas de ${data.total})`);
      onImported();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a importar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Importar tarefas</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
          Aceita <strong>.ics</strong> (formato exportado pelo Kommo em "Tarefas → Exportar") ou <strong>.csv</strong> com cabeçalhos.
          Para .ics, o mapeamento é automático (data, contacto, tipo).
        </p>

        {!file ? (
          <label className="block">
            <input type="file" accept=".csv,.ics,text/csv,text/calendar" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <div className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-slate-50" style={{ borderColor: 'var(--border)' }}>
              <FileSpreadsheet size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Clica para escolher um ficheiro</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>.ics (Kommo) ou .csv</p>
            </div>
          </label>
        ) : mode === 'ics' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{file.name} — <strong>{icsTasks.length} tarefas</strong> detectadas</span>
              <button onClick={() => { setFile(null); setMode(null); setIcsTasks([]); }} className="underline">trocar</button>
            </div>
            <div className="border rounded-lg max-h-80 overflow-y-auto text-xs" style={{ borderColor: 'var(--border)' }}>
              {icsTasks.slice(0, 50).map((t, i) => (
                <div key={i} className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</div>
                  <div className="flex gap-2 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    <span>{t.type || '—'}</span>
                    {t.dueAt && <span>• {new Date(t.dueAt).toLocaleDateString('pt-PT')}</span>}
                    {t.contact && <span>• {t.contact}</span>}
                  </div>
                </div>
              ))}
              {icsTasks.length > 50 && (
                <div className="p-2 text-center" style={{ color: 'var(--text-muted)' }}>... e mais {icsTasks.length - 50}</div>
              )}
            </div>
            <div className="text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
              As tarefas vão ser criadas com o teu user como responsável.
              Os contactos são ligados se já existirem no CRM (por nome). Senão a tarefa fica sem contacto associado.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{file.name} ({previewRows.length}+ linhas)</span>
              <button onClick={() => { setFile(null); setMode(null); setHeaders([]); setPreviewRows([]); setMapping({}); }} className="underline">trocar</button>
            </div>

            <div>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Mapeamento</p>
              <div className="grid grid-cols-2 gap-2">
                {TARGET_FIELDS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
                    <select
                      value={mapping[key] || ''}
                      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                      className="input-base text-xs py-1.5 w-full"
                    >
                      <option value="">(ignorar)</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
              Tarefas sem responsável correspondente ficam atribuídas a ti.
              Tipo/Estado/Prioridade são mapeados de PT/EN automaticamente.
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleImport} disabled={!file || loading || (mode === 'ics' && icsTasks.length === 0)} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : `Importar${mode === 'ics' ? ` ${icsTasks.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============== Página principal ===============
export default function TasksPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();
  const { user: currentUser } = useAuthStore();
  const taskOpts = useTaskOptions();

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
  const [previewChatTask, setPreviewChatTask] = useState<Task | null>(null);
  const [showTagsManager, setShowTagsManager] = useState(false);
  const [importing, setImporting] = useState(false);

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

  // Abrir tarefa em modo edit a partir de ?editTask=<id> (usado pelo TaskConflictDialog
  // vindo doutras paginas). Carrega a tarefa e limpa o query param.
  useEffect(() => {
    const editId = searchParams.get('editTask');
    if (!editId) return;
    api.get(`/tasks/${editId}`)
      .then(({ data }) => setEditing(data))
      .catch(() => toast.error('Nao foi possivel abrir a tarefa'))
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('editTask');
        setSearchParams(next, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      // Se era recorrente, recarregar para apanhar a nova ocorrência
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
    const headers = ['Título', 'Tipo', 'Estado', 'Prioridade', 'Data limite', 'Responsável', 'Lead', 'Tags', 'Recorrência', 'Criada em'];
    const rows = filteredTasks.map((t: any) => [
      t.title || '', taskOpts.lookupType(t.type).label, taskOpts.lookupStatus(t.status).label,
      taskOpts.lookupPriority(t.priority).label,
      t.dueAt ? new Date(t.dueAt).toLocaleString('pt-PT') : '',
      t.assignedTo?.name || '', t.lead?.title || '',
      (t.tags || []).map((tt: any) => tt.tag?.name).filter(Boolean).join(';'),
      taskOpts.lookupRecurrence(t.recurrence || '').label,
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

  // Drag-and-drop no calendário muda data
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
    const oldDueAt = t.dueAt;
    setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: newDate.toISOString() } : x)));
    try {
      await api.patch(`/tasks/${taskId}`, { dueAt: newDate.toISOString() });
      toast.success('Data alterada');
    } catch {
      setTasks((p) => p.map((x) => (x.id === taskId ? { ...x, dueAt: oldDueAt } : x)));
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
          <MouseSettingsButton />
          <button onClick={handleExportCSV} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Download size={14} /> Exportar
          </button>
          <div className="flex rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['list', 'agenda', 'calendar', 'kanban'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs flex items-center gap-1"
                style={{ background: view === v ? 'var(--primary)' : 'var(--surface)', color: view === v ? '#fff' : 'var(--text-primary)' }}>
                {v === 'list' && <><ListIcon size={12} /> Lista</>}
                {v === 'agenda' && <><Clock size={12} /> Agenda</>}
                {v === 'calendar' && <><CalIcon size={12} /> Calendário</>}
                {v === 'kanban' && <><Layout size={12} /> Kanban</>}
              </button>
            ))}
          </div>
          <button onClick={() => setImporting(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Importar tarefas (CSV do Kommo ou outro)">
            <Upload size={14} /> Importar
          </button>
          <button onClick={() => { setInitialDate(undefined); setAdding(true); }} className="btn btn-primary py-2 px-3">
            <Plus size={14} /> Nova Tarefa
          </button>
        </div>
      </div>

      {/* Filtros rápidos de data */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {([
          { v: '', label: 'Todas' },
          { v: 'today', label: 'Hoje' },
          { v: 'week', label: 'Esta semana' },
          { v: '7days', label: 'Próximos 7 dias' },
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

      {/* Filtros detalhados (só na vista lista) */}
      {view === 'list' && (
        <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div className="relative" style={{ minWidth: 200, flex: '1 1 200px' }}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className="input-base" style={{ paddingLeft: 32 }} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos estados</option>
            {taskOpts.statuses.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Toda prioridade</option>
            {taskOpts.priorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos tipos</option>
            {taskOpts.types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
            <option value="">Todos responsáveis</option>
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
            onPreviewChat={(t) => setPreviewChatTask(t)}
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
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Título</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Prio.</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Tipo</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Estado</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Data</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Responsável</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Lead</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Tags</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Acções</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => {
                const overdue = isOverdue(t);
                const done = t.status === 'COMPLETED';
                const Icon = TYPE_ICONS[t.type] || Circle;
                const typeOpt = taskOpts.lookupType(t.type);
                const statusOpt = taskOpts.lookupStatus(t.status);
                const prioOpt = taskOpts.lookupPriority(t.priority);
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
                        <Flag size={11} style={{ color: prioOpt.color || '#94A3B8' }} />
                        <span style={{ color: prioOpt.color || '#94A3B8' }}>{prioOpt.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-xs" style={{ color: typeOpt.color || 'var(--text-secondary)' }}>
                        <Icon size={12} /> {typeOpt.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{ background: (statusOpt.color || '#94A3B8') + '22', color: statusOpt.color || '#374151' }}>
                        {statusOpt.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: overdue && !done ? '#991B1B' : 'var(--text-secondary)' }}>
                      {t.dueAt ? new Date(t.dueAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{t.assignedTo?.name || '—'}</td>
                    <td className="px-3 py-2">
                      {t.lead ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => navigate(`/pipeline?leadId=${t.lead!.id}`)} className="flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--primary)' }}>
                            {t.lead.title} <ExternalLink size={11} />
                          </button>
                          <button onClick={() => setPreviewChatTask(t)} title="Pré-visualizar conversa" className="p-1 rounded hover:bg-slate-100">
                            <MessageSquare size={12} style={{ color: 'var(--primary)' }} />
                          </button>
                        </div>
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
        <TaskFormModalV2
          users={users} leads={leads} tags={tags}
          initialDate={initialDate}
          onClose={() => { setAdding(false); setInitialDate(undefined); }}
          onSaved={(t) => setTasks((prev) => [...prev, t])}
          onTagsChanged={loadTags}
          onOpenExisting={(t) => setEditing(t)}
        />
      )}
      {editing && (
        <TaskFormModalV2
          task={editing} users={users} leads={leads} tags={tags}
          onClose={() => setEditing(null)}
          onSaved={(t) => setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)))}
          onTagsChanged={loadTags}
          onOpenExisting={(t) => setEditing(t)}
        />
      )}
      {previewChatTask && (
        <ChatPreviewModal
          leadId={previewChatTask.lead?.id || null}
          contactId={previewChatTask.contact?.id || (previewChatTask.lead as any)?.contactId || null}
          contactName={
            previewChatTask.contact
              ? `${(previewChatTask.contact as any).firstName || ''} ${(previewChatTask.contact as any).lastName || ''}`.trim()
              : previewChatTask.lead?.title || null
          }
          onClose={() => setPreviewChatTask(null)}
        />
      )}
      {showTagsManager && (
        <ManageTagsModal tags={tags} onClose={() => setShowTagsManager(false)} onChanged={loadTags} />
      )}
      {importing && (
        <ImportTasksModal onClose={() => setImporting(false)} onImported={loadTasks} />
      )}
    </div>
  );
}
