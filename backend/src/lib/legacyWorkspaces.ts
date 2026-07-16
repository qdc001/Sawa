// Determinacao de workspaces em modo "legacy" (UI antiga anterior ao
// pivot para clinicas). Baseado em variavel de ambiente para nao mexer na
// base de dados nem obrigar a schema change.
//
// Uso:
//   KLARU_LEGACY_WORKSPACES=owner1@ex.com,owner2@ex.com
//
// Um workspace considera-se legacy se o email do OWNER esta na lista.
// Legacy workspaces:
//   - Veem a UI antiga (Pipeline, Leads, Propostas, Chamadas, Chatbots,
//     Notificacoes, Produtos, Modelos, Templates email, Auto-tarefa, etc)
//   - Nao recebem jobs proactivos da Leizy (reactivacao, aniversario,
//     follow-up pos-consulta) que sao especificos de clinicas
//   - Continuam a beneficiar de melhorias de motor (Leizy contexto do
//     paciente, base de conhecimento, fixes de bugs)

import prisma from './prisma';

function parseList(): string[] {
  const raw = process.env.KLARU_LEGACY_WORKSPACES || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const LEGACY_EMAILS = parseList();

export function isLegacyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return LEGACY_EMAILS.includes(email.trim().toLowerCase());
}

// Cache simples em memoria (invalidado no arranque; e ~O(workspaces)
// legacy, geralmente <5) para evitar 1 query por request ao /me.
const legacyWorkspaceIds = new Set<string>();
let cacheLoaded = false;

async function loadCache(): Promise<void> {
  if (LEGACY_EMAILS.length === 0) {
    cacheLoaded = true;
    return;
  }
  const owners = await prisma.user.findMany({
    where: {
      role: 'OWNER',
      email: { in: LEGACY_EMAILS, mode: 'insensitive' },
    },
    select: { workspaceId: true, email: true },
  });
  legacyWorkspaceIds.clear();
  for (const o of owners) legacyWorkspaceIds.add(o.workspaceId);
  cacheLoaded = true;
  console.log(`[legacyWorkspaces] carregados ${legacyWorkspaceIds.size} workspace(s) legacy: ${owners.map((o) => o.email).join(', ')}`);
}

export async function isLegacyWorkspace(workspaceId: string): Promise<boolean> {
  if (!cacheLoaded) await loadCache();
  return legacyWorkspaceIds.has(workspaceId);
}

export async function getAllLegacyWorkspaceIds(): Promise<string[]> {
  if (!cacheLoaded) await loadCache();
  return Array.from(legacyWorkspaceIds);
}

export function invalidateLegacyCache(): void {
  cacheLoaded = false;
}
