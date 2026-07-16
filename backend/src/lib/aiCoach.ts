// Coach conversacional da IA Vendedora.
//
// Permite ao admin do workspace "treinar" a IA Vendedora atraves de chat,
// em vez de apenas escrever instrucoes livres. O coach (meta-IA, tambem Groq)
// faz perguntas, propoe regras estruturadas e grava-as como AiCoachingRule.
//
// Funcoes principais:
//   - buildCoachSystemPrompt()      -> prompt do meta-coach
//   - coachReply()                  -> chamada Groq JSON, extrai resposta + accoes
//   - selectRelevantRules()         -> retrieval por keywords para injectar no prompt da IA Vendedora
//   - autoLearnFromConversations()  -> job nocturno: olha para conversas com sinal positivo e cria regras
//
// Output JSON esperado do coach:
//   {
//     "reply": string,                         // texto a mostrar ao admin (PT-MZ, sem travessoes)
//     "actions": [                             // accoes estruturadas a aplicar
//       { "type": "create_rule", "rule": {...} },
//       { "type": "deactivate_rule", "ruleId": "..." },
//       { "type": "update_rule", "ruleId": "...", "patch": {...} }
//     ]
//   }

import prisma from './prisma';
import { callLlm, callLlmJson } from './llmProvider';
import { AiCoachingRule } from '@prisma/client';

const COACH_MAX_HISTORY = 20;

export type CoachMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  rulesCreated?: string[];
  rulesUpdated?: string[];
};

export type RuleDraft = {
  situation: string;
  recommendedAction: string;
  examples?: Array<{ leadMessage: string; aiResponse: string }>;
  tone?: string | null;
  category?: string | null;
  keywords?: string[];
  priority?: number;
};

export type CoachAction =
  | { type: 'create_rule'; rule: RuleDraft }
  | { type: 'deactivate_rule'; ruleId: string }
  | { type: 'update_rule'; ruleId: string; patch: Partial<RuleDraft> & { isActive?: boolean } };

export type CoachReply = {
  reply: string;
  actions: CoachAction[];
};

// =====================================================================
// Prompt do coach (meta-IA)
// =====================================================================

export function buildCoachSystemPrompt(opts: {
  agentName?: string | null;
  agentRole?: string | null;
  sector?: string | null;
  existingRules: Array<Pick<AiCoachingRule, 'id' | 'situation' | 'recommendedAction' | 'category' | 'isActive' | 'source'>>;
}): string {
  const name = opts.agentName?.trim() || 'a Leizy';
  const role = opts.agentRole?.trim() || 'assistente inteligente de relacionamento com pacientes';
  const sector = opts.sector?.trim() || 'desconhecido';

  const rulesBlock = opts.existingRules.length === 0
    ? 'Ainda nao ha regras gravadas.'
    : opts.existingRules.slice(0, 40).map((r, i) =>
        `${i + 1}. [${r.id}] ${r.isActive ? 'activa' : 'inactiva'} (${r.source}) cat=${r.category || '-'}\n   Situacao: ${r.situation.slice(0, 200)}\n   Accao: ${r.recommendedAction.slice(0, 200)}`
      ).join('\n');

  return [
    `És um coach especialista em treinar assistentes inteligentes de relacionamento. O teu trabalho é conversar com o dono do Klaru para perceber como ele quer que "${name}" (${role}, sector ${sector}) responda em cada situação, e transformar essas instruções em regras estruturadas reutilizáveis. Para clínicas, a "${name}" nunca faz diagnóstico nem prescreve; reencaminha essas questões à equipa clínica.`,
    ``,
    `Linguagem obrigatória: português europeu/moçambicano. Nunca uses o travessão "—" em nenhuma circunstância: usa vírgula, dois pontos ou parênteses. Sem brasileirismos (é "ficheiro" não "arquivo", "ecrã" não "tela", "actual" não "atual", "projecto" não "projeto", "óptimo" não "ótimo"). Sem anglicismos: "reunião" não "meeting", "prazo" não "deadline", "opinião" não "feedback", "marcação" ou "consulta" não "appointment", "acompanhamento" não "follow-up". Tom directo, profissional, caloroso.`,
    ``,
    `Como conduzir a conversa:`,
    `- Pergunta uma coisa de cada vez. Nunca despejes três perguntas seguidas.`,
    `- Quando o utilizador descreve uma situação, faz 1 ou 2 perguntas para clarificar e DEPOIS propõe a regra.`,
    `- Antes de criar uma regra, valida em texto natural com o admin: "Então a regra fica assim: X. Confirmas?".`,
    `- Se o utilizador disser "sim", "ok", "podes guardar" ou equivalente, cria a regra na mesma resposta (no array actions).`,
    `- Sugere proactivamente categorias e keywords baseadas na situação.`,
    `- Se uma nova regra contradiz uma regra existente, aponta isso e pergunta se quer desactivar a antiga.`,
    `- Se o utilizador pedir para apagar/desactivar/editar uma regra, faz no array actions (usa o ID das regras existentes listadas em baixo).`,
    ``,
    `Regras já gravadas neste workspace:`,
    rulesBlock,
    ``,
    `Formato OBRIGATÓRIO da resposta: JSON com esta forma exacta, sem markdown, sem texto antes ou depois:`,
    `{`,
    `  "reply": "<o que vais dizer ao admin, PT-MZ, sem travessões, 1 a 6 frases curtas>",`,
    `  "actions": [`,
    `    { "type": "create_rule", "rule": { "situation": "...", "recommendedAction": "...", "examples": [{"leadMessage": "...", "aiResponse": "..."}], "tone": "...", "category": "...", "keywords": ["...", "..."], "priority": 0 } },`,
    `    { "type": "deactivate_rule", "ruleId": "..." },`,
    `    { "type": "update_rule", "ruleId": "...", "patch": { "recommendedAction": "..." } }`,
    `  ]`,
    `}`,
    ``,
    `O array "actions" só deve ter entradas quando há mesmo algo a aplicar. Em mensagens de clarificação ou perguntas, devolve "actions": [].`,
    `Nunca inventes IDs de regras: usa apenas os IDs listados acima quando precisares de referir uma regra existente.`,
    `Em "rule.situation" e "rule.recommendedAction" escreve com frases completas e accionáveis para a Leizy consumir.`,
    `Em "rule.keywords" inclui 3 a 8 palavras lowercase em PT que apareceriam na mensagem do lead que dispara esta regra (ex: "preço", "desconto", "demo").`,
  ].join('\n');
}

// =====================================================================
// Normalizacao do output do coach
// =====================================================================

function normalizeRuleDraft(raw: any): RuleDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const situation = typeof raw.situation === 'string' ? raw.situation.trim() : '';
  const recommendedAction = typeof raw.recommendedAction === 'string' ? raw.recommendedAction.trim() : '';
  if (!situation || !recommendedAction) return null;

  const examplesRaw = Array.isArray(raw.examples) ? raw.examples : [];
  const examples = examplesRaw
    .filter((e: any) => e && typeof e.leadMessage === 'string' && typeof e.aiResponse === 'string')
    .slice(0, 6)
    .map((e: any) => ({
      leadMessage: e.leadMessage.trim().slice(0, 500),
      aiResponse: e.aiResponse.trim().slice(0, 800),
    }));

  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords
        .filter((k: any) => typeof k === 'string' && k.trim().length > 0)
        .map((k: string) => k.trim().toLowerCase().slice(0, 40))
        .slice(0, 12)
    : [];

  return {
    situation: situation.slice(0, 1000),
    recommendedAction: recommendedAction.slice(0, 2000),
    examples,
    tone: typeof raw.tone === 'string' ? raw.tone.trim().slice(0, 120) || null : null,
    category: typeof raw.category === 'string' ? raw.category.trim().slice(0, 60) || null : null,
    keywords,
    priority: Number.isFinite(raw.priority) ? Math.max(0, Math.min(100, Math.trunc(raw.priority))) : 0,
  };
}

function normalizeCoachReply(raw: any): CoachReply {
  const reply = typeof raw?.reply === 'string' ? raw.reply.trim() : '';
  const actions: CoachAction[] = [];
  const rawActions = Array.isArray(raw?.actions) ? raw.actions : [];
  for (const a of rawActions) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'create_rule') {
      const rule = normalizeRuleDraft(a.rule);
      if (rule) actions.push({ type: 'create_rule', rule });
    } else if (a.type === 'deactivate_rule' && typeof a.ruleId === 'string') {
      actions.push({ type: 'deactivate_rule', ruleId: a.ruleId });
    } else if (a.type === 'update_rule' && typeof a.ruleId === 'string' && a.patch && typeof a.patch === 'object') {
      const patch: any = {};
      if (typeof a.patch.situation === 'string') patch.situation = a.patch.situation.trim().slice(0, 1000);
      if (typeof a.patch.recommendedAction === 'string') patch.recommendedAction = a.patch.recommendedAction.trim().slice(0, 2000);
      if (typeof a.patch.tone === 'string') patch.tone = a.patch.tone.trim().slice(0, 120);
      if (typeof a.patch.category === 'string') patch.category = a.patch.category.trim().slice(0, 60);
      if (Array.isArray(a.patch.keywords)) {
        patch.keywords = a.patch.keywords
          .filter((k: any) => typeof k === 'string')
          .map((k: string) => k.trim().toLowerCase())
          .slice(0, 12);
      }
      if (typeof a.patch.isActive === 'boolean') patch.isActive = a.patch.isActive;
      if (Number.isFinite(a.patch.priority)) patch.priority = Math.max(0, Math.min(100, Math.trunc(a.patch.priority)));
      actions.push({ type: 'update_rule', ruleId: a.ruleId, patch });
    }
  }
  return { reply: reply || 'Ok.', actions };
}

// =====================================================================
// Chamada principal: chat com o coach
// =====================================================================

export type CoachReplyOptions = {
  workspaceId: string;
  history: CoachMessage[];          // mensagens anteriores da sessao (sem incluir userMessage)
  userMessage: string;              // nova mensagem do admin
};

export async function coachReply(opts: CoachReplyOptions): Promise<CoachReply> {
  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { aiAgentName: true, aiAgentRole: true, sector: true },
  });

  const rules = await prisma.aiCoachingRule.findMany({
    where: { workspaceId: opts.workspaceId },
    select: { id: true, situation: true, recommendedAction: true, category: true, isActive: true, source: true },
    orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
    take: 80,
  });

  const systemPrompt = buildCoachSystemPrompt({
    agentName: ws?.aiAgentName,
    agentRole: ws?.aiAgentRole,
    sector: ws?.sector,
    existingRules: rules,
  });

  // Recorta o histórico mais recente para não estourar tokens
  const recent = opts.history.slice(-COACH_MAX_HISTORY).filter((m) => m.role !== 'system');
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...recent.map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content || '').slice(0, 4000) })),
    { role: 'user' as const, content: opts.userMessage.slice(0, 4000) },
  ];

  const result = await callLlmJson(null, messages, 1000, 0.4, { workspaceId: opts.workspaceId, feature: 'coach' });
  return normalizeCoachReply(result.json);
}

// =====================================================================
// Aplicar accoes do coach (gravar regras criadas/editadas/desactivadas)
// =====================================================================

export type AppliedAction = {
  type: CoachAction['type'];
  ruleId: string;
  ok: boolean;
  error?: string;
};

export async function applyCoachActions(
  workspaceId: string,
  actions: CoachAction[],
  createdById: string | null,
  source: 'coach_chat' | 'auto_learned' | 'manual' = 'coach_chat',
): Promise<AppliedAction[]> {
  const applied: AppliedAction[] = [];

  for (const action of actions) {
    try {
      if (action.type === 'create_rule') {
        const r = await prisma.aiCoachingRule.create({
          data: {
            workspaceId,
            situation: action.rule.situation,
            recommendedAction: action.rule.recommendedAction,
            examples: (action.rule.examples || []) as any,
            tone: action.rule.tone || null,
            category: action.rule.category || null,
            keywords: action.rule.keywords || [],
            priority: action.rule.priority || 0,
            source,
            confidence: source === 'auto_learned' ? 0.7 : 1.0,
            isActive: true,
            createdById,
          },
        });
        applied.push({ type: 'create_rule', ruleId: r.id, ok: true });
      } else if (action.type === 'deactivate_rule') {
        const existing = await prisma.aiCoachingRule.findFirst({
          where: { id: action.ruleId, workspaceId },
        });
        if (!existing) {
          applied.push({ type: 'deactivate_rule', ruleId: action.ruleId, ok: false, error: 'regra nao existe' });
          continue;
        }
        await prisma.aiCoachingRule.update({
          where: { id: action.ruleId },
          data: { isActive: false },
        });
        applied.push({ type: 'deactivate_rule', ruleId: action.ruleId, ok: true });
      } else if (action.type === 'update_rule') {
        const existing = await prisma.aiCoachingRule.findFirst({
          where: { id: action.ruleId, workspaceId },
        });
        if (!existing) {
          applied.push({ type: 'update_rule', ruleId: action.ruleId, ok: false, error: 'regra nao existe' });
          continue;
        }
        const patch: any = {};
        const p: any = action.patch;
        if (typeof p.situation === 'string') patch.situation = p.situation;
        if (typeof p.recommendedAction === 'string') patch.recommendedAction = p.recommendedAction;
        if ('tone' in p) patch.tone = p.tone || null;
        if ('category' in p) patch.category = p.category || null;
        if (Array.isArray(p.keywords)) patch.keywords = p.keywords;
        if (typeof p.isActive === 'boolean') patch.isActive = p.isActive;
        if (Number.isFinite(p.priority)) patch.priority = p.priority;
        await prisma.aiCoachingRule.update({ where: { id: action.ruleId }, data: patch });
        applied.push({ type: 'update_rule', ruleId: action.ruleId, ok: true });
      }
    } catch (e: any) {
      applied.push({ type: action.type, ruleId: (action as any).ruleId || '', ok: false, error: String(e?.message || e) });
    }
  }

  return applied;
}

// =====================================================================
// Retrieval: regras relevantes para uma mensagem do lead
// =====================================================================

// Selecciona ate `limit` regras activas, priorizando matches de keyword na
// mensagem do lead. Se nao houver matches, devolve as de prioridade mais
// alta. Usado por buildSalesSystemPrompt.
export async function selectRelevantRules(
  workspaceId: string,
  leadMessage: string,
  limit = 20,
): Promise<AiCoachingRule[]> {
  const all = await prisma.aiCoachingRule.findMany({
    where: { workspaceId, isActive: true },
    orderBy: [{ priority: 'desc' }, { confidence: 'desc' }, { updatedAt: 'desc' }],
  });
  if (all.length === 0) return [];
  if (all.length <= limit) return all;

  const lower = (leadMessage || '').toLowerCase();
  type Scored = { rule: AiCoachingRule; score: number };
  const scored: Scored[] = all.map((r) => {
    let score = r.priority * 10 + r.confidence * 5;
    const kws = Array.isArray(r.keywords) ? r.keywords : [];
    for (const k of kws) {
      if (k && lower.includes(k)) score += 30;
    }
    // Match parcial no campo situation tambem ajuda
    const sitWords = r.situation.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
    for (const w of sitWords) {
      if (lower.includes(w)) { score += 2; break; }
    }
    return { rule: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.rule);
}

// Marca regras como aplicadas (incrementa contador). Chamado depois da IA
// Vendedora gerar uma sugestao usando estas regras.
export async function markRulesApplied(ruleIds: string[]): Promise<void> {
  if (!ruleIds || ruleIds.length === 0) return;
  await prisma.aiCoachingRule.updateMany({
    where: { id: { in: ruleIds } },
    data: { timesApplied: { increment: 1 }, lastAppliedAt: new Date() },
  });
}

// =====================================================================
// Auto-learning a partir de conversas com sinal positivo
// =====================================================================

// Sinal positivo = sugestao APPROVED (humano achou que estava bem) ou
// SENT em modo auto, OU lead que avancou de etapa nas ultimas 24h apos
// uma troca de mensagens. Para a v1 usamos AiSalesSuggestion.status
// in (APPROVED, SENT) e tambem leads fechados em WON.

const AUTO_LEARN_WINDOW_HOURS = 24;
const AUTO_LEARN_MIN_SAMPLES = 3;
const AUTO_LEARN_MAX_RULES_PER_RUN = 6;

type LearnSample = {
  trigger: string;        // mensagem do lead que disparou
  response: string;       // resposta enviada pela IA/humano
  outcome: string;        // descricao do desfecho positivo
};

function buildAutoLearnPrompt(samples: LearnSample[]): string {
  const block = samples.map((s, i) =>
    `${i + 1}. Lead disse: "${s.trigger.slice(0, 300)}"\n   Resposta enviada: "${s.response.slice(0, 400)}"\n   Desfecho: ${s.outcome}`
  ).join('\n\n');

  return [
    `Es um analista que estuda interaccoes reais entre uma assistente inteligente (a Leizy) e pacientes/clientes, e identifica padroes de sucesso para transformar em regras reutilizaveis.`,
    ``,
    `Linguagem: portugues europeu/mocambicano, sem brasileirismos, NUNCA uses o travessao "—".`,
    ``,
    `Recebes pares (mensagem do lead, resposta enviada, desfecho). Para cada padrao claro que detectes, propoe 1 regra. So crias regra se o padrao for replicavel e nao trivial. Maximo ${AUTO_LEARN_MAX_RULES_PER_RUN} regras por execucao. Se nao houver sinal claro, devolve array vazio.`,
    ``,
    `Cada regra deve ter:`,
    `- situation: descreve quando a regra se aplica (1-2 frases claras)`,
    `- recommendedAction: o que a IA deve dizer/fazer nessa situacao (1-3 frases)`,
    `- category: uma palavra (ex: "preco", "objeccao", "boas-vindas", "fecho", "follow-up")`,
    `- keywords: 3 a 8 palavras-chave lowercase que apareceriam na mensagem do lead`,
    ``,
    `Devolve JSON estrito: { "rules": [ { "situation": "...", "recommendedAction": "...", "category": "...", "keywords": [...] }, ... ] }`,
    ``,
    `Amostras observadas:`,
    block,
  ].join('\n');
}

export async function autoLearnFromConversations(workspaceId: string): Promise<{ created: number; samples: number; reason?: string }> {
  const since = new Date(Date.now() - AUTO_LEARN_WINDOW_HOURS * 60 * 60_000);

  // Sugestoes APPROVED ou SENT nas ultimas 24h (sinal positivo)
  const positives = await prisma.aiSalesSuggestion.findMany({
    where: {
      workspaceId,
      status: { in: ['APPROVED', 'SENT'] },
      decidedAt: { gte: since },
    },
    orderBy: { decidedAt: 'desc' },
    take: 60,
    include: {
      triggerMessage: { select: { content: true } },
      lead: { select: { status: true, title: true } },
    },
  });

  const samples: LearnSample[] = [];
  for (const s of positives) {
    const trigger = (s.triggerMessage?.content || '').trim();
    const partsArr = Array.isArray(s.parts) ? (s.parts as any[]).filter((x) => typeof x === 'string') : [];
    const finalArr = Array.isArray(s.finalParts) ? (s.finalParts as any[]).filter((x) => typeof x === 'string') : [];
    const response = (finalArr.length ? finalArr : partsArr).join(' | ').trim();
    if (!trigger || !response) continue;
    const outcome = s.lead?.status === 'WON' ? 'lead fechou em WON' : (s.status === 'APPROVED' ? 'humano aprovou a resposta sem editar' : 'enviada em modo auto, sem rejeicao subsequente');
    samples.push({ trigger, response, outcome });
  }

  if (samples.length < AUTO_LEARN_MIN_SAMPLES) {
    return { created: 0, samples: samples.length, reason: `menos de ${AUTO_LEARN_MIN_SAMPLES} amostras positivas` };
  }

  let raw: string;
  try {
    raw = await callLlm(null, [
      { role: 'system', content: 'Es um analista breve. Devolves apenas JSON valido conforme pedido.' },
      { role: 'user', content: buildAutoLearnPrompt(samples.slice(0, 30)) },
    ], 1200, 0.3, { workspaceId, feature: 'autolearn' });
  } catch (e: any) {
    return { created: 0, samples: samples.length, reason: `LLM falhou: ${e?.message || e}` };
  }

  // O modelo pode embrulhar em markdown; tenta extrair JSON.
  let parsed: any = null;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return { created: 0, samples: samples.length, reason: 'Groq devolveu JSON invalido' };
  }

  const rulesRaw = Array.isArray(parsed?.rules) ? parsed.rules.slice(0, AUTO_LEARN_MAX_RULES_PER_RUN) : [];
  if (rulesRaw.length === 0) {
    return { created: 0, samples: samples.length, reason: 'sem padrao claro detectado' };
  }

  let created = 0;
  for (const raw of rulesRaw) {
    const draft = normalizeRuleDraft(raw);
    if (!draft) continue;
    // Evita duplicar regras com situacao quase identica criadas nas ultimas 7 dias
    const dup = await prisma.aiCoachingRule.findFirst({
      where: {
        workspaceId,
        situation: { equals: draft.situation, mode: 'insensitive' },
      },
    });
    if (dup) continue;
    await prisma.aiCoachingRule.create({
      data: {
        workspaceId,
        situation: draft.situation,
        recommendedAction: draft.recommendedAction,
        examples: (draft.examples || []) as any,
        tone: draft.tone || null,
        category: draft.category || null,
        keywords: draft.keywords || [],
        priority: 0,
        source: 'auto_learned',
        confidence: 0.7,
        isActive: true,
      },
    });
    created += 1;
  }

  console.log(`[aiCoach] auto-learn workspace=${workspaceId}: ${created} regras criadas de ${samples.length} amostras`);
  return { created, samples: samples.length };
}

let lastAutoLearnHour = -1;
export async function runDailyAutoLearn(): Promise<void> {
  // Corre as 02:30, logo a seguir ao runDailyLearningConsolidation
  const now = new Date();
  if (now.getHours() !== 2 || now.getMinutes() < 30) return;
  if (now.getHours() === lastAutoLearnHour) return;
  lastAutoLearnHour = now.getHours();

  try {
    const candidates = await prisma.workspace.findMany({
      where: {
        OR: [
          { aiSalesEnabled: true },
          { NOT: [{ aiSalesEnabledConversationIds: { equals: [] as any } }] },
        ],
      },
      select: { id: true },
    });
    console.log(`[aiCoach] auto-learn start (${candidates.length} workspaces)`);
    for (const ws of candidates) {
      try {
        const r = await autoLearnFromConversations(ws.id);
        if (r.reason) console.log(`[aiCoach] workspace=${ws.id}: ${r.reason}`);
      } catch (e: any) {
        console.error(`[aiCoach] workspace=${ws.id} erro:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[aiCoach] scheduler falhou:', e?.message || e);
  }
}
