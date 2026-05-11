import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { triggerAutomations } from '../lib/automationEngine';
const prisma = new PrismaClient();
const router = Router();

const taskInclude = {
  assignedTo: { select: { id: true, name: true, avatar: true } },
  lead: { select: { id: true, title: true, pipelineId: true } },
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true, avatar: true } },
  subtasks: { orderBy: { createdAt: 'asc' as const } },
  tags: { include: { tag: true } },
};

router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId, contactId, status, type, priority, assignedToId, dueFrom, dueTo, search, tagId, parentOnly } = req.query;
    const where: any = { assignedTo: { workspaceId: req.user!.workspaceId } };
    if (leadId) where.leadId = leadId;
    if (contactId) where.contactId = contactId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) where.title = { contains: search as string, mode: 'insensitive' };
    if (tagId) where.tags = { some: { tagId: tagId as string } };
    if (parentOnly === 'true') where.parentTaskId = null;
    // Visibilidade restrita
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') where.assignedToId = req.user!.id;
    if (dueFrom || dueTo) {
      where.dueAt = {};
      if (dueFrom) where.dueAt.gte = new Date(dueFrom as string);
      if (dueTo) where.dueAt.lte = new Date(dueTo as string);
    }
    const tasks = await prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: { dueAt: 'asc' },
    });
    res.json(tasks);
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { title, description, type, status, priority, dueAt, leadId, contactId: rawContactId, assignedToId, recurrence, parentTaskId, tags, force } = req.body;

    // Linking automático: se leadId, popular contactId a partir do lead; se contactId, popular leadId do lead aberto desse contacto
    let finalLeadId: string | null = leadId || null;
    let finalContactId: string | null = rawContactId || null;
    if (finalLeadId && !finalContactId) {
      const lead = await prisma.lead.findUnique({ where: { id: finalLeadId }, select: { contactId: true } });
      if (lead?.contactId) finalContactId = lead.contactId;
    }
    if (finalContactId && !finalLeadId) {
      const lead = await prisma.lead.findFirst({
        where: { contactId: finalContactId, status: 'OPEN', workspaceId: req.user!.workspaceId },
        orderBy: { updatedAt: 'desc' },
      });
      if (lead) finalLeadId = lead.id;
    }

    // Verificar se já existe tarefa pendente (lead OU contact)
    if (!parentTaskId && !force && (finalLeadId || finalContactId)) {
      const orFilters: any[] = [];
      if (finalLeadId) orFilters.push({ leadId: finalLeadId });
      if (finalContactId) orFilters.push({ contactId: finalContactId });
      const existing = await prisma.task.findFirst({
        where: {
          parentTaskId: null,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          OR: orFilters,
        },
        include: taskInclude,
      });
      if (existing) {
        return res.status(409).json({
          message: 'Já existe uma tarefa pendente para este lead/contacto.',
          existingTask: existing,
          hint: 'Conclui a tarefa existente, ou envia force:true para criar mesmo assim.',
        });
      }
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        type: type || 'CALL',
        status: status || 'PENDING',
        priority: priority || 'MEDIUM',
        dueAt: dueAt ? new Date(dueAt) : null,
        leadId: finalLeadId,
        contactId: finalContactId,
        recurrence: recurrence || null,
        parentTaskId: parentTaskId || null,
        assignedToId: assignedToId || req.user!.id,
        tags: Array.isArray(tags) && tags.length
          ? { create: tags.map((tagId: string) => ({ tagId })) }
          : undefined,
      },
      include: taskInclude,
    });
    if (task.leadId && !parentTaskId) {
      await prisma.activity.create({
        data: { type: 'TASK_CREATED', description: `Tarefa "${task.title}" criada`, leadId: task.leadId, userId: req.user!.id },
      });
    }
    triggerAutomations({ type: 'task_created', workspaceId: req.user!.workspaceId, entityType: 'task', entityId: task.id }).catch(() => {});
    res.status(201).json(task);
  } catch (e) { next(e); }
});

// Helper: calcular proxima ocorrencia
function nextDueDate(dueAt: Date, recurrence: string): Date {
  const d = new Date(dueAt);
  switch (recurrence) {
    case 'DAILY': d.setDate(d.getDate() + 1); break;
    case 'WEEKLY': d.setDate(d.getDate() + 7); break;
    case 'MONTHLY': d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tags, ...rest } = req.body;
    const data: any = { ...rest };
    if (data.dueAt) data.dueAt = new Date(data.dueAt);
    if (data.status === 'COMPLETED') data.completedAt = new Date();
    if (data.status && data.status !== 'COMPLETED') data.completedAt = null;

    if (Array.isArray(tags)) {
      await prisma.tagOnTask.deleteMany({ where: { taskId: req.params.id } });
      if (tags.length) {
        await prisma.tagOnTask.createMany({
          data: tags.map((tagId: string) => ({ taskId: req.params.id, tagId })),
        });
      }
    }

    const before = await prisma.task.findUnique({ where: { id: req.params.id } });
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
      include: taskInclude,
    });

    // Se concluiu uma tarefa recorrente, criar a proxima
    if (
      before && before.status !== 'COMPLETED' && task.status === 'COMPLETED' &&
      task.recurrence && task.dueAt && !task.parentTaskId
    ) {
      const nextDue = nextDueDate(task.dueAt, task.recurrence);
      await prisma.task.create({
        data: {
          title: task.title,
          description: task.description,
          type: task.type,
          status: 'PENDING',
          priority: task.priority,
          dueAt: nextDue,
          leadId: task.leadId,
          recurrence: task.recurrence,
          assignedToId: task.assignedToId,
        },
      });
    }

    if (req.body.status === 'COMPLETED' && task.leadId) {
      await prisma.activity.create({
        data: { type: 'TASK_COMPLETED', description: `Tarefa "${task.title}" concluída`, leadId: task.leadId, userId: req.user!.id },
      });
    }
    if (before && before.status !== 'COMPLETED' && task.status === 'COMPLETED') {
      triggerAutomations({ type: 'task_completed', workspaceId: req.user!.workspaceId, entityType: 'task', entityId: task.id }).catch(() => {});
    }
    res.json(task);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tarefa eliminada' });
  } catch (e) { next(e); }
});

// Bulk operations
router.post('/bulk-complete', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids vazio', 400);
    const result = await prisma.task.updateMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (e) { next(e); }
});

router.post('/bulk-delete', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids vazio', 400);
    const result = await prisma.task.deleteMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
    });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

router.post('/bulk-assign', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids, assignedToId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !assignedToId) throw new AppError('ids e assignedToId obrigatorios', 400);
    const result = await prisma.task.updateMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
      data: { assignedToId },
    });
    res.json({ updated: result.count });
  } catch (e) { next(e); }
});

// Tags
router.post('/:id/tags', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tagId } = req.body;
    if (!tagId) throw new AppError('tagId obrigatorio', 400);
    await prisma.tagOnTask.create({ data: { taskId: req.params.id, tagId } }).catch(() => {});
    const task = await prisma.task.findUnique({ where: { id: req.params.id }, include: taskInclude });
    res.json(task);
  } catch (e) { next(e); }
});

router.delete('/:id/tags/:tagId', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.tagOnTask.deleteMany({ where: { taskId: req.params.id, tagId: req.params.tagId } });
    res.json({ message: 'Tag removida' });
  } catch (e) { next(e); }
});

export default router;
