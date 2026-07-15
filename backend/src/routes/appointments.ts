// CRUD basico de Marcacoes (Fase 3 da reconfiguracao).
// Marcacoes sao consultas/reunioes com hora de inicio + duracao, ligadas
// a um Contact obrigatorio e opcionalmente a um Lead. O envio de lembretes
// WhatsApp automaticos fica para uma fase seguinte (job cron + template).

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';

const router = Router();

const appointmentInclude = {
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true, avatar: true } },
  lead: { select: { id: true, title: true } },
  assignedTo: { select: { id: true, name: true, avatar: true } },
};

// GET /api/appointments
// Query params opcionais:
//   contactId, leadId, from, to, status, assignedToId
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId, from, to, status, assignedToId } = req.query;
    const where: any = { workspaceId: req.user!.workspaceId };
    if (contactId) where.contactId = String(contactId);
    if (leadId) where.leadId = String(leadId);
    if (status) where.status = String(status);
    if (assignedToId) where.assignedToId = String(assignedToId);
    if (from || to) {
      where.startsAt = {};
      if (from) where.startsAt.gte = new Date(String(from));
      if (to) where.startsAt.lte = new Date(String(to));
    }
    // Visibilidade restrita (agentes so veem as suas)
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') where.assignedToId = req.user!.id;

    const items = await prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    res.json(items);
  } catch (e) { next(e); }
});

// GET /api/appointments/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const item = await prisma.appointment.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: appointmentInclude,
    });
    if (!item) throw new AppError('Marcacao nao encontrada', 404);
    res.json(item);
  } catch (e) { next(e); }
});

// POST /api/appointments
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId, assignedToId, title, description, location, startsAt, durationMin, status, notes } = req.body;
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!title || !String(title).trim()) throw new AppError('Titulo obrigatorio', 400);
    if (!startsAt) throw new AppError('Data de inicio obrigatoria', 400);

    // Validar que o contact pertence ao workspace
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
      select: { id: true },
    });
    if (!contact) throw new AppError('Contacto invalido', 400);

    const item = await prisma.appointment.create({
      data: {
        workspaceId: req.user!.workspaceId,
        contactId,
        leadId: leadId || null,
        assignedToId: assignedToId || req.user!.id,
        title: String(title).trim(),
        description: description || null,
        location: location || null,
        startsAt: new Date(startsAt),
        durationMin: Number(durationMin) || 30,
        status: status || 'SCHEDULED',
        notes: notes || null,
        createdById: req.user!.id,
      },
      include: appointmentInclude,
    });

    const io = req.app.get('io');
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('appointment:new', item);

    res.status(201).json(item);
  } catch (e) { next(e); }
});

// PATCH /api/appointments/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.appointment.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      select: { id: true },
    });
    if (!existing) throw new AppError('Marcacao nao encontrada', 404);

    const { title, description, location, startsAt, durationMin, status, notes, assignedToId, leadId } = req.body;
    const data: any = {};
    if (title !== undefined) data.title = String(title).trim();
    if (description !== undefined) data.description = description || null;
    if (location !== undefined) data.location = location || null;
    if (startsAt !== undefined) data.startsAt = new Date(startsAt);
    if (durationMin !== undefined) data.durationMin = Number(durationMin) || 30;
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes || null;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
    if (leadId !== undefined) data.leadId = leadId || null;

    const item = await prisma.appointment.update({
      where: { id: req.params.id },
      data,
      include: appointmentInclude,
    });

    const io = req.app.get('io');
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('appointment:updated', item);

    res.json(item);
  } catch (e) { next(e); }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.appointment.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      select: { id: true },
    });
    if (!existing) throw new AppError('Marcacao nao encontrada', 404);
    await prisma.appointment.delete({ where: { id: req.params.id } });

    const io = req.app.get('io');
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('appointment:deleted', { id: req.params.id });

    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
