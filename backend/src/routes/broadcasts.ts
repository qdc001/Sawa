import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
import { getCreds, encryptForStore } from '../lib/integrationCrypto';
const router = Router();

// GET /api/broadcasts
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const broadcasts = await prisma.broadcast.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(broadcasts);
  } catch (e) { next(e); }
});

// GET /api/broadcasts/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const broadcast = await prisma.broadcast.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: {
        recipients: {
          include: { contact: { select: { id: true, firstName: true, lastName: true, whatsapp: true } } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!broadcast) throw new AppError('Broadcast não encontrado', 404);
    res.json(broadcast);
  } catch (e) { next(e); }
});

// POST /api/broadcasts
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, channel, message, templateName, langCode, templateComponents, filters, scheduledAt } = req.body;
    if (!name || !channel || (!message && !templateName)) throw new AppError('Dados incompletos', 400);

    // Build recipient list from filters
    const contactWhere: any = { workspaceId: req.user!.workspaceId };
    if (filters?.tags?.length) contactWhere.tags = { some: { tag: { name: { in: filters.tags } } } };
    if (channel === 'WHATSAPP') contactWhere.whatsapp = { not: null };
    if (channel === 'EMAIL') contactWhere.email = { not: null };

    const contacts = await prisma.contact.findMany({
      where: contactWhere,
      select: { id: true, whatsapp: true, email: true, firstName: true },
      take: 10000,
    });

    const broadcast = await prisma.broadcast.create({
      data: {
        name,
        channel,
        message,
        templateName,
        langCode,
        templateComponents: templateComponents ? JSON.stringify(templateComponents) : undefined,
        status: scheduledAt ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        totalRecipients: contacts.length,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
        recipients: {
          create: contacts.map((c) => ({
            contactId: c.id,
            phone: c.whatsapp || '',
            status: 'PENDING',
          })),
        },
      },
      include: { _count: { select: { recipients: true } } },
    });

    res.status(201).json(broadcast);
  } catch (e) { next(e); }
});

// POST /api/broadcasts/:id/send
router.post('/:id/send', async (req: AuthRequest, res: Response, next) => {
  try {
    const broadcast = await prisma.broadcast.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: { recipients: { where: { status: 'PENDING' }, take: 1000 } },
    });
    if (!broadcast) throw new AppError('Broadcast não encontrado', 404);
    if (broadcast.status === 'SENDING' || broadcast.status === 'COMPLETED') {
      throw new AppError('Broadcast já foi enviado', 400);
    }

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP', isActive: true },
    });
    if (!integration) throw new AppError('WhatsApp não configurado', 400);

    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'SENDING', startedAt: new Date() },
    });

    res.json({ message: 'Broadcast iniciado', total: broadcast.recipients.length });

    // Process in background (non-blocking)
    processBroadcast(broadcast, integration, req.user!.workspaceId).catch(console.error);
  } catch (e) { next(e); }
});

async function processBroadcast(broadcast: any, integration: any, workspaceId: string) {
  const creds: any = getCreds(integration);
  let sent = 0, failed = 0;
  const DELAY_MS = 1000; // 1s entre mensagens (respeitar rate limits Meta)

  for (const recipient of broadcast.recipients) {
    try {
      const body: any = {
        messaging_product: 'whatsapp',
        to: recipient.phone,
      };

      if (broadcast.templateName) {
        body.type = 'template';
        body.template = {
          name: broadcast.templateName,
          language: { code: broadcast.langCode || 'pt_BR' },
          components: broadcast.templateComponents ? JSON.parse(broadcast.templateComponents) : [],
        };
      } else {
        body.type = 'text';
        body.text = { body: broadcast.message };
      }

      const result = await fetch(`https://graph.facebook.com/v19.0/${creds.phoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
        body: JSON.stringify(body),
      });

      if (result.ok) {
        const data = await result.json();
        await prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: { status: 'SENT', sentAt: new Date(), externalId: data.messages?.[0]?.id },
        });
        sent++;
      } else {
        const err = await result.json();
        await prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: { status: 'FAILED', error: err.error?.message },
        });
        failed++;
      }
    } catch (err: any) {
      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: { status: 'FAILED', error: err.message },
      });
      failed++;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: { status: 'COMPLETED', completedAt: new Date(), sentCount: sent, failedCount: failed },
  });
}

// DELETE /api/broadcasts/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const broadcast = await prisma.broadcast.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!broadcast) throw new AppError('Broadcast não encontrado', 404);
    if (broadcast.status === 'SENDING') throw new AppError('Não podes eliminar um broadcast a enviar', 400);
    await prisma.broadcastRecipient.deleteMany({ where: { broadcastId: req.params.id } });
    await prisma.broadcast.delete({ where: { id: req.params.id } });
    res.json({ message: 'Broadcast eliminado' });
  } catch (e) { next(e); }
});

// GET /api/broadcasts/:id/stats
router.get('/:id/stats', async (req: AuthRequest, res: Response, next) => {
  try {
    const stats = await prisma.broadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcastId: req.params.id },
      _count: true,
    });
    const result: Record<string, number> = {};
    for (const s of stats) result[s.status] = s._count;
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
