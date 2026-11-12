import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
import { contactTitle, notGroup } from '../lib/leadTarget';
const router = Router();

const isAdmin = (req: AuthRequest) => ['OWNER', 'ADMIN'].includes(req.user!.role);

async function checkStage(workspaceId: string, pipelineId: any, stageId: any) {
  const st = await prisma.stage.findFirst({
    where: { id: String(stageId || ''), pipelineId: String(pipelineId || ''), pipeline: { workspaceId } },
    include: { pipeline: { select: { id: true, name: true } } },
  });
  if (!st) throw new AppError('Escolhe um pipeline e uma etapa válidos', 400);
  return st;
}

// Pipeline/etapa onde caem os contactos novos (WhatsApp, Instagram, criados a mao, importados).
router.get('/new-contacts', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId }, select: { newLeadPipelineId: true, newLeadStageId: true } });
    res.json({ pipelineId: ws?.newLeadPipelineId || null, stageId: ws?.newLeadStageId || null, canManage: isAdmin(req) });
  } catch (e) { next(e); }
});

router.put('/new-contacts', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!isAdmin(req)) throw new AppError('Só o dono e administradores podem mudar isto', 403);
    const workspaceId = req.user!.workspaceId;
    const { pipelineId, stageId } = req.body || {};
    if (!pipelineId) {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { newLeadPipelineId: null, newLeadStageId: null } });
      return res.json({ pipelineId: null, stageId: null });
    }
    const st = await checkStage(workspaceId, pipelineId, stageId);
    await prisma.workspace.update({ where: { id: workspaceId }, data: { newLeadPipelineId: st.pipelineId, newLeadStageId: st.id } });
    res.json({ pipelineId: st.pipelineId, stageId: st.id });
  } catch (e) { next(e); }
});

// Poe num pipeline/etapa todos os contactos que ainda nao tem nenhum lead. apply=false so conta.
router.post('/add-contacts', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!isAdmin(req)) throw new AppError('Só o dono e administradores podem fazer isto', 403);
    const workspaceId = req.user!.workspaceId;
    const st = await checkStage(workspaceId, req.body?.pipelineId, req.body?.stageId);
    const where = { workspaceId, leads: { none: {} }, ...notGroup };
    const total = await prisma.contact.count({ where });
    if (req.body?.apply !== true) return res.json({ total, created: 0 });
    let created = 0;
    // Aos blocos, para nao prender a base de dados com milhares de uma vez.
    for (;;) {
      const batch = await prisma.contact.findMany({
        where, select: { id: true, firstName: true, lastName: true, whatsapp: true, phone: true }, take: 500,
      });
      if (!batch.length) break;
      const r = await prisma.lead.createMany({
        data: batch.map((c) => ({
          title: contactTitle(c), source: 'Contactos', workspaceId, pipelineId: st.pipelineId, stageId: st.id, contactId: c.id, createdById: req.user!.id,
        })),
      });
      created += r.count;
      if (batch.length < 500) break;
    }
    const io = req.app.get('io');
    if (io) io.to(`workspace:${workspaceId}`).emit('lead:bulk', { pipelineId: st.pipelineId });
    res.json({ total, created });
  } catch (e) { next(e); }
});

router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    let pipelines = await prisma.pipeline.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
      orderBy: { position: 'asc' },
    });

    // Auto-criar pipeline se nenhum existir
    if (pipelines.length === 0) {
      await prisma.pipeline.create({
        data: {
          name: 'Pipeline Principal',
          isDefault: true,
          color: '#6366F1',
          position: 0,
          workspaceId: req.user!.workspaceId,
          createdById: req.user!.id,
          stages: {
            create: [
              { name: 'Novo Lead', color: '#6B7280', position: 0 },
              { name: 'Em Contacto', color: '#3B82F6', position: 1 },
              { name: 'Proposta Enviada', color: '#8B5CF6', position: 2 },
              { name: 'Negociacao', color: '#F59E0B', position: 3 },
              { name: 'Ganho', color: '#10B981', position: 4, type: 'WON' },
              { name: 'Perdido', color: '#EF4444', position: 5, type: 'LOST' },
            ],
          },
        },
      });

      pipelines = await prisma.pipeline.findMany({
        where: { workspaceId: req.user!.workspaceId },
        include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
        orderBy: { position: 'asc' },
      });
    }

    res.json(pipelines);
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, color } = req.body;
    if (!name) throw new AppError('Nome e obrigatório', 400);
    const count = await prisma.pipeline.count({ where: { workspaceId: req.user!.workspaceId } });
    const pipeline = await prisma.pipeline.create({
      data: {
        name, description, color: color || '#3B82F6', position: count,
        workspaceId: req.user!.workspaceId, createdById: req.user!.id,
        stages: { create: [
          { name: 'Novo', color: '#6B7280', position: 0 },
          { name: 'Em Progresso', color: '#3B82F6', position: 1 },
          { name: 'Ganho', color: '#10B981', position: 2, type: 'WON' },
          { name: 'Perdido', color: '#EF4444', position: 3, type: 'LOST' },
        ]},
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    res.status(201).json(pipeline);
  } catch (e) { next(e); }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, color, aiInstructions, aiEnabled } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (color !== undefined) data.color = color;
    if (aiInstructions !== undefined) {
      data.aiInstructions = typeof aiInstructions === 'string'
        ? aiInstructions.trim().slice(0, 4000) || null
        : null;
    }
    if (aiEnabled !== undefined) data.aiEnabled = !!aiEnabled;
    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id }, data, include: { stages: true }
    });
    res.json(pipeline);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.pipeline.delete({ where: { id: req.params.id } });
    res.json({ message: 'Pipeline eliminado' });
  } catch (e) { next(e); }
});

export default router;