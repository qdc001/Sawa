import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { runChatbotForMessage } from '../lib/chatbotEngine';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewMessage } from '../lib/notify';
import fs from 'fs';
import path from 'path';

const router = Router();
const prisma = new PrismaClient();

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Helper: round-robin auto-assignment
async function autoAssignConversation(workspaceId: string, contactId: string, channel: string): Promise<string | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { autoAssignEnabled: true } });
  if (!ws?.autoAssignEnabled) return null;

  const existing = await prisma.conversationMeta.findUnique({
    where: { workspaceId_contactId_channel: { workspaceId, contactId, channel } },
  });
  if (existing?.assignedToId) return existing.assignedToId;

  const agents = await prisma.user.findMany({
    where: { workspaceId, isActive: true, role: { in: ['AGENT', 'MANAGER'] } },
    select: { id: true, status: true },
  });
  if (agents.length === 0) return null;

  let pool = agents.filter((a) => a.status === 'ONLINE');
  if (pool.length === 0) pool = agents;

  const counts = await Promise.all(
    pool.map(async (a) => ({
      id: a.id,
      n: await prisma.conversationMeta.count({ where: { workspaceId, assignedToId: a.id, isArchived: false } }),
    })),
  );
  counts.sort((a, b) => a.n - b.n);
  const chosen = counts[0]?.id;
  if (!chosen) return null;

  await prisma.conversationMeta.upsert({
    where: { workspaceId_contactId_channel: { workspaceId, contactId, channel } },
    create: { workspaceId, contactId, channel, assignedToId: chosen },
    update: { assignedToId: chosen },
  });

  await prisma.notification.create({
    data: {
      userId: chosen,
      title: 'Conversa atribuída',
      body: 'Foi-te atribuída uma nova conversa via round-robin',
      type: 'auto_assign',
      link: '/inbox',
    },
  }).catch(() => {});

  return chosen;
}

// Helper: devolve URL absoluto baseado no PUBLIC_API_URL ou request
function absoluteUrl(req: Request, p: string): string {
  const base = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}${p.startsWith('/') ? p : '/' + p}`;
}

// Helper: baixa media da Evolution via base64 e guarda como ficheiro local
async function fetchMediaFromEvolution(creds: any, baileysMessage: any, fallbackExt: string): Promise<string | null> {
  if (!creds?.baseUrl || !creds?.apiKey || !creds?.instanceName) return null;
  try {
    const res = await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${creds.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: JSON.stringify({ message: { key: baileysMessage.key, message: baileysMessage.message } }),
    });
    if (!res.ok) {
      console.error('getBase64FromMediaMessage failed:', await res.text());
      return null;
    }
    const data = await res.json();
    const base64 = data?.base64 || data?.media || data;
    if (!base64 || typeof base64 !== 'string') return null;
    const mimeType: string = data?.mimetype || data?.mimeType || '';
    // Decidir extensão
    let ext = fallbackExt;
    if (mimeType.includes('/')) {
      const t = mimeType.split('/')[1].split(';')[0];
      ext = t.replace('mpeg', 'mp3').replace('quicktime', 'mov').replace('jpeg', 'jpg');
    }
    const fileName = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${fileName}`;
  } catch (e) {
    console.error('fetchMediaFromEvolution error:', e);
    return null;
  }
}

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
    if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT' || event === 'message' || event === 'send.message') {
      // Evolution v2: data é o próprio objecto da mensagem (data.key + data.message)
      // Evolution v1: data.messages é array
      const messages = Array.isArray(data?.messages)
        ? data.messages
        : (data?.key && (data?.message || data?.messageType))
          ? [data]
          : [];

      if (messages.length === 0) {
        console.log('Evolution webhook: nenhuma mensagem extraída. Event:', event, 'Keys data:', data ? Object.keys(data).join(',') : '(vazio)');
      }

      for (const m of messages) {
        const remoteJid: string = m.key?.remoteJid || '';
        if (!remoteJid || remoteJid.endsWith('@g.us')) continue; // ignorar grupos

        const fromMe = !!m.key?.fromMe;
        const externalId: string | undefined = m.key?.id;

        // Se for fromMe e já guardámos esta mensagem (envio via CRM), saltar
        if (fromMe && externalId) {
          const exists = await prisma.message.findFirst({ where: { externalId } });
          if (exists) continue;
        }

        const phone = remoteJid.split('@')[0].replace(/\D/g, '');
        if (!phone) continue;

        // Extrair conteúdo
        const msg = m.message || {};
        let content = '';
        let msgType = 'TEXT';
        let mediaUrl: string | undefined;
        let interactiveId: string | null = null;

        const creds: any = matched.credentials || {};

        // Evolution v2 às vezes embrulha em ephemeralMessage / viewOnceMessage / etc
        const unwrapped =
          msg.ephemeralMessage?.message ||
          msg.viewOnceMessage?.message ||
          msg.viewOnceMessageV2?.message ||
          msg.documentWithCaptionMessage?.message ||
          msg;

        if (unwrapped.conversation || msg.conversation) {
          content = unwrapped.conversation || msg.conversation;
        } else if (unwrapped.extendedTextMessage?.text || msg.extendedTextMessage?.text) {
          content = unwrapped.extendedTextMessage?.text || msg.extendedTextMessage.text;
        } else if (unwrapped.imageMessage || msg.imageMessage) {
          const im = unwrapped.imageMessage || msg.imageMessage;
          msgType = 'IMAGE'; content = im.caption || '[Imagem]';
          const local = await fetchMediaFromEvolution(creds, m, 'jpg');
          mediaUrl = local ? absoluteUrl(req, local) : im.url;
        } else if (unwrapped.videoMessage || msg.videoMessage) {
          const vm = unwrapped.videoMessage || msg.videoMessage;
          msgType = 'VIDEO'; content = vm.caption || '[Vídeo]';
          const local = await fetchMediaFromEvolution(creds, m, 'mp4');
          mediaUrl = local ? absoluteUrl(req, local) : vm.url;
        } else if (unwrapped.audioMessage || msg.audioMessage) {
          const am = unwrapped.audioMessage || msg.audioMessage;
          msgType = 'AUDIO'; content = '[Áudio]';
          const local = await fetchMediaFromEvolution(creds, m, 'ogg');
          mediaUrl = local ? absoluteUrl(req, local) : am.url;
        } else if (unwrapped.documentMessage || msg.documentMessage) {
          const dm = unwrapped.documentMessage || msg.documentMessage;
          msgType = 'DOCUMENT';
          content = dm.fileName || '[Documento]';
          const ext = (dm.fileName || '').split('.').pop() || 'bin';
          const local = await fetchMediaFromEvolution(creds, m, ext);
          mediaUrl = local ? absoluteUrl(req, local) : dm.url;
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
          // Diagnóstico: tipo de mensagem não reconhecido
          const keys = Object.keys(msg).join(',');
          console.log('Evolution webhook: tipo desconhecido. Chaves do msg:', keys, '| messageType:', m.messageType);
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
            direction: fromMe ? 'OUTBOUND' : 'INBOUND',
            channel: 'WHATSAPP',
            status: fromMe ? 'SENT' : 'DELIVERED',
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

        // Skip de chatbots/automacoes/notify se for fromMe (mensagem enviada pelo dono do numero, nao requer resposta automatica)
        if (fromMe) continue;

        // Auto-assign round-robin (se workspace tem toggle ON)
        autoAssignConversation(workspaceId, contact.id, 'WHATSAPP').then((assignedId) => {
          if (assignedId && io) io.to(`user:${assignedId}`).emit('notification:new', { type: 'auto_assign' });
        }).catch(() => {});

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

    // Estado de mensagem (delivered/read/played)
    if (event === 'messages.update' || event === 'MESSAGES_UPDATE') {
      try {
        const items = Array.isArray(data?.messages) ? data.messages : Array.isArray(data) ? data : [data];
        for (const u of items) {
          const id = u?.key?.id || u?.keyId || u?.id;
          const newStatus = (u?.update?.status || u?.status || '').toString().toUpperCase();
          if (!id || !newStatus) continue;
          const mapped =
            newStatus === 'READ' || newStatus === '4' ? 'READ' :
            newStatus === 'PLAYED' ? 'READ' :
            newStatus === 'DELIVERED' || newStatus === '3' ? 'DELIVERED' :
            newStatus === 'SERVER_ACK' || newStatus === '2' ? 'SENT' :
            null;
          if (!mapped) continue;
          await prisma.message.updateMany({ where: { externalId: id }, data: { status: mapped as any, ...(mapped === 'READ' ? { readAt: new Date() } : {}) } });
          const updated = await prisma.message.findFirst({ where: { externalId: id } });
          if (updated && io) {
            io.to(`workspace:${workspaceId}`).emit('message:updated', updated);
            if (updated.leadId) io.to(`lead:${updated.leadId}`).emit('message:updated', updated);
          }
        }
      } catch (e) { console.error('messages.update parse error:', e); }
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
