import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { buildSalesSystemPrompt } from '../lib/buildSalesSystemPrompt';
import { SALES_PRINCIPLES, SOURCE_BOOKS, DEFAULT_ACTIVE_PRINCIPLES } from '../data/salesKnowledge';
import { SECTOR_KNOWLEDGE, listSectorKeys } from '../data/sectorKnowledge';
import { generateSalesSuggestion, AgentError, AI_RESET_MARKER } from '../lib/aiSalesAgent';
import { dispatchSalesParts } from '../lib/autoDispatchSalesSuggestion';
import { consolidateWorkspaceMemory } from '../lib/salesLearningConsolidator';

const router = Router();

// Garante que so OWNER e ADMIN editam a config da IA Vendedora.
function requireAdmin(req: AuthRequest) {
  if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
    throw new AppError('Apenas administradores podem alterar a configuracao da IA Vendedora', 403);
  }
}

// GET /api/sales-agent/config
// Devolve a configuracao actual da IA Vendedora para o workspace do utilizador.
router.get('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
    if (!ws) throw new AppError('Workspace nao encontrado', 404);
    res.json({
      sector: ws.sector,
      aiAgentName: ws.aiAgentName,
      aiAgentRole: ws.aiAgentRole,
      aiBrandVoice: ws.aiBrandVoice,
      aiAgentInstructions: ws.aiAgentInstructions,
      aiLearnedMemory: ws.aiLearnedMemory,
    });
  } catch (e) { next(e); }
});

// GET /api/sales-agent/config (campos extra da Fase 3)
// Acima ja devolve os campos de persona/sector. Para Fase 3, tambem
// devolvemos os campos de execucao: aiSalesEnabled, modo, conversas
// activas e palavras de handoff.
router.get('/runtime-config', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
    if (!ws) throw new AppError('Workspace nao encontrado', 404);
    res.json({
      aiSalesEnabled: ws.aiSalesEnabled,
      aiSalesMode: ws.aiSalesMode,
      aiSalesEnabledConversationIds: ws.aiSalesEnabledConversationIds,
      aiSalesMaxParts: ws.aiSalesMaxParts,
      aiSalesHandoffTriggers: ws.aiSalesHandoffTriggers,
    });
  } catch (e) { next(e); }
});

// PATCH /api/sales-agent/config
// Actualiza persona, sector, voz da marca e instrucoes livres.
// Nao deixa o utilizador escrever directamente sobre a memoria aprendida
// (essa e gerada pelo job nocturno da Fase 4).
router.patch('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const {
      sector, aiAgentName, aiAgentRole, aiBrandVoice, aiAgentInstructions,
      aiSalesEnabled, aiSalesMode, aiSalesEnabledConversationIds,
      aiSalesMaxParts, aiSalesHandoffTriggers,
    } = req.body || {};

    const validSectors = listSectorKeys();
    const data: any = {};
    if (sector !== undefined) {
      if (!validSectors.includes(sector)) {
        throw new AppError(`Sector invalido. Use um de: ${validSectors.join(', ')}`, 400);
      }
      data.sector = sector;
    }
    if (aiAgentName !== undefined) data.aiAgentName = typeof aiAgentName === 'string' ? aiAgentName.trim().slice(0, 60) || null : null;
    if (aiAgentRole !== undefined) data.aiAgentRole = typeof aiAgentRole === 'string' ? aiAgentRole.trim().slice(0, 60) || null : null;
    if (aiBrandVoice !== undefined) data.aiBrandVoice = typeof aiBrandVoice === 'string' ? aiBrandVoice.trim().slice(0, 2000) || null : null;
    if (aiAgentInstructions !== undefined) data.aiAgentInstructions = typeof aiAgentInstructions === 'string' ? aiAgentInstructions.trim().slice(0, 8000) || null : null;
    // Campos da Fase 3
    if (aiSalesEnabled !== undefined) data.aiSalesEnabled = !!aiSalesEnabled;
    if (aiSalesMode !== undefined) {
      if (!['supervised', 'auto'].includes(aiSalesMode)) {
        throw new AppError('aiSalesMode deve ser "supervised" ou "auto"', 400);
      }
      data.aiSalesMode = aiSalesMode;
    }
    if (aiSalesEnabledConversationIds !== undefined) {
      if (!Array.isArray(aiSalesEnabledConversationIds)) {
        throw new AppError('aiSalesEnabledConversationIds deve ser array', 400);
      }
      data.aiSalesEnabledConversationIds = aiSalesEnabledConversationIds
        .filter((x: any) => typeof x === 'string' && x.trim())
        .slice(0, 5000) as any;
    }
    if (aiSalesMaxParts !== undefined) {
      const n = Number(aiSalesMaxParts);
      if (!Number.isInteger(n) || n < 1 || n > 6) {
        throw new AppError('aiSalesMaxParts deve ser inteiro entre 1 e 6', 400);
      }
      data.aiSalesMaxParts = n;
    }
    if (aiSalesHandoffTriggers !== undefined) {
      if (!Array.isArray(aiSalesHandoffTriggers)) {
        throw new AppError('aiSalesHandoffTriggers deve ser array', 400);
      }
      data.aiSalesHandoffTriggers = aiSalesHandoffTriggers
        .filter((x: any) => typeof x === 'string' && x.trim())
        .map((x: string) => x.trim().toLowerCase())
        .slice(0, 50) as any;
    }

    const updated = await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data,
    });
    res.json({
      sector: updated.sector,
      aiAgentName: updated.aiAgentName,
      aiAgentRole: updated.aiAgentRole,
      aiBrandVoice: updated.aiBrandVoice,
      aiAgentInstructions: updated.aiAgentInstructions,
      aiLearnedMemory: updated.aiLearnedMemory,
      aiSalesEnabled: updated.aiSalesEnabled,
      aiSalesMode: updated.aiSalesMode,
      aiSalesEnabledConversationIds: updated.aiSalesEnabledConversationIds,
      aiSalesMaxParts: updated.aiSalesMaxParts,
      aiSalesHandoffTriggers: updated.aiSalesHandoffTriggers,
    });
  } catch (e) { next(e); }
});

// GET /api/sales-agent/knowledge
// Devolve o conhecimento que sera injectado no system prompt da IA, util
// para debug e preview na pagina de configuracao. Aceita query
// ?principles=key1,key2 para experimentar conjuntos especificos.
router.get('/knowledge', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
    if (!ws) throw new AppError('Workspace nao encontrado', 404);

    const principlesParam = typeof req.query.principles === 'string' ? req.query.principles : '';
    const activeKeys = principlesParam
      ? principlesParam.split(',').map((s) => s.trim()).filter((s) => SALES_PRINCIPLES[s])
      : DEFAULT_ACTIVE_PRINCIPLES;

    const systemPrompt = buildSalesSystemPrompt(ws, { activePrincipleKeys: activeKeys });

    res.json({
      sector: {
        key: ws.sector,
        label: SECTOR_KNOWLEDGE[ws.sector as keyof typeof SECTOR_KNOWLEDGE]?.label || 'Generico',
      },
      activePrinciples: activeKeys.map((k) => {
        const p = SALES_PRINCIPLES[k];
        return p ? { key: p.key, title: p.title, book: p.book, author: p.author, summary: p.summary } : null;
      }).filter(Boolean),
      sourceBooks: SOURCE_BOOKS,
      systemPrompt,
      // Estatisticas para a UI mostrar de relance.
      stats: {
        principlesAvailable: Object.keys(SALES_PRINCIPLES).length,
        principlesActive: activeKeys.length,
        sectorsAvailable: listSectorKeys().length,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/sales-agent/principles
// Lista completa dos principios disponiveis, para a UI permitir escolha
// ou apresentacao em forma de catalogo.
router.get('/principles', async (_req: AuthRequest, res: Response, next) => {
  try {
    res.json({
      books: SOURCE_BOOKS,
      principles: Object.values(SALES_PRINCIPLES),
      defaults: DEFAULT_ACTIVE_PRINCIPLES,
    });
  } catch (e) { next(e); }
});

// GET /api/sales-agent/sectors
// Lista os sectores conhecidos com label e contagem de objeccoes.
router.get('/sectors', async (_req: AuthRequest, res: Response, next) => {
  try {
    const items = listSectorKeys().map((k) => ({
      key: k,
      label: SECTOR_KNOWLEDGE[k].label,
      objections: SECTOR_KNOWLEDGE[k].objections.length,
      discoveryQuestions: SECTOR_KNOWLEDGE[k].discoveryQuestions.length,
      closingTactics: SECTOR_KNOWLEDGE[k].closingTactics.length,
    }));
    res.json(items);
  } catch (e) { next(e); }
});

// =====================================================================
//                     FASE 3: SUGESTOES DA IA VENDEDORA
// =====================================================================

// POST /api/sales-agent/suggest
// Gera uma sugestao da IA para uma conversa especifica. Em modo
// supervisionado, fica PENDING ate o humano decidir. Util para testar
// via curl e para o botao "Sugerir resposta" no Inbox.
//
// Body: { contactId: string, leadId?: string, triggerMessageId?: string,
//         activePrincipleKeys?: string[], model?: string }
router.post('/suggest', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId, triggerMessageId, activePrincipleKeys, model } = req.body || {};
    if (!contactId || typeof contactId !== 'string') {
      throw new AppError('contactId obrigatorio', 400);
    }

    // Verifica que o contacto e do workspace do utilizador.
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado neste workspace', 404);

    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: leadId, workspaceId: req.user!.workspaceId },
      });
      if (!lead) throw new AppError('Lead nao encontrado neste workspace', 404);
    }

    try {
      const { suggestion, normalized } = await generateSalesSuggestion({
        workspaceId: req.user!.workspaceId,
        contactId,
        leadId: leadId || null,
        triggerMessageId: triggerMessageId || null,
        activePrincipleKeys: Array.isArray(activePrincipleKeys) ? activePrincipleKeys : undefined,
        model: typeof model === 'string' ? model : undefined,
      });
      const io = (global as any).io;
      if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('aiSales:suggestion', suggestion);
      res.json({ suggestion, normalized });
    } catch (e: any) {
      if (e instanceof AgentError) throw new AppError(e.message, e.status);
      throw e;
    }
  } catch (e) { next(e); }
});

// GET /api/sales-agent/suggestions
// Lista sugestoes do workspace, filtros opcionais.
// Query: status (PENDING|APPROVED|EDITED|DISCARDED|SENT|FAILED|all)
//        contactId, leadId, limit (default 50, max 200)
router.get('/suggestions', async (req: AuthRequest, res: Response, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
    const contactId = typeof req.query.contactId === 'string' ? req.query.contactId : undefined;
    const leadId = typeof req.query.leadId === 'string' ? req.query.leadId : undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const where: any = { workspaceId: req.user!.workspaceId };
    if (status && status !== 'all') where.status = status;
    if (contactId) where.contactId = contactId;
    if (leadId) where.leadId = leadId;

    const items = await prisma.aiSalesSuggestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true } },
        lead: { select: { id: true, title: true, value: true } },
        triggerMessage: { select: { id: true, content: true, createdAt: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    res.json(items);
  } catch (e) { next(e); }
});

// GET /api/sales-agent/suggestions/:id
router.get('/suggestions/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const item = await prisma.aiSalesSuggestion.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true } },
        lead: { select: { id: true, title: true, value: true } },
        triggerMessage: { select: { id: true, content: true, createdAt: true, direction: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    if (!item) throw new AppError('Sugestao nao encontrada', 404);
    res.json(item);
  } catch (e) { next(e); }
});

// Wrapper compatibilidade: usa dispatchSalesParts (autoDispatchSalesSuggestion.ts)
// que ja inclui presence "composing" + pausa proporcional ao tamanho da proxima
// mensagem para simular digitacao humana.
async function dispatchSuggestion(
  workspaceId: string,
  contactPhone: string,
  contactId: string,
  leadId: string | null,
  parts: string[],
  productFiles: Array<{ id: string; url: string; type: string; name?: string | null }>,
  sentById: string | null,
  io: any,
): Promise<{ sentMessageIds: string[]; failedAt?: number; error?: string }> {
  return dispatchSalesParts({
    workspaceId, contactId, contactPhone, leadId, parts, productFiles, sentById, io,
  });
}

// POST /api/sales-agent/suggestions/:id/approve
// Aceita a sugestao como esta e envia. Em handoff, atribui a conversa ao
// utilizador especificado em body.assignedToId (ou ao proprio approver).
router.post('/suggestions/:id/approve', async (req: AuthRequest, res: Response, next) => {
  try {
    const suggestion = await prisma.aiSalesSuggestion.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: { contact: true },
    });
    if (!suggestion) throw new AppError('Sugestao nao encontrada', 404);
    if (suggestion.status !== 'PENDING') {
      throw new AppError(`Sugestao ja foi decidida (${suggestion.status})`, 400);
    }

    const partsArr = Array.isArray(suggestion.parts) ? (suggestion.parts as any[]).filter((p) => typeof p === 'string') : [];

    // Handoff puro: nao envia nada para o lead, atribui conversa.
    if (suggestion.action === 'handoff') {
      const assignedToId = req.body?.assignedToId || req.user!.id;
      await prisma.conversationMeta.upsert({
        where: { workspaceId_contactId_channel: { workspaceId: suggestion.workspaceId, contactId: suggestion.contactId, channel: 'WHATSAPP' } },
        create: { workspaceId: suggestion.workspaceId, contactId: suggestion.contactId, channel: 'WHATSAPP', assignedToId },
        update: { assignedToId },
      });
      const updated = await prisma.aiSalesSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: req.user!.id, finalParts: partsArr as any },
      });
      const ioH = (global as any).io;
      if (ioH) ioH.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
      return res.json({ suggestion: updated, handoff: { assignedToId } });
    }

    // Wait: nao faz nada, marca como aprovada.
    if (suggestion.action === 'wait') {
      const updated = await prisma.aiSalesSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedById: req.user!.id, finalParts: [] as any },
      });
      const ioW = (global as any).io;
      if (ioW) ioW.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
      return res.json({ suggestion: updated });
    }

    // send_text / send_product: envia para o WhatsApp.
    const phone = suggestion.contact.whatsapp || suggestion.contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp/telefone', 400);

    let productFiles: Array<{ id: string; url: string; type: string; name?: string | null }> = [];
    if (suggestion.action === 'send_product' && Array.isArray(suggestion.productFileIds)) {
      const ids = (suggestion.productFileIds as any[]).filter((x) => typeof x === 'string');
      if (ids.length > 0) {
        const files = await prisma.file.findMany({ where: { id: { in: ids } } });
        productFiles = files.map((f) => ({ id: f.id, url: f.url, type: f.mimeType, name: f.name }));
      }
    }

    const io = (global as any).io;
    const dispatch = await dispatchSuggestion(
      suggestion.workspaceId,
      phone,
      suggestion.contactId,
      suggestion.leadId,
      partsArr,
      productFiles,
      req.user!.id,
      io,
    );

    const updated = await prisma.aiSalesSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: dispatch.error ? 'FAILED' : 'APPROVED',
        decidedAt: new Date(),
        decidedById: req.user!.id,
        finalParts: partsArr as any,
        sentMessageIds: dispatch.sentMessageIds as any,
        errorDetail: dispatch.error || null,
      },
    });
    if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
    res.json({ suggestion: updated, dispatch });
  } catch (e) { next(e); }
});

// POST /api/sales-agent/suggestions/:id/edit
// Substitui as partes pela versao editada do humano e envia.
// Body: { parts: string[] }
router.post('/suggestions/:id/edit', async (req: AuthRequest, res: Response, next) => {
  try {
    const finalParts = Array.isArray(req.body?.parts)
      ? req.body.parts.filter((p: any) => typeof p === 'string' && p.trim()).map((p: string) => p.trim())
      : [];
    if (finalParts.length === 0) throw new AppError('parts (array de strings) obrigatorio e nao vazio', 400);

    const suggestion = await prisma.aiSalesSuggestion.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: { contact: true },
    });
    if (!suggestion) throw new AppError('Sugestao nao encontrada', 404);
    if (suggestion.status !== 'PENDING') {
      throw new AppError(`Sugestao ja foi decidida (${suggestion.status})`, 400);
    }

    const phone = suggestion.contact.whatsapp || suggestion.contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp/telefone', 400);

    // Em edit, mantemos a accao original (provavelmente send_text). Se o
    // humano quiser tirar o anexo de produto, edita as partes apenas.
    let productFiles: Array<{ id: string; url: string; type: string; name?: string | null }> = [];
    if (suggestion.action === 'send_product' && req.body?.keepProductFiles !== false && Array.isArray(suggestion.productFileIds)) {
      const ids = (suggestion.productFileIds as any[]).filter((x) => typeof x === 'string');
      if (ids.length > 0) {
        const files = await prisma.file.findMany({ where: { id: { in: ids } } });
        productFiles = files.map((f) => ({ id: f.id, url: f.url, type: f.mimeType, name: f.name }));
      }
    }

    const io = (global as any).io;
    const dispatch = await dispatchSuggestion(
      suggestion.workspaceId,
      phone,
      suggestion.contactId,
      suggestion.leadId,
      finalParts,
      productFiles,
      req.user!.id,
      io,
    );

    const updated = await prisma.aiSalesSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: dispatch.error ? 'FAILED' : 'EDITED',
        decidedAt: new Date(),
        decidedById: req.user!.id,
        finalParts: finalParts as any,
        sentMessageIds: dispatch.sentMessageIds as any,
        errorDetail: dispatch.error || null,
      },
    });
    if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
    res.json({ suggestion: updated, dispatch });
  } catch (e) { next(e); }
});

// POST /api/sales-agent/suggestions/:id/discard
// Rejeita sem enviar nada. Body opcional: { reason: string }
router.post('/suggestions/:id/discard', async (req: AuthRequest, res: Response, next) => {
  try {
    const suggestion = await prisma.aiSalesSuggestion.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!suggestion) throw new AppError('Sugestao nao encontrada', 404);
    if (suggestion.status !== 'PENDING') {
      throw new AppError(`Sugestao ja foi decidida (${suggestion.status})`, 400);
    }
    const updated = await prisma.aiSalesSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'DISCARDED',
        decidedAt: new Date(),
        decidedById: req.user!.id,
        errorDetail: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      },
    });
    const ioD = (global as any).io;
    if (ioD) ioD.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
    res.json({ suggestion: updated });
  } catch (e) { next(e); }
});

// GET /api/sales-agent/learned-memory
// Devolve a memoria aprendida actual do workspace (texto livre) e ultima
// data de actualizacao (deduzida do updatedAt do workspace).
router.get('/learned-memory', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { aiLearnedMemory: true, updatedAt: true },
    });
    res.json({
      aiLearnedMemory: ws?.aiLearnedMemory || '',
      updatedAt: ws?.updatedAt || null,
    });
  } catch (e) { next(e); }
});

// PATCH /api/sales-agent/learned-memory
// Permite ao admin editar manualmente a memoria aprendida (substituir
// ou limpar). Util quando o output da consolidacao automatica precisa
// de afinacao humana.
router.patch('/learned-memory', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const text = typeof req.body?.aiLearnedMemory === 'string' ? req.body.aiLearnedMemory : '';
    const updated = await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data: { aiLearnedMemory: text.slice(0, 2000) || null },
      select: { aiLearnedMemory: true, updatedAt: true },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// POST /api/sales-agent/consolidate-now
// Forca a consolidacao da memoria do workspace actual fora da janela
// nocturna. Devolve resultado (updated, samples, reason).
router.post('/consolidate-now', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const result = await consolidateWorkspaceMemory(req.user!.workspaceId);
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/sales-agent/reset-context
// "Esquece" o historico anterior da IA Vendedora para um contacto especifico.
// Cria uma Message marker (isInternal=true, content=__AI_CONTEXT_RESET__) que
// serve de ponto de corte: geracoes futuras so consideram mensagens criadas
// DEPOIS deste momento. Util para testes (numero pessoal usado varias vezes)
// e para recomecar uma conversa do zero apos uma mudanca de produto/posicionamento.
//
// Tambem descarta sugestoes PENDING desse contacto para o painel nao mostrar
// uma sugestao baseada em historico ja "esquecido".
//
// Body: { contactId: string, leadId?: string }
router.post('/reset-context', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId } = req.body || {};
    if (!contactId || typeof contactId !== 'string') {
      throw new AppError('contactId obrigatorio', 400);
    }
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado neste workspace', 404);

    // 1. Cria o marker como mensagem interna
    const marker = await prisma.message.create({
      data: {
        content: AI_RESET_MARKER,
        channel: 'INTERNAL',
        type: 'TEXT',
        direction: 'OUTBOUND',
        status: 'SENT',
        contactId,
        leadId: leadId || null,
        isInternal: true,
        sentById: req.user!.id,
      },
    });

    // 2. Descarta sugestoes PENDENTES desse contacto (para nao mostrar
    //    sugestao baseada em contexto ja esquecido)
    const discarded = await prisma.aiSalesSuggestion.updateMany({
      where: { workspaceId: req.user!.workspaceId, contactId, status: 'PENDING' },
      data: {
        status: 'DISCARDED', decidedAt: new Date(), decidedById: req.user!.id,
        errorDetail: 'Descartada por reset de contexto',
      },
    });

    // 3. Emite socket para o frontend limpar o painel + adicionar a "mensagem" marker
    const io = (global as any).io;
    if (io) {
      io.to(`workspace:${req.user!.workspaceId}`).emit('aiSales:contextReset', {
        contactId, leadId: leadId || null, at: marker.createdAt,
      });
    }

    res.json({ ok: true, markerId: marker.id, at: marker.createdAt, discardedSuggestions: discarded.count });
  } catch (e) { next(e); }
});

export default router;
