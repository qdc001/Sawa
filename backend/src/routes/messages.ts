import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { propagateAssignee } from '../lib/propagateAssignee';
const prisma = new PrismaClient();
const router = Router();

// Helper: envia via Meta Graph API (Instagram DM ou Facebook Messenger)
async function sendMetaOut(workspaceId: string, channel: 'INSTAGRAM' | 'FACEBOOK', recipientId: string, content: string, type: string, mediaUrl?: string): Promise<{ ok: boolean; externalId?: string; error?: string }> {
  const integration = await prisma.integration.findFirst({
    where: { workspaceId, type: channel as any, isActive: true },
  });
  if (!integration) return { ok: false, error: `Integração ${channel} não configurada` };
  const creds: any = integration.credentials || {};
  const accessToken = creds.accessToken || creds.pageAccessToken;
  const pageId = creds.pageId;
  if (!accessToken || !pageId) return { ok: false, error: 'accessToken ou pageId em falta' };

  let messagePayload: any;
  if (mediaUrl && type !== 'TEXT') {
    const metaType = type === 'IMAGE' ? 'image' : type === 'VIDEO' ? 'video' : type === 'AUDIO' ? 'audio' : 'file';
    messagePayload = { attachment: { type: metaType, payload: { url: mediaUrl, is_reusable: true } } };
  } else {
    messagePayload = { text: content };
  }

  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${pageId}/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: messagePayload, messaging_type: 'RESPONSE' }),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, error: data?.error?.message || `HTTP ${r.status}` };
    return { ok: true, externalId: data.message_id };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

// Helper: envia WhatsApp via canal disponível (Evolution preferido, depois Cloud API)
async function sendWhatsAppOut(workspaceId: string, phone: string, content: string, type: string, mediaUrl?: string): Promise<{ ok: boolean; externalId?: string; via?: string; error?: string }> {
  // 1. Tentar Evolution
  const evo = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
  });
  if (evo) {
    const creds: any = evo.credentials || {};
    if (creds.baseUrl && creds.apiKey && creds.instanceName) {
      try {
        let path: string;
        let body: any = { number: phone.replace(/\D/g, '') };

        if (type === 'AUDIO' && mediaUrl) {
          // Endpoint dedicado para áudio (converte para opus aceito pelo WhatsApp)
          path = `/message/sendWhatsAppAudio/${creds.instanceName}`;
          body.audio = mediaUrl;
        } else if (type !== 'TEXT' && mediaUrl) {
          // Mídia (imagem/vídeo/documento)
          path = `/message/sendMedia/${creds.instanceName}`;
          body.mediatype = type === 'IMAGE' ? 'image' : type === 'VIDEO' ? 'video' : 'document';
          body.media = mediaUrl;
          body.caption = content || '';
          body.fileName = (mediaUrl || '').split('/').pop()?.replace(/^wa_\d+_\w+\./, 'arquivo.') || 'file';
        } else {
          path = `/message/sendText/${creds.instanceName}`;
          body.text = content;
        }

        const r = await fetch(`${creds.baseUrl.replace(/\/$/, '')}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
          body: JSON.stringify(body),
        });
        const respText = await r.text();
        let data: any = respText;
        try { data = JSON.parse(respText); } catch {}
        if (r.ok) return { ok: true, externalId: data?.key?.id, via: 'evolution' };
        console.error('Evolution send failed:', r.status, respText.substring(0, 300));
        return { ok: false, error: data?.message || data?.error || `HTTP ${r.status}` };
      } catch (e: any) {
        console.error('Evolution send exception:', e);
        return { ok: false, error: e.message };
      }
    }
  }

  // 2. Tentar WhatsApp Cloud (Meta)
  const cloud = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WHATSAPP', isActive: true },
  });
  if (cloud) {
    const creds: any = cloud.credentials || {};
    const token = creds.accessToken || creds.token;
    const phoneId = creds.phoneNumberId || creds.phoneId;
    if (token && phoneId) {
      try {
        let body: any;
        if (type === 'TEXT' || !mediaUrl) {
          body = { messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: 'text', text: { body: content } };
        } else {
          const mtype = type.toLowerCase();
          body = { messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: mtype, [mtype]: { link: mediaUrl, caption: content } };
        }
        const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (r.ok) return { ok: true, externalId: data.messages?.[0]?.id, via: 'cloud' };
        return { ok: false, error: data?.error?.message || `HTTP ${r.status}` };
      } catch (e: any) { return { ok: false, error: e.message }; }
    }
  }

  return { ok: false, error: 'Sem integração WhatsApp activa' };
}

const messageInclude = {
  sentBy: { select: { id: true, name: true, avatar: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  replyTo: { select: { id: true, content: true, direction: true, sentBy: { select: { name: true } } } },
};

// GET /api/messages/conversations - lista de conversas
router.get('/conversations', async (req: AuthRequest, res: Response, next) => {
  try {
    const { channel, search, unreadOnly, combineByContact } = req.query;
    const messageWhere: any = {
      OR: [
        { contact: { workspaceId: req.user!.workspaceId } },
        { lead: { workspaceId: req.user!.workspaceId } },
      ],
      isInternal: false,
    };
    if (channel) messageWhere.channel = channel;

    // Visibilidade restrita: só vê conversas do próprio (lead atribuído ou conversa atribuída)
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') {
      const myMetas = await prisma.conversationMeta.findMany({
        where: { workspaceId: req.user!.workspaceId, assignedToId: req.user!.id },
        select: { contactId: true, channel: true },
      });
      const myContactIds = myMetas.map((m) => m.contactId).filter((x) => x) as string[];
      messageWhere.OR = [
        { lead: { workspaceId: req.user!.workspaceId, assignedToId: req.user!.id } },
        ...(myContactIds.length ? [{ contactId: { in: myContactIds } }] : []),
      ];
    }

    const messages = await prisma.message.findMany({
      where: messageWhere,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true, email: true, avatar: true, type: true } },
        lead: { select: { id: true, title: true } },
        sentBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byKey: Record<string, any> = {};
    for (const m of messages) {
      let key: string;
      if (combineByContact === 'true' && m.contactId) {
        key = m.contactId;
      } else {
        key = m.contactId
          ? `${m.contactId}:${m.channel}`
          : m.leadId ? `lead:${m.leadId}:${m.channel}` : `none:${m.channel}`;
      }
      if (!byKey[key]) {
        byKey[key] = {
          key,
          contact: m.contact || null,
          leadId: m.leadId || null,
          channel: m.channel,
          channels: new Set([m.channel]),
          lastMessage: m,
          messages: [m],
          unread: 0,
          combined: combineByContact === 'true',
        };
      } else {
        byKey[key].messages.push(m);
        byKey[key].channels.add(m.channel);
      }
      if (m.direction === 'INBOUND' && !m.readAt) {
        byKey[key].unread++;
      }
    }

    let conversations = Object.values(byKey).map((c: any) => ({
      key: c.key,
      contact: c.contact,
      leadId: c.leadId,
      channel: c.channel,
      channels: Array.from(c.channels),
      lastMessage: c.lastMessage,
      unread: c.unread,
      total: c.messages.length,
      combined: c.combined,
    }));

    if (unreadOnly === 'true') conversations = conversations.filter((c: any) => c.unread > 0);
    if (search) {
      const q = (search as string).toLowerCase();
      conversations = conversations.filter((c: any) => {
        const name = c.contact ? `${c.contact.firstName || ''} ${c.contact.lastName || ''}`.toLowerCase() : '';
        const last = (c.lastMessage?.content || '').toLowerCase();
        const phone = (c.contact?.phone || c.contact?.whatsapp || '').toLowerCase();
        return name.includes(q) || last.includes(q) || phone.includes(q);
      });
    }

    res.json(conversations);
  } catch (e) { next(e); }
});

// GET /api/messages
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId, contactId, allChannels, page = 1, limit = 200 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (leadId) where.leadId = leadId;
    if (contactId) where.contactId = contactId;
    // Quando combinado por contacto, queremos todos os canais mas limita ao workspace
    if (!leadId && !contactId) {
      where.OR = [
        { contact: { workspaceId: req.user!.workspaceId } },
        { lead: { workspaceId: req.user!.workspaceId } },
      ];
    }
    const messages = await prisma.message.findMany({
      where, skip, take: Number(limit),
      orderBy: { createdAt: 'asc' },
      include: messageInclude,
    });
    res.json(messages);
  } catch (e) { next(e); }
});

// POST /api/messages
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { content, channel, contactId, leadId, type, direction, mediaUrl, mediaType, replyToId, isInternal } = req.body;
    if (!content) throw new AppError('Conteudo obrigatorio', 400);
    if (!channel) throw new AppError('Canal obrigatorio', 400);

    let externalId: string | undefined;
    let status = 'PENDING';
    let sendError: string | undefined;

    // Enviar via canal externo se não for nota interna nem inbound
    const shouldSendExternal = !isInternal && (direction || 'OUTBOUND') === 'OUTBOUND' && contactId &&
      ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK'].includes(channel);

    if (shouldSendExternal) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });

      if (channel === 'WHATSAPP') {
        const phone = contact?.whatsapp || contact?.phone;
        if (!phone) {
          sendError = 'Contacto sem número de WhatsApp';
        } else {
          const result = await sendWhatsAppOut(req.user!.workspaceId, phone, content, type || 'TEXT', mediaUrl);
          if (result.ok) { externalId = result.externalId; status = 'SENT'; }
          else { sendError = result.error; status = 'FAILED'; }
        }
      } else if (channel === 'INSTAGRAM' || channel === 'FACEBOOK') {
        const recipientId = channel === 'INSTAGRAM' ? (contact as any)?.instagramId : (contact as any)?.facebookId;
        if (!recipientId) {
          sendError = `Contacto sem ID ${channel}`;
        } else {
          const result = await sendMetaOut(req.user!.workspaceId, channel as any, recipientId, content, type || 'TEXT', mediaUrl);
          if (result.ok) { externalId = result.externalId; status = 'SENT'; }
          else { sendError = result.error; status = 'FAILED'; }
        }
      }
    } else {
      status = 'SENT';
    }

    const message = await prisma.message.create({
      data: {
        content,
        channel,
        type: type || 'TEXT',
        direction: direction || 'OUTBOUND',
        status: status as any,
        contactId: contactId || null,
        leadId: leadId || null,
        replyToId: replyToId || null,
        isInternal: !!isInternal,
        mediaUrl, mediaType,
        externalId,
        sentById: req.user!.id,
      },
      include: messageInclude,
    });

    // Ao responder a uma conversa, marcar inbound anteriores como lidas (sempre) +
    // enviar read receipt ao remetente via Evolution (sempre que se responde)
    if (shouldSendExternal && contactId) {
      const inboundUnread = await prisma.message.findMany({
        where: { direction: 'INBOUND', readAt: null, contactId },
        include: { contact: { select: { whatsapp: true, phone: true } } },
      });
      if (inboundUnread.length > 0) {
        await prisma.message.updateMany({
          where: { direction: 'INBOUND', readAt: null, contactId },
          data: { readAt: new Date(), status: 'READ' },
        });
        evolutionMarkRead(req.user!.workspaceId, inboundUnread).catch(() => {});
      }
    }

    const io = req.app.get('io');
    if (message.leadId) io.to(`lead:${message.leadId}`).emit('message:new', message);
    io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);

    if (sendError) {
      return res.status(201).json({ ...message, sendError });
    }
    res.status(201).json(message);
  } catch (e) { next(e); }
});

// PATCH /api/messages/:id - editar mensagem (conteudo + propagar para canal)
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { content } = req.body;
    if (!content) throw new AppError('Conteudo obrigatorio', 400);
    const existing = await prisma.message.findUnique({
      where: { id: req.params.id },
      include: { contact: { select: { whatsapp: true, phone: true } } },
    });
    if (!existing) throw new AppError('Mensagem nao encontrada', 404);
    if (existing.sentById !== req.user!.id) {
      throw new AppError('So podes editar mensagens que enviaste', 403);
    }

    // Tentar editar no canal externo (WhatsApp via Evolution)
    let editedExternal = false;
    if (existing.channel === 'WHATSAPP' && existing.externalId && existing.contactId) {
      const evo = await prisma.integration.findFirst({
        where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
      });
      if (evo) {
        const creds: any = evo.credentials || {};
        const phone = existing.contact?.whatsapp || existing.contact?.phone;
        if (creds.baseUrl && creds.apiKey && creds.instanceName && phone) {
          try {
            const r = await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/updateMessage/${creds.instanceName}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
              body: JSON.stringify({
                number: phone.replace(/\D/g, ''),
                key: { id: existing.externalId, remoteJid: `${phone.replace(/\D/g, '')}@s.whatsapp.net`, fromMe: true },
                text: content,
              }),
            });
            if (r.ok) editedExternal = true;
            else {
              const txt = await r.text();
              console.warn('Evolution updateMessage falhou:', txt.substring(0, 200));
            }
          } catch (e: any) { console.warn('Evolution updateMessage erro:', e.message); }
        }
      }
    }

    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: { content, editedAt: new Date() },
      include: messageInclude,
    });

    const io = req.app.get('io');
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('message:updated', message);

    res.json({ ...message, editedExternal });
  } catch (e) { next(e); }
});

// PATCH /api/messages/:id/read
router.patch('/:id/read', async (req: AuthRequest, res: Response, next) => {
  try {
    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: { readAt: new Date(), status: 'READ' },
    });
    res.json(message);
  } catch (e) { next(e); }
});

// Helper: envia mark-as-read para a Evolution para que o ticker azul apareça no telefone do remetente
async function evolutionMarkRead(workspaceId: string, messages: Array<{ externalId: string | null; contact?: { whatsapp?: string | null; phone?: string | null } | null }>) {
  if (!messages.length) return;
  const evo = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
  });
  if (!evo) return;
  const creds: any = evo.credentials || {};
  if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) return;

  // Agrupar por contacto
  const groups = new Map<string, string[]>();
  for (const m of messages) {
    if (!m.externalId) continue;
    const phone = m.contact?.whatsapp || m.contact?.phone;
    if (!phone) continue;
    const remote = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
    if (!groups.has(remote)) groups.set(remote, []);
    groups.get(remote)!.push(m.externalId);
  }

  for (const [remoteJid, ids] of groups) {
    try {
      await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/markMessageAsRead/${creds.instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
        body: JSON.stringify({
          readMessages: ids.map((id) => ({ id, remoteJid, fromMe: false })),
        }),
      });
    } catch (e) {
      console.error('Evolution markMessageAsRead error:', e);
    }
  }
}

// POST /api/messages/mark-conversation-read
// body: { contactId, leadId, sendReceipt: boolean } - se sendReceipt=true, envia ticks azuis ao remetente via Evolution
router.post('/mark-conversation-read', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, leadId, sendReceipt } = req.body;
    const where: any = { direction: 'INBOUND', readAt: null };
    if (contactId) where.contactId = contactId;
    if (leadId) where.leadId = leadId;

    // Buscar mensagens antes de marcar (para ter externalIds)
    const inbound = sendReceipt ? await prisma.message.findMany({
      where, include: { contact: { select: { whatsapp: true, phone: true } } },
    }) : [];

    const result = await prisma.message.updateMany({ where, data: { readAt: new Date(), status: 'READ' } });

    if (sendReceipt && inbound.length > 0) {
      evolutionMarkRead(req.user!.workspaceId, inbound).catch(() => {});
    }

    res.json({ updated: result.count });
  } catch (e) { next(e); }
});

// ==== Conversation metadata (favoritas, arquivadas, atribuir, tags) ====

// GET /api/messages/meta/:contactId/:channel - obter metadata
router.get('/meta/:contactId/:channelOrAll', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, channelOrAll } = req.params;
    const channel = channelOrAll === 'all' ? null : channelOrAll;
    const meta = await prisma.conversationMeta.findFirst({
      where: { workspaceId: req.user!.workspaceId, contactId, channel },
      include: { assignedTo: { select: { id: true, name: true } }, tags: { include: { tag: true } } },
    });
    res.json(meta);
  } catch (e) { next(e); }
});

// GET /api/messages/meta - listar todas (para mostrar badges nas conversas)
router.get('/meta', async (req: AuthRequest, res: Response, next) => {
  try {
    const metas = await prisma.conversationMeta.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: { assignedTo: { select: { id: true, name: true, avatar: true } }, tags: { include: { tag: true } } },
    });
    res.json(metas);
  } catch (e) { next(e); }
});

// POST /api/messages/meta - upsert
router.post('/meta', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, channel, isArchived, isPinned, assignedToId, tagIds, priority } = req.body;
    const finalChannel = channel === 'all' ? null : channel;
    const existing = await prisma.conversationMeta.findFirst({
      where: { workspaceId: req.user!.workspaceId, contactId, channel: finalChannel },
    });
    let meta;
    if (existing) {
      meta = await prisma.conversationMeta.update({
        where: { id: existing.id },
        data: {
          ...(isArchived !== undefined && { isArchived }),
          ...(isPinned !== undefined && { isPinned }),
          ...(assignedToId !== undefined && { assignedToId: assignedToId || null }),
          ...(priority !== undefined && { priority }),
        },
      });
    } else {
      meta = await prisma.conversationMeta.create({
        data: {
          workspaceId: req.user!.workspaceId,
          contactId,
          channel: finalChannel,
          isArchived: !!isArchived,
          isPinned: !!isPinned,
          priority: priority || 'NORMAL',
          assignedToId: assignedToId || null,
        },
      });
    }
    // Substituir tags se enviadas
    if (Array.isArray(tagIds)) {
      await prisma.tagOnConversation.deleteMany({ where: { conversationId: meta.id } });
      if (tagIds.length) {
        await prisma.tagOnConversation.createMany({
          data: tagIds.map((tagId: string) => ({ conversationId: meta.id, tagId })),
        });
      }
    }
    const result = await prisma.conversationMeta.findUnique({
      where: { id: meta.id },
      include: { assignedTo: { select: { id: true, name: true } }, tags: { include: { tag: true } } },
    });

    // Propagar responsável para Contact + outros ConversationMeta + Leads do mesmo contacto
    if (assignedToId !== undefined && contactId) {
      await propagateAssignee(req.user!.workspaceId, contactId, assignedToId || null, 'conversation');
    }

    res.json(result);
  } catch (e) { next(e); }
});

// DELETE /api/messages/conversation - elimina TODAS as mensagens de uma conversa
// body: { contactId, channel? }
// IMPORTANTE: definido ANTES de /:id para não ser interpretado como ID
router.delete('/conversation', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, channel } = req.body;
    if (!contactId) throw new AppError('contactId obrigatório', 400);

    const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId: req.user!.workspaceId } });
    if (!contact) throw new AppError('Contacto não encontrado', 404);

    const where: any = { contactId };
    if (channel && channel !== 'all') where.channel = channel;

    const result = await prisma.message.deleteMany({ where });

    await prisma.conversationMeta.deleteMany({
      where: { workspaceId: req.user!.workspaceId, contactId, ...(channel && channel !== 'all' ? { channel } : {}) },
    }).catch(() => {});

    const io = req.app.get('io');
    if (io) io.to(`workspace:${req.user!.workspaceId}`).emit('conversation:deleted', { contactId, channel: channel || null });

    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

// DELETE /api/messages/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Mensagem nao encontrada', 404);
    if (existing.sentById !== req.user!.id) {
      throw new AppError('So podes eliminar mensagens que enviaste', 403);
    }
    await prisma.message.delete({ where: { id: req.params.id } });
    res.json({ message: 'Mensagem eliminada' });
  } catch (e) { next(e); }
});

// DUPLICADO (mantido para retro-compatibilidade — pode ser removido)
router.delete('/_old/conversation', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, channel } = req.body;
    if (!contactId) throw new AppError('contactId obrigatório', 400);
    const contact = await prisma.contact.findFirst({ where: { id: contactId, workspaceId: req.user!.workspaceId } });
    if (!contact) throw new AppError('Contacto não encontrado', 404);
    const where: any = { contactId };
    if (channel && channel !== 'all') where.channel = channel;
    const result = await prisma.message.deleteMany({ where });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

// GET /api/messages/calls - listar chamadas (mensagens SYSTEM com 📞)
router.get('/calls', async (req: AuthRequest, res: Response, next) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      type: 'SYSTEM',
      content: { contains: '📞', mode: 'insensitive' },
      contact: { workspaceId: req.user!.workspaceId },
    };
    if (search) {
      where.contact.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { whatsapp: { contains: search as string } },
      ];
    }

    const [calls, total] = await Promise.all([
      prisma.message.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true, avatar: true } } },
      }),
      prisma.message.count({ where }),
    ]);

    res.json({ calls, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { next(e); }
});

// GET /api/messages/export?contactId=&channel=&format=txt|json - exportar conversa
router.get('/export', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, channel, format = 'txt' } = req.query;
    if (!contactId) throw new AppError('contactId obrigatório', 400);

    const where: any = { contactId: contactId as string, isInternal: false };
    if (channel) where.channel = channel as string;

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { sentBy: { select: { name: true } } },
    });

    const contact = await prisma.contact.findFirst({
      where: { id: contactId as string, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto não encontrado', 404);

    const fullName = `${contact.firstName}${contact.lastName ? ' ' + contact.lastName : ''}`;
    const filename = `conversa_${fullName.replace(/[^\w]/g, '_')}_${Date.now()}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      return res.json({ contact: { name: fullName, phone: contact.phone, whatsapp: contact.whatsapp }, messages });
    }

    // Default: TXT
    const lines: string[] = [];
    lines.push(`Conversa com ${fullName}`);
    lines.push(`Telefone: ${contact.phone || contact.whatsapp || '-'}`);
    lines.push(`Exportada em: ${new Date().toLocaleString('pt-PT')}`);
    lines.push('='.repeat(60));
    lines.push('');

    for (const m of messages) {
      const ts = new Date(m.createdAt).toLocaleString('pt-PT');
      const sender = m.direction === 'INBOUND' ? fullName : (m.sentBy?.name || 'Sistema');
      lines.push(`[${ts}] ${sender}:`);
      lines.push(m.content || '(sem texto)');
      if (m.mediaUrl) lines.push(`  Anexo: ${m.mediaUrl}`);
      lines.push('');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
});

export default router;
