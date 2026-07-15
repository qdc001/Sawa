// Endpoints do Treinador da IA Vendedora (coach conversacional + CRUD regras).
//
// Rotas:
//   GET    /api/ai-coaching/rules                 -> lista regras do workspace
//   POST   /api/ai-coaching/rules                 -> cria regra manualmente
//   PATCH  /api/ai-coaching/rules/:id             -> editar/desactivar
//   DELETE /api/ai-coaching/rules/:id             -> apaga regra
//   GET    /api/ai-coaching/conversations         -> lista sessoes de coaching
//   POST   /api/ai-coaching/conversations         -> nova sessao vazia
//   GET    /api/ai-coaching/conversations/:id     -> ver mensagens de uma sessao
//   POST   /api/ai-coaching/chat                  -> mandar mensagem ao coach
//   POST   /api/ai-coaching/auto-learn/run        -> dispara auto-learning agora (admin)
//
// Acesso: apenas OWNER e ADMIN podem usar estes endpoints.

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { coachReply, applyCoachActions, autoLearnFromConversations, CoachMessage } from '../lib/aiCoach';

const router = Router();

function requireAdmin(req: AuthRequest) {
  if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
    throw new AppError('Apenas administradores podem treinar a Leizy', 403);
  }
}

// =====================================================================
// Regras
// =====================================================================

// GET /api/ai-coaching/rules?source=&active=
router.get('/rules', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const where: any = { workspaceId };
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.active === 'true') where.isActive = true;
    if (req.query.active === 'false') where.isActive = false;
    if (req.query.category) where.category = String(req.query.category);

    const rules = await prisma.aiCoachingRule.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    res.json({ rules });
  } catch (e) { next(e); }
});

// POST /api/ai-coaching/rules
router.post('/rules', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const { situation, recommendedAction, tone, category, keywords, priority, examples } = req.body || {};
    if (!situation || typeof situation !== 'string' || !situation.trim()) {
      throw new AppError('Campo "situation" obrigatorio', 400);
    }
    if (!recommendedAction || typeof recommendedAction !== 'string' || !recommendedAction.trim()) {
      throw new AppError('Campo "recommendedAction" obrigatorio', 400);
    }
    const rule = await prisma.aiCoachingRule.create({
      data: {
        workspaceId: req.user!.workspaceId,
        situation: String(situation).trim().slice(0, 1000),
        recommendedAction: String(recommendedAction).trim().slice(0, 2000),
        tone: typeof tone === 'string' ? tone.trim().slice(0, 120) || null : null,
        category: typeof category === 'string' ? category.trim().slice(0, 60) || null : null,
        keywords: Array.isArray(keywords)
          ? keywords.filter((k: any) => typeof k === 'string').map((k: string) => k.trim().toLowerCase()).slice(0, 12)
          : [],
        priority: Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.trunc(priority))) : 0,
        examples: Array.isArray(examples) ? examples.slice(0, 6) : [],
        source: 'manual',
        confidence: 1.0,
        isActive: true,
        createdById: req.user!.id,
      },
    });
    res.status(201).json({ rule });
  } catch (e) { next(e); }
});

// PATCH /api/ai-coaching/rules/:id
router.patch('/rules/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const id = req.params.id;
    const existing = await prisma.aiCoachingRule.findFirst({
      where: { id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Regra nao encontrada', 404);

    const { situation, recommendedAction, tone, category, keywords, priority, examples, isActive } = req.body || {};
    const data: any = {};
    if (typeof situation === 'string') data.situation = situation.trim().slice(0, 1000);
    if (typeof recommendedAction === 'string') data.recommendedAction = recommendedAction.trim().slice(0, 2000);
    if ('tone' in (req.body || {})) data.tone = typeof tone === 'string' ? tone.trim().slice(0, 120) || null : null;
    if ('category' in (req.body || {})) data.category = typeof category === 'string' ? category.trim().slice(0, 60) || null : null;
    if (Array.isArray(keywords)) {
      data.keywords = keywords.filter((k: any) => typeof k === 'string').map((k: string) => k.trim().toLowerCase()).slice(0, 12);
    }
    if (Number.isFinite(priority)) data.priority = Math.max(0, Math.min(100, Math.trunc(priority)));
    if (Array.isArray(examples)) data.examples = examples.slice(0, 6);
    if (typeof isActive === 'boolean') data.isActive = isActive;

    const rule = await prisma.aiCoachingRule.update({ where: { id }, data });
    res.json({ rule });
  } catch (e) { next(e); }
});

// DELETE /api/ai-coaching/rules/:id
router.delete('/rules/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const id = req.params.id;
    const existing = await prisma.aiCoachingRule.findFirst({
      where: { id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Regra nao encontrada', 404);
    await prisma.aiCoachingRule.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// =====================================================================
// Sessoes de coaching (conversas com o coach)
// =====================================================================

router.get('/conversations', async (req: AuthRequest, res: Response, next) => {
  try {
    const list = await prisma.aiCoachConversation.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    res.json({ conversations: list });
  } catch (e) { next(e); }
});

router.post('/conversations', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const conv = await prisma.aiCoachConversation.create({
      data: {
        workspaceId: req.user!.workspaceId,
        title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 100) : null,
        messages: [] as any,
        createdById: req.user!.id,
      },
    });
    res.status(201).json({ conversation: conv });
  } catch (e) { next(e); }
});

router.get('/conversations/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const conv = await prisma.aiCoachConversation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!conv) throw new AppError('Conversa nao encontrada', 404);
    res.json({ conversation: conv });
  } catch (e) { next(e); }
});

router.delete('/conversations/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const conv = await prisma.aiCoachConversation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!conv) throw new AppError('Conversa nao encontrada', 404);
    await prisma.aiCoachConversation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/ai-coaching/chat
// Body: { conversationId?: string, message: string }
// Cria sessao se nao houver conversationId. Devolve resposta do coach +
// regras criadas/editadas + conversa actualizada.
router.post('/chat', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const { conversationId, message } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw new AppError('Mensagem vazia', 400);
    }

    let conv = null as any;
    if (conversationId) {
      conv = await prisma.aiCoachConversation.findFirst({
        where: { id: conversationId, workspaceId: req.user!.workspaceId },
      });
      if (!conv) throw new AppError('Conversa nao encontrada', 404);
    } else {
      conv = await prisma.aiCoachConversation.create({
        data: {
          workspaceId: req.user!.workspaceId,
          title: message.slice(0, 80),
          messages: [] as any,
          createdById: req.user!.id,
        },
      });
    }

    const history: CoachMessage[] = Array.isArray(conv.messages) ? (conv.messages as any[]).map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      rulesCreated: m.rulesCreated,
    })) : [];

    let result;
    try {
      result = await coachReply({
        workspaceId: req.user!.workspaceId,
        history,
        userMessage: message,
      });
    } catch (e: any) {
      throw new AppError(`Coach falhou: ${e?.message || e}`, 502);
    }

    // Aplicar as accoes (criar/editar/desactivar regras)
    const applied = await applyCoachActions(req.user!.workspaceId, result.actions, req.user!.id, 'coach_chat');
    const newRuleIds = applied.filter((a) => a.type === 'create_rule' && a.ok).map((a) => a.ruleId);
    const updatedRuleIds = applied.filter((a) => a.type !== 'create_rule' && a.ok).map((a) => a.ruleId);

    const now = new Date().toISOString();
    const newHistory = [
      ...history,
      { role: 'user' as const, content: message, createdAt: now },
      { role: 'assistant' as const, content: result.reply, createdAt: now, rulesCreated: newRuleIds, rulesUpdated: updatedRuleIds },
    ];

    const updatedConv = await prisma.aiCoachConversation.update({
      where: { id: conv.id },
      data: {
        messages: newHistory as any,
        title: conv.title || message.slice(0, 80),
      },
    });

    // Carrega as regras criadas para devolver ao frontend
    let newRules: any[] = [];
    if (newRuleIds.length > 0) {
      newRules = await prisma.aiCoachingRule.findMany({ where: { id: { in: newRuleIds } } });
    }

    res.json({
      conversationId: updatedConv.id,
      reply: result.reply,
      messages: newHistory,
      actionsApplied: applied,
      newRules,
    });
  } catch (e) { next(e); }
});

// =====================================================================
// Auto-learning manual (admin pode forcar a correr)
// =====================================================================

router.post('/auto-learn/run', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const result = await autoLearnFromConversations(req.user!.workspaceId);
    res.json(result);
  } catch (e) { next(e); }
});

// Estatisticas rapidas para o dashboard da aba
router.get('/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const [total, active, autoLearned, coachTaught, manual, mostUsed] = await Promise.all([
      prisma.aiCoachingRule.count({ where: { workspaceId } }),
      prisma.aiCoachingRule.count({ where: { workspaceId, isActive: true } }),
      prisma.aiCoachingRule.count({ where: { workspaceId, source: 'auto_learned' } }),
      prisma.aiCoachingRule.count({ where: { workspaceId, source: 'coach_chat' } }),
      prisma.aiCoachingRule.count({ where: { workspaceId, source: 'manual' } }),
      prisma.aiCoachingRule.findMany({
        where: { workspaceId, isActive: true },
        orderBy: { timesApplied: 'desc' },
        take: 5,
        select: { id: true, situation: true, timesApplied: true, lastAppliedAt: true },
      }),
    ]);
    res.json({ total, active, autoLearned, coachTaught, manual, mostUsed });
  } catch (e) { next(e); }
});

export default router;
