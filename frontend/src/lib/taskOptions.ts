// Hook centralizado para opções de tarefa (Tipo/Prioridade/Estado/Recorrência).
// Resolve as opções configuradas no workspace, com fallback para os defaults,
// e disponibiliza funções `lookup*` para obter a TaskOption (com cor + label) a
// partir do valor guardado na tarefa. Garante que opções customizadas
// adicionadas em Definições aparecem em todos os sítios com a sua cor própria.

import { useAuthStore } from '../store';
import {
  TaskOption,
  DEFAULT_TASK_TYPES,
  DEFAULT_TASK_PRIORITIES,
  DEFAULT_TASK_STATUSES,
  DEFAULT_TASK_RECURRENCES,
} from './api';

const placeholder = (value: string): TaskOption => ({ value, label: value, color: '#94A3B8' });

export function useTaskOptions() {
  const { workspace } = useAuthStore();

  const types: TaskOption[] = ((workspace?.taskTypes as TaskOption[] | undefined)?.length
    ? (workspace!.taskTypes as TaskOption[])
    : DEFAULT_TASK_TYPES);
  const priorities: TaskOption[] = ((workspace?.taskPriorities as TaskOption[] | undefined)?.length
    ? (workspace!.taskPriorities as TaskOption[])
    : DEFAULT_TASK_PRIORITIES);
  const statuses: TaskOption[] = ((workspace?.taskStatuses as TaskOption[] | undefined)?.length
    ? (workspace!.taskStatuses as TaskOption[])
    : DEFAULT_TASK_STATUSES);
  const recurrences: TaskOption[] = ((workspace?.taskRecurrences as TaskOption[] | undefined)?.length
    ? (workspace!.taskRecurrences as TaskOption[])
    : DEFAULT_TASK_RECURRENCES);

  const lookupType = (v: string | null | undefined): TaskOption =>
    types.find((o) => o.value === v) || placeholder(v || '');
  const lookupPriority = (v: string | null | undefined): TaskOption =>
    priorities.find((o) => o.value === v) || placeholder(v || '');
  const lookupStatus = (v: string | null | undefined): TaskOption =>
    statuses.find((o) => o.value === v) || placeholder(v || '');
  const lookupRecurrence = (v: string | null | undefined): TaskOption =>
    recurrences.find((o) => o.value === (v || '')) || placeholder(v || '');

  return { types, priorities, statuses, recurrences, lookupType, lookupPriority, lookupStatus, lookupRecurrence };
}
