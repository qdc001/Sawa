import { Router, Request, Response } from 'express';
import { runChatbotForMessage } from '../lib/chatbotEngine';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewMessage } from '../lib/notify';
import { analysePhone, nameFromPushOrPhone } from '../lib/phoneFormat';
import { applyEvoContactToCrm } from './integrations';
import fs from 'fs';
import path from 'path';

import prisma from '../lib/prisma';
import { getCreds, encryptForStore } from '../lib/integrationCrypto';
const router = Router();

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
    // Decidir extensão a partir do mime type (curto e seguro)
    const MIME_TO_EXT: Record<string, string> = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/msword': 'doc',
      'application/pdf': 'pdf',
      'application/zip': 'zip',
      'application/x-rar-compressed': 'rar',
      'application/x-7z-compressed': '7z',
      'text/plain': 'txt',
      'text/csv': 'csv',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
    };
    let ext = fallbackExt;
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    if (MIME_TO_EXT[cleanMime]) {
      ext = MIME_TO_EXT[cleanMime];
    } else if (cleanMime.includes('/')) {
      const t = cleanMime.split('/')[1];
      // Sanitizar (sem pontos/espaços)
      ext = t.replace(/[^a-z0-9]/g, '').substring(0, 8) || fallbackExt;
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

// ============= Meta Webhook (Instagram + Facebook Messenger) =============
// Verificação (GET)
router.get('/meta', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === process.env.META_VERIFY_TOKEN) {
    console.log('Meta webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Envio Meta (Instagram DM + Facebook Messenger usam mesmo endpoint)
async function sendMetaMessage(creds: any, recipientId: string, text: string, mediaUrl?: string, mediaType?: 'image' | 'audio' | 'video' | 'file'): Promise<string | null> {
  const accessToken = creds.accessToken || creds.pageAccessToken;
  const pageId = creds.pageId;
  if (!accessToken || !pageId) return null;

  let messagePayload: any;
  if (mediaUrl && mediaType) {
    messagePayload = {
      attachment: {
        type: mediaType,
        payload: { url: mediaUrl, is_reusable: true },
      },
    };
  } else {
    messagePayload = { text };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
        messaging_type: 'RESPONSE',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Meta send error:', data);
      return null;
    }
    return data.message_id || null;
  } catch (e) {
    console.error('Meta send exception:', e);
    return null;
  }
}

// Receção (POST) — processa eventos Instagram + Facebook
router.post('/meta', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const objectType = body.object; // 'instagram' | 'page'
    if (!objectType || !Array.isArray(body.entry)) return res.sendStatus(200);

    const channel = objectType === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK';
    const integrationType = channel; // INSTAGRAM ou FACEBOOK no enum
    const io = (global as any).io;

    for (const entry of body.entry) {
      const pageId = entry.id;
      // Encontrar integração pela pageId/instagramBusinessId
      const integrations = await prisma.integration.findMany({
        where: { type: integrationType as any, isActive: true },
      });
      const matched = integrations.find((i: any) => {
        const c: any = getCreds(i);
        return c?.pageId === pageId || c?.instagramBusinessId === pageId;
      }) || integrations[0]; // fallback
      if (!matched) continue;
      const workspaceId = matched.workspaceId;
      const creds: any = getCreds(matched);

      const messagingItems = entry.messaging || entry.changes?.flatMap((c: any) => c.value?.messages || []) || [];
      for (const event of messagingItems) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        if (!senderId) continue;
        if (senderId === pageId) continue; // mensagem da própria página (ignorar)

        const isInbound = recipientId === pageId;
        const externalUserId = isInbound ? senderId : recipientId;

        // Encontrar/criar contacto pelo ID externo
        const idField = channel === 'INSTAGRAM' ? 'instagramId' : 'facebookId';
        let contact = await prisma.contact.findFirst({
          where: { [idField]: externalUserId, workspaceId } as any,
        });
        if (!contact) {
          // Tentar obter perfil
          let displayName = `Contacto ${channel}`;
          try {
            const profRes = await fetch(`https://graph.facebook.com/v20.0/${externalUserId}?fields=name,first_name&access_token=${creds.accessToken || creds.pageAccessToken}`);
            if (profRes.ok) {
              const prof = await profRes.json();
              displayName = prof.first_name || prof.name || displayName;
            }
          } catch {}
          contact = await prisma.contact.create({
            data: {
              firstName: displayName,
              workspaceId,
              type: 'PERSON',
              [idField]: externalUserId,
            } as any,
          });
        }

        // Encontrar/criar lead aberto
        let lead = await prisma.lead.findFirst({ where: { contactId: contact.id, status: 'OPEN', workspaceId } });
        if (!lead) {
          const pipeline = await prisma.pipeline.findFirst({
            where: { workspaceId, isDefault: true },
            include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
          });
          const owner = await prisma.user.findFirst({ where: { workspaceId, role: 'OWNER' } });
          if (pipeline?.stages[0] && owner) {
            lead = await prisma.lead.create({
              data: {
                title: `${channel} - ${contact.firstName}`,
                source: channel === 'INSTAGRAM' ? 'Instagram' : 'Facebook',
                workspaceId,
                pipelineId: pipeline.id,
                stageId: pipeline.stages[0].id,
                contactId: contact.id,
                createdById: owner.id,
              },
            });
          }
        }

        // Extrair conteúdo
        let content = '';
        let msgType = 'TEXT';
        let mediaUrl: string | undefined;

        if (event.message) {
          const m = event.message;
          if (m.text) content = m.text;
          else if (m.attachments?.length) {
            const att = m.attachments[0];
            if (att.type === 'image') { msgType = 'IMAGE'; content = '[Imagem]'; mediaUrl = att.payload?.url; }
            else if (att.type === 'video') { msgType = 'VIDEO'; content = '[Video]'; mediaUrl = att.payload?.url; }
            else if (att.type === 'audio') { msgType = 'AUDIO'; content = '[Audio]'; mediaUrl = att.payload?.url; }
            else if (att.type === 'file') { msgType = 'DOCUMENT'; content = '[Documento]'; mediaUrl = att.payload?.url; }
            else if (att.type === 'story_mention') { content = `[Menção em story]`; }
            else if (att.type === 'share') { content = `[Partilha] ${att.payload?.url || ''}`; }
            else content = `[${att.type}]`;
          } else if (m.is_deleted) {
            content = '(mensagem apagada)';
          } else {
            content = '[Mensagem]';
          }
        } else if (event.postback) {
          content = event.postback.title || event.postback.payload || '[Botão clicado]';
          msgType = 'INTERACTIVE';
        } else {
          continue;
        }

        const saved = await prisma.message.create({
          data: {
            content,
            type: msgType as any,
            direction: isInbound ? 'INBOUND' : 'OUTBOUND',
            channel: channel as any,
            status: isInbound ? 'DELIVERED' : 'SENT',
            externalId: event.message?.mid || undefined,
            mediaUrl,
            leadId: lead?.id,
            contactId: contact.id,
          },
        });

        if (io) {
          io.to(`workspace:${workspaceId}`).emit('message:new', saved);
          if (lead) io.to(`lead:${lead.id}`).emit('message:new', saved);
        }

        if (isInbound) {
          // Auto-assign + chatbots + automações + notify
          autoAssignConversation(workspaceId, contact.id, channel).catch(() => {});
          if ((msgType === 'TEXT' || msgType === 'INTERACTIVE') && content) {
            runChatbotForMessage({
              workspaceId, contactId: contact.id, leadId: lead?.id,
              message: content, channel, io,
            }).catch(() => {});
          }
          triggerAutomations({ type: 'message_received', workspaceId, entityType: 'message', entityId: saved.id }).catch(() => {});
          notifyNewMessage(saved.id).catch(() => {});
        }
      }
    }
    res.sendStatus(200);
  } catch (e: any) {
    console.error('Meta webhook error:', e);
    res.sendStatus(500);
  }
});

// ============= TikTok Lead Forms webhook =============
router.get('/tiktok', (req: Request, res: Response) => {
  // Verificação de domínio TikTok
  if (req.query.challenge) return res.status(200).send(req.query.challenge);
  res.json({ message: 'TikTok lead webhook ready' });
});

router.post('/tiktok', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const io = (global as any).io;
    // TikTok envia: { event: "leadgen.lead_created", data: { lead_form_id, lead_id, business_id, fields: [{name, value}], submitted_at } }
    if (body.event !== 'leadgen.lead_created' && body.event !== 'lead_form_submission') {
      return res.sendStatus(200);
    }

    const businessId = body.data?.business_id || body.business_id;
    const integration = await prisma.integration.findFirst({
      where: { type: 'WEBHOOK' as any, name: { contains: 'TikTok', mode: 'insensitive' }, isActive: true },
    });
    if (!integration) return res.sendStatus(200);
    const workspaceId = integration.workspaceId;

    const fields: Array<{ name: string; value: string }> = body.data?.fields || body.fields || [];
    const fieldMap: Record<string, string> = {};
    fields.forEach((f) => { fieldMap[(f.name || '').toLowerCase()] = f.value; });

    const firstName = fieldMap['first_name'] || fieldMap['nome'] || fieldMap['full_name'] || 'Lead TikTok';
    const phone = fieldMap['phone_number'] || fieldMap['phone'] || fieldMap['telefone'];
    const email = fieldMap['email'];

    let contact = phone ? await prisma.contact.findFirst({ where: { phone, workspaceId } }) : null;
    if (!contact && email) contact = await prisma.contact.findFirst({ where: { email, workspaceId } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          firstName,
          phone: phone || null,
          email: email || null,
          workspaceId,
          type: 'PERSON',
          tiktokId: body.data?.lead_id || null,
          notes: 'Lead via TikTok Lead Form',
        } as any,
      });
    }

    // Criar lead
    const pipeline = await prisma.pipeline.findFirst({
      where: { workspaceId, isDefault: true },
      include: { stages: { orderBy: { position: 'asc' }, take: 1 } },
    });
    const owner = await prisma.user.findFirst({ where: { workspaceId, role: 'OWNER' } });
    if (pipeline?.stages[0] && owner) {
      const lead = await prisma.lead.create({
        data: {
          title: `TikTok Lead - ${firstName}`,
          source: 'TikTok',
          workspaceId,
          pipelineId: pipeline.id,
          stageId: pipeline.stages[0].id,
          contactId: contact.id,
          createdById: owner.id,
        },
      });
      if (io) io.to(`workspace:${workspaceId}`).emit('lead:created', lead);
      triggerAutomations({ type: 'lead_created', workspaceId, entityType: 'lead', entityId: lead.id }).catch(() => {});
    }

    res.sendStatus(200);
  } catch (e: any) {
    console.error('TikTok webhook error:', e);
    res.sendStatus(500);
  }
});

// ============= Evolution API webhook =============
// O servidor Evolution chama este endpoint com eventos: MESSAGES_UPSERT, CONNECTION_UPDATE, etc.
router.post('/evolution', async (req: Request, res: Response) => {
  try {
    const event = req.body?.event || req.body?.type;
    const data = req.body?.data || req.body;
    const instanceName = req.body?.instance || data?.instance || data?.instanceName;

    // Debug verboso desactivado por defeito — define EVO_VERBOSE=1 na env para reactivar.
    // Cada mensagem gerava 1 linha de log; em workspaces activos isto enche stdout
    // e impacta performance/disco do contentor.
    if (process.env.EVO_VERBOSE === '1' &&
      (event === 'messages.upsert' || event === 'MESSAGES_UPSERT' || event === 'send.message' || event === 'SEND_MESSAGE')) {
      const isFromMe = data?.key?.fromMe || data?.messages?.[0]?.key?.fromMe;
      console.log(`Evo webhook [${event}] instance=${instanceName} fromMe=${isFromMe} hasKey=${!!data?.key}`);
    }

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
      const creds: any = getCreds(integration);
      if (creds.instanceName === instanceName) matched = integration;
    }
    if (!matched) {
      // procurar todas e match
      const all = await prisma.integration.findMany({
        where: { type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
      });
      matched = all.find((i: any) => (getCreds(i) as any)?.instanceName === instanceName);
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
        const creds: any = getCreds(matched);
        await prisma.integration.update({
          where: { id: matched.id },
          data: { credentials: encryptForStore({ ...creds, lastState: state }) as any, isActive: state === 'open' },
        });
        if (io) io.to(`workspace:${workspaceId}`).emit('evolution:state', { state });
      }
      return res.json({ ok: true });
    }

    // Mensagens novas (inbound + fromMe do telefone)
    // Inclui: messages.upsert (chega/sincroniza), send.message (envio confirmado), messages.set (sync histórico)
    if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT' ||
        event === 'message' || event === 'send.message' || event === 'SEND_MESSAGE' ||
        event === 'messages.set' || event === 'MESSAGES_SET') {
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
        if (!remoteJid) continue;
        if (remoteJid.endsWith('@broadcast')) continue; // ignorar broadcast lists
        const isGroup = remoteJid.endsWith('@g.us');

        const fromMe = !!m.key?.fromMe;
        const externalId: string | undefined = m.key?.id;

        // Filtrar logo tipos não suportados (reacções, stickers, mensagens encriptadas, protocol)
        // — antes martelávamos a BD com 1 message.create + dedup + lead lookup + emit por cada
        // reacção 👍 ou sticker, e isso enche o backend rapidamente. Skip silencioso.
        const rawMsg = m.message || {};
        const innerKeys = Object.keys(rawMsg);
        const isUnsupported =
          rawMsg.reactionMessage ||
          rawMsg.secretEncryptedMessage ||
          rawMsg.protocolMessage ||
          rawMsg.pollUpdateMessage ||
          rawMsg.pollCreationMessage ||
          (innerKeys.length === 1 && innerKeys[0] === 'messageContextInfo') ||
          (innerKeys.length === 2 && innerKeys.includes('messageContextInfo') &&
            (innerKeys.includes('reactionMessage') || innerKeys.includes('secretEncryptedMessage')));
        if (isUnsupported) continue;

        // Se for fromMe e já guardámos esta mensagem (envio via CRM), saltar
        if (fromMe && externalId) {
          const exists = await prisma.message.findFirst({ where: { externalId }, select: { id: true } });
          if (exists) continue;
        }

        const phone = remoteJid.split('@')[0].replace(/\D/g, '');
        if (!phone) continue;

        // Extrair conteúdo
        const msg = rawMsg;
        let content = '';
        let msgType = 'TEXT';
        let mediaUrl: string | undefined;
        let interactiveId: string | null = null;

        const creds: any = getCreds(matched);

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
          msgType = 'VIDEO'; content = vm.caption || '[Video]';
          const local = await fetchMediaFromEvolution(creds, m, 'mp4');
          mediaUrl = local ? absoluteUrl(req, local) : vm.url;
        } else if (unwrapped.audioMessage || msg.audioMessage) {
          const am = unwrapped.audioMessage || msg.audioMessage;
          msgType = 'AUDIO'; content = '[Audio]';
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
        } else if (unwrapped.stickerMessage || msg.stickerMessage) {
          msgType = 'IMAGE'; content = '[Sticker]';
        } else {
          // Tipo não reconhecido — não cria mensagem para não poluir BD.
          if (process.env.EVO_VERBOSE === '1') {
            console.log('Evolution webhook: tipo desconhecido. Chaves:', Object.keys(msg).join(','), '| messageType:', m.messageType);
          }
          continue;
        }

        // Encontrar/criar contacto (com formatação de número e detecção de LID)
        const phoneInfo = analysePhone(phone);
        const ownerName: string | null = (getCreds(matched) as any)?.ownerName || null;
        const incomingPush =
          m.pushName && ownerName && String(m.pushName).trim().toLowerCase() === ownerName.toLowerCase()
            ? ''
            : (m.pushName || '');

        let contact: any;
        let lead: any = null;

        if (isGroup) {
          // GRUPO — guardamos o JID completo no campo `whatsapp` (não usamos só dígitos).
          // Type=COMPANY para distinguir visualmente. Nome do grupo vem de chat.subject
          // ou cai para "Grupo WhatsApp". O participant pushName é prefixo da mensagem.
          const groupJid = remoteJid;
          const groupName = m.pushName || 'Grupo WhatsApp'; // pushName do grupo vem como nome do grupo em alguns clientes
          contact = await prisma.contact.findFirst({ where: { whatsapp: groupJid, workspaceId } });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                firstName: groupName,
                whatsapp: groupJid,
                workspaceId,
                type: 'COMPANY',
                notes: 'Grupo WhatsApp (não enviar campanhas)',
              },
            });
          }
          // Para grupos, prefixar conteúdo com o nome do participante para se ver quem disse o quê
          // (continuamos abaixo no extracção do content — temos de fazer pós-prefixo)
        } else {
          // CONTACTO normal (1-1)
          const contactName = nameFromPushOrPhone(incomingPush, phone);
          contact = await prisma.contact.findFirst({ where: { whatsapp: phoneInfo.rawDigits, workspaceId } });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                firstName: contactName,
                whatsapp: phoneInfo.rawDigits,
                phone: phoneInfo.isLid ? null : phoneInfo.display,
                workspaceId,
                type: 'PERSON',
              },
            });
          } else if (incomingPush && incomingPush.trim()) {
            const trimmed = (contact.firstName || '').trim();
            const looksLikePlaceholder =
              !trimmed ||
              /^\+?\d[\d\s]*$/.test(trimmed) ||
              trimmed === 'Contacto WhatsApp' ||
              (!!ownerName && trimmed.toLowerCase() === ownerName.toLowerCase());
            if (looksLikePlaceholder && contactName !== trimmed) {
              contact = await prisma.contact.update({ where: { id: contact.id }, data: { firstName: contactName } });
            }
          }

          // Encontrar/criar lead aberto (só para contactos 1-1, não para grupos)
          lead = await prisma.lead.findFirst({ where: { contactId: contact.id, status: 'OPEN', workspaceId } });
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
        }

        // Para grupos: prefixar conteúdo com o nome do participante (se inbound)
        if (isGroup && !fromMe && m.pushName && content) {
          content = `${m.pushName}: ${content}`;
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

        // Skip de chatbots/automações/notify se for fromMe (mensagem enviada pelo dono do número, não requer resposta automática)
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

    // Contactos guardados/actualizados no telefone (livro de contactos)
    if (event === 'contacts.upsert' || event === 'CONTACTS_UPSERT' ||
        event === 'contacts.update' || event === 'CONTACTS_UPDATE') {
      try {
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.contacts) ? data.contacts
          : [data];
        const ownerName: string | null = (getCreds(matched) as any)?.ownerName || null;
        let updated = 0;
        for (const c of list) {
          try {
            const r = await applyEvoContactToCrm(prisma, workspaceId, c, ownerName);
            if (r.updated) {
              updated++;
              const jid = String(c?.remoteJid || c?.id || '');
              const phone = jid.split('@')[0].replace(/\D/g, '');
              if (io) io.to(`workspace:${workspaceId}`).emit('contact:name-updated', { phone });
            }
          } catch { /* silent */ }
        }
        return res.json({ ok: true, updated });
      } catch (e) {
        console.error('contacts.upsert parse error:', e);
        return res.json({ ok: true });
      }
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
              ? `📞 Chamada de ${callType === 'video' ? 'video' : 'voz'} recebida (atende no telefone)`
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
