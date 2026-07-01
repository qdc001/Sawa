// Dialog mostrado quando o backend recusa criar uma tarefa nova porque
// o contacto ja tem uma tarefa aberta (HTTP 409 + existingTask no body).
// O utilizador pode escolher entre editar a tarefa existente ou abortar
// a criacao da nova.

import { AlertTriangle, Edit3, RefreshCw, X } from 'lucide-react';

export interface ExistingTask {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  priority?: string;
  assignedTo?: { name?: string | null } | null;
  contact?: { firstName?: string | null; lastName?: string | null } | null;
}

interface Props {
  existingTask: ExistingTask;
  onEditExisting: (task: ExistingTask) => void;
  onCancel: () => void;
  // Se dado, adiciona um botao "Actualizar tarefa existente" que aplica os
  // campos do formulario actual (titulo, prazo, tipo, etc.) a tarefa
  // existente em vez de criar uma nova.
  onUpdateExisting?: (task: ExistingTask) => void | Promise<void>;
  updateLabel?: string;
}

export default function TaskConflictDialog({ existingTask, onEditExisting, onCancel, onUpdateExisting, updateLabel }: Props) {
  const dueStr = existingTask.dueAt
    ? new Date(existingTask.dueAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
    : 'sem prazo';
  const assignee = existingTask.assignedTo?.name || null;
  const contactName = existingTask.contact
    ? `${existingTask.contact.firstName || ''} ${existingTask.contact.lastName || ''}`.trim() || null
    : null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[60] p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="rounded-full p-2 flex-shrink-0"
            style={{ background: '#FEF3C7' }}
          >
            <AlertTriangle size={20} style={{ color: '#B45309' }} />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              Ja existe uma tarefa aberta
            </h3>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {contactName
                ? `${contactName} ja tem uma tarefa aberta. Um contacto so pode ter uma tarefa aberta de cada vez.`
                : 'Este contacto ja tem uma tarefa aberta. Um contacto so pode ter uma tarefa aberta de cada vez.'}
            </p>
          </div>
          <button onClick={onCancel} style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div
          className="rounded-lg p-3 mb-4"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {existingTask.title}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>Prazo: {dueStr}</span>
            {existingTask.priority && <span>Prioridade: {existingTask.priority}</span>}
            <span>Estado: {existingTask.status}</span>
            {assignee && <span>Responsavel: {assignee}</span>}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row flex-wrap gap-2">
          <button
            onClick={onCancel}
            className="btn flex-1 py-2 flex items-center justify-center gap-2 min-w-[140px]"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          >
            Abortar criacao
          </button>
          <button
            onClick={() => onEditExisting(existingTask)}
            className="btn flex-1 py-2 flex items-center justify-center gap-2 min-w-[140px]"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <Edit3 size={14} />
            Editar existente
          </button>
          {onUpdateExisting && (
            <button
              onClick={() => onUpdateExisting(existingTask)}
              className="btn btn-primary flex-1 py-2 flex items-center justify-center gap-2 min-w-[140px]"
              title="Aplica os campos deste formulario a tarefa existente"
            >
              <RefreshCw size={14} />
              {updateLabel || 'Actualizar existente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
