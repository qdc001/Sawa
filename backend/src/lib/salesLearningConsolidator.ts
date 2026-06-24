// Consolidador de aprendizagem da IA Vendedora (Fase 4).
//
// Corre uma vez por dia (02:00 hora do servidor) por cima das sugestoes
// EDITED dos ultimos 30 dias. Compara o que a IA propos (parts) vs. o que
// o humano enviou (finalParts) e pede a Groq para extrair 3 a 6 padroes
// curtos. Esses padroes ficam guardados em Workspace.aiLearnedMemory e
// sao injectados no system prompt em geracoes futuras pelo
// buildSalesSystemPrompt (campo aiLearnedMemory ja existente).
//
// Logica conservadora:
//   - Nao consolida se ha menos de 5 EDITED no periodo (sinal fraco)
//   - Limite de 80 amostras para nao estourar tokens
//   - Memoria final truncada a 1200 caracteres
//   - Falha silenciosamente (log) para nao matar o scheduler

import prisma from './prisma';
import { callLlm } from './llmProvider';

const WINDOW_DAYS = 30;
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 80;
const MAX_MEMORY_CHARS = 1200;

type EditedSample = {
  proposed: string;
  sent: string;
  sector: string;
};

// Heuristica simples: junta as partes propostas vs finais num par compacto
// para o LLM analisar. Trunca partes longas.
function buildSamples(records: any[]): EditedSample[] {
  const out: EditedSample[] = [];
  for (const r of records) {
    const proposed = Array.isArray(r.parts) ? (r.parts as any[]).filter((x) => typeof x === 'string').join(' | ') : '';
    const sent = Array.isArray(r.finalParts) ? (r.finalParts as any[]).filter((x) => typeof x === 'string').join(' | ') : '';
    if (!proposed.trim() || !sent.trim()) continue;
    if (proposed.trim() === sent.trim()) continue; // sem mudanca relevante
    out.push({
      proposed: proposed.slice(0, 400),
      sent: sent.slice(0, 400),
      sector: r.workspace?.sector || 'outro',
    });
    if (out.length >= MAX_SAMPLES) break;
  }
  return out;
}

function buildConsolidationPrompt(samples: EditedSample[], existingMemory: string | null): string {
  const lines = samples.map((s, i) => `${i + 1}.\n  IA propos: "${s.proposed}"\n  Humano enviou: "${s.sent}"`).join('\n\n');
  return [
    `Es um analista de padroes de comunicacao a estudar diferencas entre o que uma IA vendedora propos e o que o humano realmente enviou ao lead. O objectivo e extrair 3 a 6 ensinamentos curtos e accionaveis que a IA deve incorporar nas proximas respostas, para soar mais como a marca.`,
    ``,
    `Regras para os ensinamentos:`,
    `- Escreve em portugues europeu/mocambicano, frases curtas, sem brasileirismos.`,
    `- Nao uses o travessao "—". Usa virgula, dois pontos ou parenteses.`,
    `- Cada ensinamento e uma frase imperativa ou descritiva clara (ex: "Comeca sempre por confirmar o nome do cliente." ou "Usa frases mais curtas: max 2 frases por mensagem.").`,
    `- Foca-te no tom, comprimento, vocabulario, estrutura, ordem dos topicos. Ignora factos pontuais (precos, datas, nomes).`,
    `- Se o sinal for fraco ou contraditorio, devolve menos ensinamentos.`,
    ``,
    existingMemory ? `Memoria actual da IA (podes manter, refinar ou descartar partes):\n${existingMemory}\n` : ``,
    `Pares observados (${samples.length}):`,
    lines,
    ``,
    `Devolve apenas a lista de ensinamentos, um por linha, comecando com "- ". Sem cabecalho, sem explicacao extra, sem markdown.`,
  ].filter(Boolean).join('\n');
}

// Consolida 1 workspace. Devolve true se actualizou a memoria.
export async function consolidateWorkspaceMemory(workspaceId: string): Promise<{ updated: boolean; samples: number; reason?: string }> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60_000);
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, sector: true, aiLearnedMemory: true, aiSalesEnabled: true, aiSalesEnabledConversationIds: true },
  });
  if (!ws) return { updated: false, samples: 0, reason: 'workspace nao existe' };

  // So consolida se a IA esta efectivamente em uso
  const enabledIds = Array.isArray(ws.aiSalesEnabledConversationIds) ? (ws.aiSalesEnabledConversationIds as any[]).length : 0;
  if (!ws.aiSalesEnabled && enabledIds === 0) {
    return { updated: false, samples: 0, reason: 'IA Vendedora nao activa neste workspace' };
  }

  const edited = await prisma.aiSalesSuggestion.findMany({
    where: {
      workspaceId,
      status: 'EDITED',
      decidedAt: { gte: since },
    },
    orderBy: { decidedAt: 'desc' },
    take: MAX_SAMPLES * 2,
    include: { workspace: { select: { sector: true } } },
  });

  const samples = buildSamples(edited);
  if (samples.length < MIN_SAMPLES) {
    return { updated: false, samples: samples.length, reason: `menos de ${MIN_SAMPLES} EDITED com diferencas` };
  }

  const prompt = buildConsolidationPrompt(samples, ws.aiLearnedMemory);
  let raw: string;
  try {
    raw = await callLlm(null, [
      { role: 'system', content: 'Es um analista breve e directo. Devolves apenas a lista de ensinamentos pedida.' },
      { role: 'user', content: prompt },
    ], 600, 0.3, { workspaceId, feature: 'learning' });
  } catch (e: any) {
    return { updated: false, samples: samples.length, reason: `LLM falhou: ${e?.message || e}` };
  }

  // Limpa e normaliza a saida da Groq
  const cleaned = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('*'))
    .map((l) => l.replace(/^[-*]\s*/, '- '))
    .filter((l) => l.length > 3)
    .slice(0, 8)
    .join('\n')
    .slice(0, MAX_MEMORY_CHARS);

  if (!cleaned) {
    return { updated: false, samples: samples.length, reason: 'Groq devolveu lista vazia' };
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { aiLearnedMemory: cleaned },
  });
  console.log(`[salesLearning] workspace=${workspaceId}: memoria actualizada com ${samples.length} amostras (${cleaned.length} chars)`);
  return { updated: true, samples: samples.length };
}

// Consolida todos os workspaces com IA Vendedora activa.
// Chamado pelo scheduler em server.ts e pelo endpoint manual.
let lastRunHour = -1;
export async function runDailyLearningConsolidation(): Promise<void> {
  // Corre uma vez por dia, sempre entre 02:00 e 02:59 do servidor.
  const now = new Date();
  if (now.getHours() !== 2) return;
  if (now.getHours() === lastRunHour) return;
  lastRunHour = now.getHours();

  try {
    const candidates = await prisma.workspace.findMany({
      where: {
        OR: [
          { aiSalesEnabled: true },
          // Workspaces que tem pelo menos uma conversa com IA ligada
          { NOT: [{ aiSalesEnabledConversationIds: { equals: [] as any } }] },
        ],
      },
      select: { id: true },
    });
    console.log(`[salesLearning] inicio (${candidates.length} workspaces)`);
    for (const ws of candidates) {
      try {
        const r = await consolidateWorkspaceMemory(ws.id);
        if (!r.updated && r.reason) {
          console.log(`[salesLearning] workspace=${ws.id}: skip (${r.reason})`);
        }
      } catch (e: any) {
        console.error(`[salesLearning] workspace=${ws.id} erro:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[salesLearning] scheduler falhou:', e?.message || e);
  }
}
