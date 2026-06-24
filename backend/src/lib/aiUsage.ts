// Tracking e enforcement de quotas de tokens LLM por workspace.
//
// Cada chamada bem-sucedida ao Groq/Gemini grava uma linha em AiUsageLog
// e incrementa os contadores cached no Workspace. Antes de cada chamada,
// checkLimitOrThrow verifica se ha quota disponivel para o dia e mes
// correntes; se nao, lanca AiQuotaExceededError.
//
// Limites por plano vem de PlanAiLimit (configuravel via UI) com fallback
// para defaults definidos em lib/plans.ts.

import prisma from './prisma';
import { PLANS, UNLIMITED } from './plans';

export type LlmFeature = 'sales' | 'coach' | 'chatbot' | 'copilot' | 'learning' | 'autolearn' | 'other';

export class AiQuotaExceededError extends Error {
  status = 429;
  scope: 'daily' | 'monthly';
  used: number;
  limit: number;
  constructor(scope: 'daily' | 'monthly', used: number, limit: number) {
    super(`Quota ${scope === 'daily' ? 'diaria' : 'mensal'} de tokens LLM esgotada (${used.toLocaleString()} / ${limit.toLocaleString()}). ${scope === 'daily' ? 'Reseta amanha' : 'Reseta no proximo mes'} ou faz upgrade do plano.`);
    this.scope = scope;
    this.used = used;
    this.limit = limit;
  }
}

// Defaults por plano (em tokens). Aplicados quando nao ha registo em
// PlanAiLimit. UNLIMITED (-1) significa sem limite.
const DEFAULT_LIMITS: Record<string, { daily: number; monthly: number }> = {
  STARTER:    { daily: 50_000,    monthly: 1_000_000 },
  GROWTH:     { daily: 250_000,   monthly: 5_000_000 },
  BUSINESS:   { daily: 1_000_000, monthly: 20_000_000 },
  ENTERPRISE: { daily: UNLIMITED, monthly: UNLIMITED },
};

function todayKey(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function monthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Devolve { daily, monthly } com os limites efectivos para o workspace.
// Considera (por ordem):
//   1. Override por workspace (aiTokensDailyLimitOverride / Monthly)
//   2. PlanAiLimit gravado para o plano
//   3. DEFAULT_LIMITS hardcoded
export async function getEffectiveLimits(workspaceId: string): Promise<{ daily: number; monthly: number; planKey: string }> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      plan: true,
      aiTokensDailyLimitOverride: true,
      aiTokensMonthlyLimitOverride: true,
    },
  });
  if (!ws) return { daily: 0, monthly: 0, planKey: 'STARTER' };

  const planKey = ws.plan || 'STARTER';
  const planLimit = await prisma.planAiLimit.findUnique({ where: { planKey } });
  const fallback = DEFAULT_LIMITS[planKey] || DEFAULT_LIMITS.STARTER;

  return {
    daily: ws.aiTokensDailyLimitOverride ?? planLimit?.dailyTokenLimit ?? fallback.daily,
    monthly: ws.aiTokensMonthlyLimitOverride ?? planLimit?.monthlyTokenLimit ?? fallback.monthly,
    planKey,
  };
}

// Devolve o uso actual (recalcula contadores cached se o dia/mes mudou).
export async function getCurrentUsage(workspaceId: string): Promise<{ daily: number; monthly: number; dailyResetAt: Date; monthlyResetAt: Date }> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      aiTokensUsedToday: true,
      aiTokensUsedMonth: true,
      aiTokensUsageDay: true,
      aiTokensUsageMonth: true,
    },
  });
  if (!ws) return { daily: 0, monthly: 0, dailyResetAt: new Date(), monthlyResetAt: new Date() };

  const today = todayKey();
  const month = monthKey();

  let daily = ws.aiTokensUsedToday;
  let monthly = ws.aiTokensUsedMonth;
  const data: any = {};

  // Se o dia gravado nao e hoje, reseta o contador diario
  if (!ws.aiTokensUsageDay || ws.aiTokensUsageDay.getTime() !== today.getTime()) {
    daily = 0;
    data.aiTokensUsedToday = 0;
    data.aiTokensUsageDay = today;
  }
  if (ws.aiTokensUsageMonth !== month) {
    monthly = 0;
    data.aiTokensUsedMonth = 0;
    data.aiTokensUsageMonth = month;
  }
  if (Object.keys(data).length > 0) {
    await prisma.workspace.update({ where: { id: workspaceId }, data });
  }

  // Proximo reset diario: amanha 00:00 UTC. Mensal: dia 1 do mes seguinte.
  const dailyResetAt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const monthlyResetAt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

  return { daily, monthly, dailyResetAt, monthlyResetAt };
}

// Verifica se ha quota antes de fazer uma chamada LLM. Lanca se nao.
// Nota: e uma estimativa (nao sabemos quantos tokens vai gastar a chamada
// concreta), por isso so bloqueamos se ja excedemos.
export async function checkLimitOrThrow(workspaceId: string): Promise<void> {
  const [limits, usage] = await Promise.all([
    getEffectiveLimits(workspaceId),
    getCurrentUsage(workspaceId),
  ]);
  if (limits.daily !== UNLIMITED && usage.daily >= limits.daily) {
    throw new AiQuotaExceededError('daily', usage.daily, limits.daily);
  }
  if (limits.monthly !== UNLIMITED && usage.monthly >= limits.monthly) {
    throw new AiQuotaExceededError('monthly', usage.monthly, limits.monthly);
  }
}

// Regista uma chamada bem-sucedida + actualiza contadores cached.
// E "fire and forget" do ponto de vista do caller (nao bloqueia o caminho
// critico nem dispara excepcao se falhar a gravar).
export async function recordUsage(opts: {
  workspaceId: string;
  provider: 'groq' | 'gemini';
  model: string;
  feature: LlmFeature;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<void> {
  try {
    const prompt = opts.promptTokens || 0;
    const completion = opts.completionTokens || 0;
    const total = prompt + completion;
    if (total <= 0) return;

    const today = todayKey();
    const month = monthKey();

    await prisma.aiUsageLog.create({
      data: {
        workspaceId: opts.workspaceId,
        provider: opts.provider,
        model: opts.model,
        feature: opts.feature,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
      },
    });

    // Garantir que o contador esta no periodo corrente antes de incrementar
    const ws = await prisma.workspace.findUnique({
      where: { id: opts.workspaceId },
      select: { aiTokensUsageDay: true, aiTokensUsageMonth: true },
    });
    if (!ws) return;

    const resetDaily = !ws.aiTokensUsageDay || ws.aiTokensUsageDay.getTime() !== today.getTime();
    const resetMonthly = ws.aiTokensUsageMonth !== month;

    await prisma.workspace.update({
      where: { id: opts.workspaceId },
      data: {
        aiTokensUsedToday: resetDaily ? total : { increment: total },
        aiTokensUsageDay: today,
        aiTokensUsedMonth: resetMonthly ? total : { increment: total },
        aiTokensUsageMonth: month,
      },
    });
  } catch (e: any) {
    console.error('[aiUsage] recordUsage falhou:', e?.message || e);
  }
}

// Listagem de planos com limites efectivos para a UI admin
export async function listPlanLimits(): Promise<Array<{ planKey: string; label: string; daily: number; monthly: number; isCustom: boolean }>> {
  const rows = await prisma.planAiLimit.findMany();
  const byKey = new Map(rows.map((r) => [r.planKey, r]));
  return Object.keys(PLANS).map((k) => {
    const plan = PLANS[k];
    const row = byKey.get(k);
    const fallback = DEFAULT_LIMITS[k] || DEFAULT_LIMITS.STARTER;
    return {
      planKey: k,
      label: plan.label,
      daily: row?.dailyTokenLimit ?? fallback.daily,
      monthly: row?.monthlyTokenLimit ?? fallback.monthly,
      isCustom: !!row,
    };
  });
}

export async function setPlanLimit(planKey: string, daily: number, monthly: number): Promise<void> {
  if (!PLANS[planKey]) throw new Error(`Plano invalido: ${planKey}`);
  await prisma.planAiLimit.upsert({
    where: { planKey },
    create: { planKey, dailyTokenLimit: daily, monthlyTokenLimit: monthly },
    update: { dailyTokenLimit: daily, monthlyTokenLimit: monthly },
  });
}
