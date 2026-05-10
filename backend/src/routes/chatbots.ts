import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { runChatbotById } from '../lib/chatbotEngine';

const router = Router();
const prisma = new PrismaClient();

const flowInclude = {
  createdBy: { select: { id: true, name: true, avatar: true } },
  _count: { select: { sessions: true } },
};

// ── GET /api/chatbots ─────────────────────────────────
// Lista todos os fluxos do workspace
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const flows = await prisma.chatbotFlow.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: flowInclude,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(flows);
  } catch (e) { next(e); }
});

// ── GET /api/chatbots/:id ─────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const flow = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: flowInclude,
    });
    if (!flow) throw new AppError('Chatbot não encontrado', 404);
    res.json(flow);
  } catch (e) { next(e); }
});

// ── POST /api/chatbots ────────────────────────────────
// Cria um novo fluxo
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, trigger, triggerValue, channel, nodes, edges, isActive } = req.body;
    if (!name) throw new AppError('Nome obrigatório', 400);

    const flow = await prisma.chatbotFlow.create({
      data: {
        name,
        description: description || null,
        trigger: trigger || 'first_message',
        triggerValue: triggerValue || null,
        channel: channel || 'WHATSAPP',
        nodes: nodes || [],
        edges: edges || [],
        isActive: isActive !== false,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
      },
      include: flowInclude,
    });

    res.status(201).json(flow);
  } catch (e) { next(e); }
});

// ── PATCH /api/chatbots/:id ───────────────────────────
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Chatbot não encontrado', 404);

    const { name, description, trigger, triggerValue, channel, nodes, edges, isActive } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (trigger !== undefined) data.trigger = trigger;
    if (triggerValue !== undefined) data.triggerValue = triggerValue;
    if (channel !== undefined) data.channel = channel;
    if (nodes !== undefined) data.nodes = nodes;
    if (edges !== undefined) data.edges = edges;
    if (isActive !== undefined) data.isActive = isActive;

    const flow = await prisma.chatbotFlow.update({
      where: { id: req.params.id },
      data,
      include: flowInclude,
    });

    res.json(flow);
  } catch (e) { next(e); }
});

// ── DELETE /api/chatbots/:id ──────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Chatbot não encontrado', 404);

    await prisma.chatbotFlow.delete({ where: { id: req.params.id } });
    res.json({ message: 'Chatbot eliminado' });
  } catch (e) { next(e); }
});

// ── POST /api/chatbots/:id/duplicate ──────────────────
router.post('/:id/duplicate', async (req: AuthRequest, res: Response, next) => {
  try {
    const original = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!original) throw new AppError('Chatbot não encontrado', 404);

    const copy = await prisma.chatbotFlow.create({
      data: {
        name: `${original.name} (cópia)`,
        description: original.description,
        trigger: original.trigger,
        triggerValue: original.triggerValue,
        channel: original.channel,
        nodes: original.nodes as any,
        edges: original.edges as any,
        isActive: false,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
      },
      include: flowInclude,
    });

    res.status(201).json(copy);
  } catch (e) { next(e); }
});

// ── GET /api/chatbots/:id/sessions ────────────────────
// Lista sessões activas (debug / monitorização)
router.get('/:id/sessions', async (req: AuthRequest, res: Response, next) => {
  try {
    const flow = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!flow) throw new AppError('Chatbot não encontrado', 404);

    const sessions = await prisma.chatbotSession.findMany({
      where: { flowId: flow.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    // Acrescentar info de contacto manualmente (para evitar relação cruzada complexa)
    const contactIds = Array.from(new Set(sessions.map((s) => s.contactId)));
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true },
    });
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    res.json(sessions.map((s) => ({ ...s, contact: contactMap.get(s.contactId) || null })));
  } catch (e) { next(e); }
});

// ── DELETE /api/chatbots/:id/sessions ─────────────────
// Limpa todas as sessões de um fluxo
router.delete('/:id/sessions', async (req: AuthRequest, res: Response, next) => {
  try {
    const flow = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!flow) throw new AppError('Chatbot não encontrado', 404);

    const result = await prisma.chatbotSession.deleteMany({ where: { flowId: flow.id } });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

// ── POST /api/chatbots/:id/test ───────────────────────
// Executa o fluxo manualmente para um contacto específico (modo teste, sem enviar WhatsApp real se dryRun=true)
router.post('/:id/test', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, message, dryRun } = req.body;
    const flow = await prisma.chatbotFlow.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!flow) throw new AppError('Chatbot não encontrado', 404);
    if (!contactId) throw new AppError('contactId obrigatório', 400);

    const log = await runChatbotById(flow.id, {
      workspaceId: req.user!.workspaceId,
      contactId,
      message: message || '',
      dryRun: dryRun !== false,
    });

    res.json({ log });
  } catch (e) { next(e); }
});

export default router;
