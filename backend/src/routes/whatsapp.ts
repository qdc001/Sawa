import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { runChatbotForMessage } from '../lib/chatbotEngine';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewMessage } from '../lib/notify';

import prisma from '../lib/prisma';
import { getCreds, encryptForStore } from '../lib/integrationCrypto';
const router = Router();

// ── Helpers ──────────────────────────────────────────
async function sendWhatsAppMessage(to: string, body: string, token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Erro ao enviar mensagem WhatsApp');
  }
  return res.json();
}

async function sendWhatsAppTemplate(to: string, templateName: string, langCode: string, components: any[], token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: langCode }, components },
    }),
  });
  if (!res.ok) throw new Error('Erro ao enviar template WhatsApp');
  return res.json();
}

async function sendWhatsAppMedia(to: string, type: string, mediaUrl: string, caption: string | undefined, token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type,
      [type]: { link: mediaUrl, caption },
    }),
  });
  if (!res.ok) throw new Error('Erro ao enviar media WhatsApp');
  return res.json();
}

// ── Webhook verification (GET) ────────────────────────
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Webhook receive (POST) ────────────────────────────
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const phoneId = value.metadata?.phone_number_id;

        // Find integration by phoneId
        const integration = await prisma.integration.findFirst({
          where: { type: 'WHATSAPP', isActive: true },
        });
        if (!integration) continue;

        const workspaceId = integration.workspaceId;
        const creds: any = getCreds(integration);

        // Process incoming messages
        for (const msg of value.messages || []) {
          const from = msg.from; // sender phone number
          const msgId = msg.id;
          const timestamp = new Date(Number(msg.timestamp) * 1000);

          let content = '';
          let mediaUrl: string | undefined;
          let msgType = 'TEXT';

          let interactiveButtonId: string | null = null; // id do botão clicado (para o motor)

          if (msg.type === 'text') {
            content = msg.text.body;
          } else if (msg.type === 'image') {
            msgType = 'IMAGE';
            content = msg.image?.caption || '[Imagem]';
            mediaUrl = msg.image?.id;
          } else if (msg.type === 'audio') {
            msgType = 'AUDIO';
            content = '[Audio]';
          } else if (msg.type === 'document') {
            msgType = 'DOCUMENT';
            content = msg.document?.filename || '[Documento]';
          } else if (msg.type === 'location') {
            msgType = 'LOCATION';
            content = `Localização: ${msg.location?.latitude}, ${msg.location?.longitude}`;
          } else if (msg.type === 'interactive') {
            msgType = 'INTERACTIVE';
            const inter = msg.interactive || {};
            if (inter.button_reply) {
              interactiveButtonId = inter.button_reply.id || null;
              content = inter.button_reply.title || interactiveButtonId || '[Botão]';
            } else if (inter.list_reply) {
              interactiveButtonId = inter.list_reply.id || null;
              content = inter.list_reply.title || interactiveButtonId || '[Lista]';
            } else {
              content = '[Interactive]';
            }
          } else {
            content = `[${msg.type}]`;
          }

          // Find or create contact
          let contact = await prisma.contact.findFirst({
            where: { whatsapp: from, workspaceId },
          });

          if (!contact) {
            const profileName = value.contacts?.[0]?.profile?.name || from;
            contact = await prisma.contact.create({
              data: {
                firstName: profileName,
                whatsapp: from,
                phone: from,
                workspaceId,
                type: 'PERSON',
              },
            });
          }

          // Find open lead for this contact or create one
          let lead = await prisma.lead.findFirst({
            where: { contactId: contact.id, status: 'OPEN', workspaceId },
          });

          if (!lead) {
            const pipeline = await prisma.pipeline.findFirst({
              where: { workspaceId, isDefault: true },
              include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
            });
            if (pipeline && pipeline.stages[0]) {
              lead = await prisma.lead.create({
                data: {
                  title: `WhatsApp - ${contact.firstName}`,
                  source: 'WhatsApp',
                  workspaceId,
                  pipelineId: pipeline.id,
                  stageId: pipeline.stages[0].id,
                  contactId: contact.id,
                  createdById: (await prisma.user.findFirst({ where: { workspaceId, role: 'OWNER' } }))!.id,
                },
              });
            }
          }

          // Save message
          const savedMessage = await prisma.message.create({
            data: {
              content,
              type: msgType as any,
              direction: 'INBOUND',
              channel: 'WHATSAPP',
              status: 'DELIVERED',
              externalId: msgId,
              mediaUrl,
              leadId: lead?.id,
              contactId: contact.id,
              createdAt: timestamp,
            },
          });

          // Emit via socket
          const io = (global as any).io;
          if (io) {
            io.to(`workspace:${workspaceId}`).emit('message:new', savedMessage);
            if (lead) io.to(`lead:${lead.id}`).emit('message:new', savedMessage);
          }

          // Mark message as read
          await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.token}` },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: msgId }),
          });

          // Disparar motor de chatbots (não bloqueia o webhook)
          // Para interactive: passa o id do botão clicado como mensagem (para condições matched contra esse id)
          if ((msgType === 'TEXT' || msgType === 'INTERACTIVE') && content) {
            runChatbotForMessage({
              workspaceId,
              contactId: contact.id,
              leadId: lead?.id,
              message: interactiveButtonId || content,
              channel: 'WHATSAPP',
              io,
            }).catch((e) => console.error('Chatbot engine error:', e));
          }

          // Disparar motor de automações
          triggerAutomations({
            type: 'message_received', workspaceId,
            entityType: 'message', entityId: savedMessage.id,
          }).catch((e) => console.error('Automation message_received error:', e));

          // Notificação opt-in por email
          notifyNewMessage(savedMessage.id).catch((e) => console.error('notifyNewMessage error:', e));
        }

        // Process status updates
        for (const status of value.statuses || []) {
          await prisma.message.updateMany({
            where: { externalId: status.id },
            data: { status: status.status.toUpperCase() as any },
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.sendStatus(500);
  }
});

// ── Send message (authenticated) ─────────────────────
router.post('/send', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, content, leadId, contactId, type = 'text', mediaUrl, templateName, langCode, components } = req.body;

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP', isActive: true },
    });
    if (!integration) return res.status(400).json({ message: 'Integração WhatsApp não configurada' });

    const creds: any = getCreds(integration);
    let externalId: string | undefined;

    if (type === 'text') {
      const result = await sendWhatsAppMessage(to, content, creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    } else if (type === 'template') {
      const result = await sendWhatsAppTemplate(to, templateName, langCode || 'pt_BR', components || [], creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    } else if (['image', 'video', 'audio', 'document'].includes(type)) {
      const result = await sendWhatsAppMedia(to, type, mediaUrl, content, creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    }

    const message = await prisma.message.create({
      data: {
        content: content || `[${type}]`,
        type: type.toUpperCase() as any,
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: 'SENT',
        externalId,
        mediaUrl,
        leadId,
        contactId,
        sentById: req.user!.id,
      },
      include: { sentBy: { select: { id: true, name: true, avatar: true } } },
    });

    const io = req.app.get('io');
    if (leadId) io.to(`lead:${leadId}`).emit('message:new', message);
    io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);

    res.json(message);
  } catch (error) {
    next(error);
  }
});

// ── Configure integration ─────────────────────────────
router.post('/configure', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { token, phoneId, businessAccountId, verifyToken } = req.body;
    if (!token || !phoneId) return res.status(400).json({ message: 'Token e Phone ID são obrigatórios' });

    const existing = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP' },
    });

    const data = {
      type: 'WHATSAPP' as const,
      name: 'WhatsApp Business',
      isActive: true,
      credentials: encryptForStore({ token, phoneId, businessAccountId, verifyToken }) as any,
      workspaceId: req.user!.workspaceId,
    };

    const integration = existing
      ? await prisma.integration.update({ where: { id: existing.id }, data })
      : await prisma.integration.create({ data });

    res.json({ message: 'WhatsApp configurado com sucesso', integration: { id: integration.id, isActive: integration.isActive } });
  } catch (error) { next(error); }
});

// ── Get phone numbers from Meta ───────────────────────
router.get('/phone-numbers', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP', isActive: true },
    });
    if (!integration) return res.status(404).json({ message: 'Integração não encontrada' });

    const creds: any = getCreds(integration);
    const result = await fetch(
      `https://graph.facebook.com/v19.0/${creds.businessAccountId}/phone_numbers?access_token=${creds.token}`
    );
    const data = await result.json();
    res.json(data);
  } catch (error) { next(error); }
});

export default router;
