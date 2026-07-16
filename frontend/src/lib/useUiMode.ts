// Hook para determinar o modo da UI do workspace actual.
//
//   'legacy'   -> UI antiga (Pipeline, Leads, Propostas, Chamadas, Chatbots,
//                 Notificacoes, Produtos, Modelos, Templates email, Auto-tarefa,
//                 tab Sector na Leizy, painel de bibliotecas de vendas, etc)
//                 Preservada para workspaces cujo owner esta em
//                 KLARU_LEGACY_WORKSPACES env var no backend.
//
//   'clinical' -> UI enxuta focada em clinicas (default para workspaces novos).
//                 Esconde as coisas que nao fazem sentido para clinicas.
//
// Uso:
//   const isLegacy = useIsLegacy();
//   if (!isLegacy) { ... } // esconde X em UI clinica
//
// Quando o workspace nao vem do backend ainda (loading inicial), assumimos
// 'clinical' como default seguro para evitar flash de UI antiga.

import { useAuthStore } from '../store';

export function useUiMode(): 'legacy' | 'clinical' {
  const workspace = useAuthStore((s) => s.workspace) as any;
  return workspace?.uiMode === 'legacy' ? 'legacy' : 'clinical';
}

export function useIsLegacy(): boolean {
  return useUiMode() === 'legacy';
}

export function useIsClinical(): boolean {
  return useUiMode() === 'clinical';
}
