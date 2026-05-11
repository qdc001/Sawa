import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { runChatbotForMessage } from '../lib/chatbotEngine';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewMessage } from '../lib/notify';

const router = Router();
const prisma = new PrismaClient();

router.get('/', (_req, res) => res.json({ message: 'webhooks endpoint' }));

// ============= Evolution API webhook =============
// O servidor Evolution chama este endpoint com eventos: MESSAGES_UPSERT, CONNECTION_UPDATE, etc.
router.post('/evolution', async (req: Request, res: Response) => {
  try {
    const event = req.body?.event || req.body?.type;
    const data = req.body?.data || req.body;
    const instanceName = req.body?.instance || data?.instance || data?.instanceName;

    if (!instanceName) {
      return res.json({ ok: true, ignored: 'sem instance' });
    }

    // Encontrar integração pelo instanceName
    const integration = await prisma.integration.findFirst({
      where: { type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    // Match pelo instanceName guardado nas credenciais
    let matched = null as any;
    if (integration) {
      const creds: any = integration.credentials || {};
      if (creds.instanceName === instanceName) matched = integration;
    }
    if (!matched) {
      // procurar todas e match
      const all = await prisma.integration.findMany({
        where: { type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
      });
      matched = all.find((i: any) => (i.credentials as any)?.instanceName === instanceName);
    }
    if (!matched) {
      return res.json({ ok: true, ignored: 'instance não associada a workspace' });
    }

    const workspaceId = matched.workspaceId;
    const io = (global as any).io;

    // Estado da ligação
    if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
      const state = data?.state || data?.connection;
      if (state) {
        const creds: any = matched.credentials || {};
        await prisma.integration.update({
          where: { id: matched.id },
          data: { credentials: { ...creds, lastState: state }, isActive: state === 'open' },
        });
        if (io) io.to(`workspace:${workspaceId}`).emit('evolution:state', { state });
      }
      return res.json({ ok: true });
    }

    // Mensagens novas
    if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT' || event === 'message') {
      // Pode ser um array em data.messages OU um objecto único
      const messages = Array.isArray(data?.messages) ? data.messages : (data?.key ? [data] : []);
      for (const m of messages) {
        // Ignorar mensagens enviadas pelo próprio operador (fromMe = true) — vêm do envio que já guardámos
        if (m.key?.fromMe) continue;

        const remoteJid: string = m.key?.remoteJid || '';
        if (!remoteJid || remoteJid.endsWith('@g.us')) continue; // ignorar grupos

        const phone = remoteJid.split('@')[0].replace(/\D/g, '');
        if (!phone) continue;

        // Extrair conteúdo
        const msg = m.message || {};
        let content = '';
        let msgType = 'TEXT';
        let mediaUrl: string | undefined;
        let interactiveId: string | null = null;

        if (msg.conversation) {
          content = msg.conversation;
        } else if (msg.extendedTextMessage?.text) {
          content = msg.extendedTextMessage.text;
        } else if (msg.imageMessage) {
          msgType = 'IMAGE'; content = msg.imageMessage.caption || '[Imagem]'; mediaUrl = msg.imageMessage.url;
        } else if (msg.videoMessage) {
          msgType = 'VIDEO'; content = msg.videoMessage.caption || '[Vídeo]'; mediaUrl = msg.videoMessage.url;
        } else if (msg.audioMessage) {
          msgType = 'AUDIO'; content = '[Áudio]'; mediaUrl = msg.audioMessage.url;
        } else if (msg.documentMessage) {
          msgType = 'DOCUMENT'; content = msg.documentMessage.fileName || '[Documento]'; mediaUrl = msg.documentMessage.url;
        } else if (msg.locationMessage) {
          msgType = 'LOCATION';
          content = `Localização: ${msg.locationMessage.degreesLatitude}, ${msg.locationMessage.degreesLongitude}`;
        } else if (msg.buttonsResponseMessage) {
          msgType = 'INTERACTIVE';
          interactiveId = msg.buttonsResponseMessage.selectedButtonId || null;
          content = msg.buttonsResponseMessage.selectedDisplayText || interactiveId || '[Botão]';
        } else if (msg.listResponseMessage) {
          msgType = 'INTERACTIVE';
          interactiveId = msg.listResponseMessage.singleSelectReply?.selectedRowId || null;
          content = msg.listResponseMessage.title || interactiveId || '[Lista]';
        } else {
          content = '[Mensagem]';
        }

        // Encontrar/criar contacto
        const contactName = m.pushName || phone;
        let contact = await prisma.contact.findFirst({ where: { whatsapp: phone, workspaceId } });
        if (!contact) {
          contact = await prisma.contact.create({
            data: { firstName: contactName, whatsapp: phone, phone, workspaceId, type: 'PERSON' },
          });
        }

        // Encontrar/criar lead aberto
        let lead = await prisma.lead.findFirst({ where: { contactId: contact.id, status: 'OPEN', workspaceId } });
        if (!lead) {
          const pipeline = await prisma.pipeline.findFirst({
            where: { workspaceId, isDefault: true },
            include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
          });
          if (pipeline?.stages[0]) {
            const owner = await prisma.user.findFirst({ where: { workspaceId, role: 'OWNER' } });
            if (owner) {
              lead = await prisma.lead.create({
                data: {
                  title: `WhatsApp - ${contactName}`,
                  source: 'WhatsApp (Evolution)',
                  workspaceId,
                  pipelineId: pipeline.id,
                  stageId: pipeline.stages[0].id,
                  contactId: contact.id,
                  createdById: owner.id,
                },
              });
            }
          }
        }

        const saved = await prisma.message.create({
          data: {
            content,
            type: msgType as any,
            direction: 'INBOUND',
            channel: 'WHATSAPP',
            status: 'DELIVERED',
            externalId: m.key?.id || undefined,
            mediaUrl,
            leadId: lead?.id,
            contactId: contact.id,
          },
        });

        if (io) {
          io.to(`workspace:${workspaceId}`).emit('message:new', saved);
          if (lead) io.to(`lead:${lead.id}`).emit('message:new', saved);
        }

        // Disparar motor de chatbots
        if ((msgType === 'TEXT' || msgType === 'INTERACTIVE') && content) {
          runChatbotForMessage({
            workspaceId,
            contactId: contact.id,
            leadId: lead?.id,
            message: interactiveId || content,
            channel: 'WHATSAPP',
            io,
          }).catch((e) => console.error('Chatbot engine (evo) error:', e));
        }

        // Disparar motor de automações
        triggerAutomations({
          type: 'message_received', workspaceId,
          entityType: 'message', entityId: saved.id,
        }).catch(() => {});

        // Notificar por email opt-in
        notifyNewMessage(saved.id).catch(() => {});
      }
      return res.json({ ok: true });
    }

    // QR Code update (apenas log)
    if (event === 'qrcode.updated' || event === 'QRCODE_UPDATED') {
      if (io) io.to(`workspace:${workspaceId}`).emit('evolution:qr', data);
      return res.json({ ok: true });
    }

    // Presence (a escrever / a gravar / online / offline)
    if (event === 'presence.update' || event === 'PRESENCE_UPDATE') {
      const presence = data?.presences || data;
      // Pode ser objecto { jid: { lastKnownPresence: 'composing' } } ou directamente { id, presence }
      try {
        let entries: Array<{ jid: string; state: string }> = [];
        if (Array.isArray(presence)) {
          entries = presence.map((p: any) => ({ jid: p.id || p.jid, state: p.presence || p.lastKnownPresence }));
        } else if (typeof presence === 'object') {
          entries = Object.entries(presence).map(([jid, info]: any) => ({
            jid,
            state: info?.lastKnownPresence || info?.presence || info,
          }));
        }
        for (const { jid, state } of entries) {
          if (!jid || !state) continue;
          if (jid.endsWith('@g.us')) continue;
          const phone = jid.split('@')[0].replace(/\D/g, '');
          const contact = await prisma.contact.findFirst({ where: { whatsapp: phone, workspaceId } });
          if (!contact) continue;
          if (io) {
            io.to(`workspace:${workspaceId}`).emit('presence:update', {
              contactId: contact.id,
              state, // 'composing' | 'recording' | 'available' | 'unavailable' | 'paused'
            });
          }
        }
      } catch (e) { console.error('presence parse error:', e); }
      return res.json({ ok: true });
    }

    // Chamada recebida
    if (event === 'call' || event === 'call.set' || event === 'CALL' || event === 'CALL_SET') {
      try {
        const calls = Array.isArray(data?.calls) ? data.calls : (Array.isArray(data) ? data : [data]);
        for (const c of calls) {
          if (!c) continue;
          const from = c.from || c.jid || c.peerJid;
          if (!from || String(from).endsWith('@g.us')) continue;
          const phone = String(from).split('@')[0].replace(/\D/g, '');
          const contact = await prisma.contact.findFirst({ where: { whatsapp: phone, workspaceId } });
          const callType = c.isVideo ? 'video' : 'voice';
          const status = c.status || 'ringing';

          // Persistir como mensagem SYSTEM para aparecer na timeline
          if (contact) {
            const lead = await prisma.lead.findFirst({ where: { contactId: contact.id, status: 'OPEN', workspaceId } });
            const text = status === 'ringing'
              ? `📞 Chamada de ${callType === 'video' ? 'vídeo' : 'voz'} recebida (atende no telefone)`
              : status === 'accept'
              ? `📞 Chamada atendida`
              : status === 'reject'
              ? `📞 Chamada rejeitada`
              : status === 'timeout'
              ? `📞 Chamada perdida`
              : `📞 Chamada (${status})`;

            const saved = await prisma.message.create({
              data: {
                content: text,
                type: 'SYSTEM',
                direction: 'INBOUND',
                channel: 'WHATSAPP',
                status: 'DELIVERED',
                contactId: contact.id,
                leadId: lead?.id,
              },
            });

            if (io) {
              io.to(`workspace:${workspaceId}`).emit('message:new', saved);
              io.to(`workspace:${workspaceId}`).emit('call:incoming', {
                contactId: contact.id, contactName: contact.firstName, phone, callType, status,
              });
            }
          }
        }
      } catch (e) { console.error('call parse error:', e); }
      return res.json({ ok: true });
    }

    res.json({ ok: true, ignored: event });
  } catch (e: any) {
    console.error('Evolution webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
