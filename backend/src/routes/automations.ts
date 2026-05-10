import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { testAutomation } from '../lib/automationEngine';

const router = Router();
const prisma = new PrismaClient();

const automationInclude = {
  createdBy: { select: { id: true, name: true, avatar: true } },
};

// GET /api/automations
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const automations = await prisma.automation.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: automationInclude,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(automations);
  } catch (e) { next(e); }
});

// GET /api/automations/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const automation = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: automationInclude,
    });
    if (!automation) throw new AppError('Automação não encontrada', 404);
    res.json(automation);
  } catch (e) { next(e); }
});

// POST /api/automations
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, trigger, conditions, actions, isActive } = req.body;
    if (!name) throw new AppError('Nome obrigatório', 400);

    const automation = await prisma.automation.create({
      data: {
        name,
        description: description || null,
        trigger: trigger || { type: 'lead_created' },
        conditions: conditions || [],
        actions: actions || [],
        isActive: isActive !== false,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
      },
      include: automationInclude,
    });
    res.status(201).json(automation);
  } catch (e) { next(e); }
});

// PATCH /api/automations/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Automação não encontrada', 404);

    const { name, description, trigger, conditions, actions, isActive } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (trigger !== undefined) data.trigger = trigger;
    if (conditions !== undefined) data.conditions = conditions;
    if (actions !== undefined) data.actions = actions;
    if (isActive !== undefined) data.isActive = isActive;

    const automation = await prisma.automation.update({
      where: { id: req.params.id },
      data,
      include: automationInclude,
    });
    res.json(automation);
  } catch (e) { next(e); }
});

// DELETE /api/automations/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Automação não encontrada', 404);
    await prisma.automation.delete({ where: { id: req.params.id } });
    res.json({ message: 'Automação eliminada' });
  } catch (e) { next(e); }
});

// POST /api/automations/:id/duplicate
router.post('/:id/duplicate', async (req: AuthRequest, res: Response, next) => {
  try {
    const original = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!original) throw new AppError('Automação não encontrada', 404);

    const copy = await prisma.automation.create({
      data: {
        name: `${original.name} (cópia)`,
        description: original.description,
        trigger: original.trigger as any,
        conditions: original.conditions as any,
        actions: original.actions as any,
        isActive: false,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
      },
      include: automationInclude,
    });
    res.status(201).json(copy);
  } catch (e) { next(e); }
});

// POST /api/automations/:id/test
router.post('/:id/test', async (req: AuthRequest, res: Response, next) => {
  try {
    const { entityId } = req.body;
    const automation = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!automation) throw new AppError('Automação não encontrada', 404);

    const result = await testAutomation(req.params.id, entityId);
    res.json(result);
  } catch (e) { next(e); }
});

// GET /api/automations/:id/runs
router.get('/:id/runs', async (req: AuthRequest, res: Response, next) => {
  try {
    const automation = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!automation) throw new AppError('Automação não encontrada', 404);

    const runs = await prisma.automationRun.findMany({
      where: { automationId: automation.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(runs);
  } catch (e) { next(e); }
});

// DELETE /api/automations/:id/runs (limpar histórico)
router.delete('/:id/runs', async (req: AuthRequest, res: Response, next) => {
  try {
    const automation = await prisma.automation.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!automation) throw new AppError('Automação não encontrada', 404);

    const result = await prisma.automationRun.deleteMany({ where: { automationId: automation.id } });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

export default router;
