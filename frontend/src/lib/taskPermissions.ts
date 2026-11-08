import toast from 'react-hot-toast';

// Tarefas: todos veem e criam; so OWNER/ADMIN alteram ou eliminam.
export const TASKS_ADMIN_ONLY_MSG = 'Só administradores podem alterar ou eliminar tarefas.';

export function canEditTasks(role?: string | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function denyTaskEdit() {
  toast.error(TASKS_ADMIN_ONLY_MSG, { id: 'task-admin-only' });
}

// Pedidos que alteram tarefas (o servidor tambem recusa; isto evita o pedido
// e da uma mensagem clara em qualquer ecra: Tarefas, Inbox, Contactos).
export function isTaskMutation(method: string | undefined, url: string | undefined): boolean {
  const m = (method || 'get').toLowerCase();
  const u = (url || '').split('?')[0];
  if (!/^\/tasks(\/|$)/.test(u)) return false;
  if (m === 'patch' || m === 'put' || m === 'delete') return true;
  if (m === 'post') return /^\/tasks\/(bulk-complete|bulk-delete|bulk-assign)$/.test(u) || /^\/tasks\/[^/]+\/tags$/.test(u);
  return false;
}

export function currentRoleFromStorage(): string | null {
  try {
    const raw = localStorage.getItem('auth-store');
    return raw ? JSON.parse(raw)?.state?.user?.role ?? null : null;
  } catch { return null; }
}
