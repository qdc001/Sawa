import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewLead } from '../lib/notify';
import { propagateAssignee } from '../lib/propagateAssignee';
import { notifyWhatsAppAssignment } from '../lib/dailyTaskDigest';

import prisma from '../lib/prisma';
const router = Router();

const leadInclude = {
  stage: true,
  pipeline: true,
  assignedTo: { select: { id: true, name: true, avatar: true } },
  contact: true,
  tags: { include: { tag: true } },
  tasks: { where: { status: { not: 'COMPLETED' } }, orderBy: { dueAt: 'asc' as const } },
  customValues: { include: { field: true } },
  _count: { select: { messages: true, notes: true, files: true } },
};

// GET /api/leads
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { pipelineId, stageId, assignedToId, status, search, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { workspaceId: req.user!.workspaceId };
    if (pipelineId) where.pipelineId = pipelineId;
    if (stageId) where.stageId = stageId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (status) where.status = status;
    if (search) where.title = { contains: search as string, mode: 'insensitive' };
    // Visibilidade restrita: AGENT com viewOnlyOwn só vê os seus
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') {
      where.assignedToId = req.user!.id;
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({ where, include: leadInclude, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error) { next(error); }
});

// GET /api/leads/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const restrictWhere: any = { id: req.params.id, workspaceId: req.user!.workspaceId };
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') restrictWhere.assignedToId = req.user!.id;
    const lead = await prisma.lead.findFirst({
      where: restrictWhere,
      include: {
        ...leadInclude,
        notes: { include: { createdBy: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'desc' } },
        messages: { orderBy: { createdAt: 'desc' }, take: 50 },
        activities: { include: { user: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'desc' }, take: 50 },
        files: { orderBy: { createdAt: 'desc' } },
        customValues: { include: { field: true } },
      },
    });

    if (!lead) throw new AppError('Lead não encontrado', 404);
    res.json(lead);
  } catch (error) { next(error); }
});

// POST /api/leads
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { title, value, pipelineId, stageId, contactId, assignedToId, priority, source, expectedCloseAt, tags, customValues } = req.body;

    if (!title || !pipelineId || !stageId) {
      throw new AppError('Título, pipeline e etapa são obrigatórios', 400);
    }

    const cleanCustomValues = Array.isArray(customValues)
      ? customValues
          .filter((cv: any) => cv && cv.fieldId && cv.value !== undefined && cv.value !== null && cv.value !== '')
          .map((cv: any) => ({ fieldId: cv.fieldId, value: String(cv.value) }))
      : [];

    const lead = await prisma.lead.create({
      data: {
        title,
        value: value ? Number(value) : null,
        pipelineId,
        stageId,
        contactId,
        assignedToId,
        priority: priority || 'MEDIUM',
        source,
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
        tags: tags ? { create: tags.map((tagId: string) => ({ tagId })) } : undefined,
        customValues: cleanCustomValues.length ? { create: cleanCustomValues } : undefined,
      },
      include: leadInclude,
    });

    await prisma.activity.create({
      data: { type: 'LEAD_CREATED', description: `Lead "${title}" criado`, leadId: lead.id, userId: req.user!.id },
    });

    const io = req.app.get('io');
    io.to(`workspace:${req.user!.workspaceId}`).emit('lead:created', lead);

    triggerAutomations({ type: 'lead_created', workspaceId: req.user!.workspaceId, entityType: 'lead', entityId: lead.id })
      .catch((e) => console.error('Automation lead_created error:', e));
    if (lead.assignedToId) {
      triggerAutomations({ type: 'lead_assigned', workspaceId: req.user!.workspaceId, entityType: 'lead', entityId: lead.id })
        .catch((e) => console.error('Automation lead_assigned error:', e));
      notifyNewLead(lead.id, lead.assignedToId).catch((e) => console.error('notifyNewLead error:', e));
      notifyWhatsAppAssignment(req.user!.workspaceId, lead.assignedToId, 'lead', lead.id).catch(() => {});
    }

    res.status(201).json(lead);
  } catch (error) { next(error); }
});

// PATCH /api/leads/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { title, value, stageId, assignedToId, contactId, priority, status, lostReason, expectedCloseAt, customValues } = req.body;

    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!existing) throw new AppError('Lead não encontrado', 404);

    // Substituir custom values se enviados
    if (Array.isArray(customValues)) {
      await prisma.customFieldValue.deleteMany({ where: { leadId: req.params.id } });
      const clean = customValues
        .filter((cv: any) => cv && cv.fieldId && cv.value !== undefined && cv.value !== null && cv.value !== '')
        .map((cv: any) => ({ fieldId: cv.fieldId, value: String(cv.value), leadId: req.params.id }));
      if (clean.length) {
        await prisma.customFieldValue.createMany({ data: clean });
      }
    }

    // Sincronizar status com tipo da etapa quando a etapa muda (excepto se o utilizador
    // também enviou status explicitamente — nesse caso respeita a escolha)
    let stageStatusSync: any = {};
    if (stageId && !status) {
      const stage = await prisma.stage.findUnique({ where: { id: stageId } });
      if (stage) {
        if (stage.type === 'WON') stageStatusSync = { status: 'WON', closedAt: new Date() };
        else if (stage.type === 'LOST') stageStatusSync = { status: 'LOST', closedAt: new Date() };
        else stageStatusSync = { status: 'OPEN', closedAt: null };
      }
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(value !== undefined && { value: Number(value) }),
        ...(stageId && { stageId }),
        ...(assignedToId !== undefined && { assignedToId }),
        ...(contactId !== undefined && { contactId }),
        ...(priority && { priority }),
        ...(status && { status, closedAt: status !== 'OPEN' ? new Date() : null }),
        ...stageStatusSync,
        ...(lostReason && { lostReason }),
        ...(expectedCloseAt && { expectedCloseAt: new Date(expectedCloseAt) }),
      },
      include: leadInclude,
    });

    if (stageId && stageId !== existing.stageId) {
      const stage = await prisma.stage.findUnique({ where: { id: stageId } });
      await prisma.activity.create({
        data: { type: 'STAGE_CHANGED', description: `Movido para "${stage?.name}"`, leadId: lead.id, userId: req.user!.id },
      });

      const wsId = req.user!.workspaceId;
      triggerAutomations({
        type: 'lead_stage_changed', workspaceId: wsId, entityType: 'lead', entityId: lead.id,
        payload: { newStageId: stageId, oldStageId: existing.stageId },
      }).catch(() => {});

      if (stage?.type === 'WON') {
        triggerAutomations({ type: 'lead_won', workspaceId: wsId, entityType: 'lead', entityId: lead.id }).catch(() => {});
      } else if (stage?.type === 'LOST') {
        triggerAutomations({ type: 'lead_lost', workspaceId: wsId, entityType: 'lead', entityId: lead.id }).catch(() => {});
      }
    }

    if (assignedToId !== undefined && assignedToId !== existing.assignedToId) {
      if (assignedToId) {
        triggerAutomations({ type: 'lead_assigned', workspaceId: req.user!.workspaceId, entityType: 'lead', entityId: lead.id })
          .catch(() => {});
        notifyNewLead(lead.id, assignedToId).catch(() => {});
        notifyWhatsAppAssignment(req.user!.workspaceId, assignedToId, 'lead', lead.id).catch(() => {});
      }
      // Propagar para Contact + ConversationMeta + outros leads do mesmo contacto
      if (lead.contactId) {
        await propagateAssignee(req.user!.workspaceId, lead.contactId, assignedToId || null, 'lead');
      }
    }

    const io = req.app.get('io');
    io.to(`workspace:${req.user!.workspaceId}`).emit('lead:updated', lead);

    res.json(lead);
  } catch (error) { next(error); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!lead) throw new AppError('Lead não encontrado', 404);

    await prisma.lead.delete({ where: { id: req.params.id } });

    const io = req.app.get('io');
    io.to(`workspace:${req.user!.workspaceId}`).emit('lead:deleted', { id: req.params.id });

    res.json({ message: 'Lead eliminado' });
  } catch (error) { next(error); }
});

// PATCH /api/leads/:id/move
router.patch('/:id/move', async (req: AuthRequest, res: Response, next) => {
  try {
    const { stageId, pipelineId } = req.body;

    // Determinar novo status com base no tipo da nova etapa
    const stage = await prisma.stage.findUnique({ where: { id: stageId } });
    let statusUpdate: any = {};
    if (stage) {
      if (stage.type === 'WON') {
        statusUpdate = { status: 'WON', closedAt: new Date() };
      } else if (stage.type === 'LOST') {
        statusUpdate = { status: 'LOST', closedAt: new Date() };
      } else {
        statusUpdate = { status: 'OPEN', closedAt: null };
      }
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { stageId, ...(pipelineId && { pipelineId }), ...statusUpdate },
      include: leadInclude,
    });

    await prisma.activity.create({
      data: { type: 'LEAD_MOVED', description: `Movido para "${stage?.name}"`, leadId: lead.id, userId: req.user!.id },
    });

    const io = req.app.get('io');
    io.to(`workspace:${req.user!.workspaceId}`).emit('lead:moved', lead);

    const wsId = req.user!.workspaceId;
    triggerAutomations({
      type: 'lead_stage_changed', workspaceId: wsId, entityType: 'lead', entityId: lead.id,
      payload: { newStageId: stageId },
    }).catch(() => {});
    if (stage?.type === 'WON') triggerAutomations({ type: 'lead_won', workspaceId: wsId, entityType: 'lead', entityId: lead.id }).catch(() => {});
    if (stage?.type === 'LOST') triggerAutomations({ type: 'lead_lost', workspaceId: wsId, entityType: 'lead', entityId: lead.id }).catch(() => {});

    res.json(lead);
  } catch (error) { next(error); }
});

// POST /api/leads/sync-statuses
// Sincroniza o status de todos os leads do workspace com o tipo da sua etapa
router.post('/sync-statuses', async (req: AuthRequest, res: Response, next) => {
  try {
    const leads = await prisma.lead.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: { stage: true },
    });
    let updated = 0;
    for (const lead of leads) {
      let target: 'OPEN' | 'WON' | 'LOST' = 'OPEN';
      if (lead.stage.type === 'WON') target = 'WON';
      else if (lead.stage.type === 'LOST') target = 'LOST';
      if (lead.status !== target) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: target, closedAt: target !== 'OPEN' ? (lead.closedAt || new Date()) : null },
        });
        updated++;
      }
    }
    res.json({ message: `${updated} leads sincronizados de ${leads.length} totais`, updated, total: leads.length });
  } catch (e) { next(e); }
});

export default router;
