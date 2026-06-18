import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { buildSalesSystemPrompt } from '../lib/buildSalesSystemPrompt';
import { SALES_PRINCIPLES, SOURCE_BOOKS, DEFAULT_ACTIVE_PRINCIPLES } from '../data/salesKnowledge';
import { SECTOR_KNOWLEDGE, listSectorKeys } from '../data/sectorKnowledge';

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

// PATCH /api/sales-agent/config
// Actualiza persona, sector, voz da marca e instrucoes livres.
// Nao deixa o utilizador escrever directamente sobre a memoria aprendida
// (essa e gerada pelo job nocturno da Fase 4).
router.patch('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const { sector, aiAgentName, aiAgentRole, aiBrandVoice, aiAgentInstructions } = req.body || {};

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
    if (aiAgentInstructions !== undefined) data.aiAgentInstructions = typeof aiAgentInstructions === 'string' ? aiAgentInstructions.trim().slice(0, 4000) || null : null;

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

export default router;
