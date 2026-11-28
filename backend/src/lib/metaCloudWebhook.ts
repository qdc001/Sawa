// Webhook da WhatsApp Cloud API (Meta): mensagens recebidas, estados de
// entrega e ecos das mensagens escritas no telemovel (coexistencia).
//
// Faz o mesmo que o webhook da Evolution: contacto + lead, guardar a
// mensagem (com a media descarregada para /uploads), avisar o Inbox e
// disparar chatbots, automacoes e a IA Vendedora (Leiz).

import prisma from './prisma';
import { runChatbotForMessage } from './chatbotEngine';
import { triggerAutomations } from './automationEngine';
import { notifyNewMessage } from './notify';
import { maybeTriggerSalesSuggestion } from './aiSalesAgent';
import { newLeadTarget } from './leadTarget';
import { analysePhone, nameFromPushOrPhone } from './phoneFormat';
import { Cloud, cloudByPhoneId, downloadCloudMedia, explainError } from './metaCloud';

type Parsed = { content: string; type: string; mediaUrl?: string; mediaType?: string; fileName?: string | null; interactiveId?: string | null };

async function parseContent(c: Cloud, msg: any): Promise<Parsed | null> {
  const t = msg.type;
  const media = async (obj: any, ext: string) => (obj?.id || obj?.link ? await downloadCloudMedia(c, obj.id || '', ext, obj.filename, obj.link) : null) || undefined;
  switch (t) {
    case 'text': return { content: msg.text?.body || '', type: 'TEXT' };
    case 'image': return { content: msg.image?.caption || '[Imagem]', type: 'IMAGE', mediaUrl: await media(msg.image, 'jpg'), mediaType: msg.image?.mime_type };
    case 'video': return { content: msg.video?.caption || '[Video]', type: 'VIDEO', mediaUrl: await media(msg.video, 'mp4'), mediaType: msg.video?.mime_type };
    case 'audio': return { content: '[Audio]', type: 'AUDIO', mediaUrl: await media(msg.audio, 'ogg'), mediaType: msg.audio?.mime_type };
    case 'sticker': return { content: '[Sticker]', type: 'IMAGE', mediaUrl: await media(msg.sticker, 'webp'), mediaType: msg.sticker?.mime_type };
    case 'document': return {
      content: msg.document?.caption || '[Documento]', type: 'DOCUMENT',
      mediaUrl: await media(msg.document, 'bin'), mediaType: msg.document?.mime_type, fileName: msg.document?.filename || null,
    };
    case 'location': {
      const l = msg.location || {};
      return { content: `Localização: ${l.latitude}, ${l.longitude}${l.name ? ` (${l.name})` : ''}`, type: 'LOCATION' };
    }
    case 'contacts': {
      const names = (msg.contacts || []).map((x: any) => `${x.name?.formatted_name || ''} ${(x.phones || []).map((p: any) => p.phone).join(', ')}`.trim());
      return { content: `Contacto partilhado: ${names.join('; ')}`, type: 'TEXT' };
    }
    case 'interactive': {
      const i = msg.interactive || {};
      const r = i.button_reply || i.list_reply;
      if (r) return { content: r.title || r.id || '[Botão]', type: 'INTERACTIVE', interactiveId: r.id || null };
      return { content: '[Interactive]', type: 'INTERACTIVE' };
    }
    case 'button': // botao de resposta rapida de um modelo
      return { content: msg.button?.text || msg.button?.payload || '[Botão]', type: 'INTERACTIVE', interactiveId: msg.button?.payload || null };
    default:
      console.log(`[cloud] tipo nao suportado: ${t}`, msg.errors?.[0]?.title || '');
      return null;
  }
}

async function findOrCreateContact(workspaceId: string, waId: string, profileName: string) {
  const info = analysePhone(waId);
  let contact = await prisma.contact.findFirst({ where: { workspaceId, whatsapp: info.rawDigits } });
  const name = nameFromPushOrPhone(profileName, waId);
  if (!contact) {
    contact = await prisma.contact.create({
      data: { firstName: name, whatsapp: info.rawDigits, phone: info.display, workspaceId, type: 'PERSON' },
    });
  } else if (profileName) {
    const cur = (contact.firstName || '').trim();
    if (!cur || /^\+?\d[\d\s]*$/.test(cur) || cur.startsWith('Contacto WhatsApp')) {
      contact = await prisma.contact.update({ where: { id: contact.id }, data: { firstName: name } });
    }
  }
  return contact;
}

async function findOrCreateLead(workspaceId: string, contact: { id: string; firstName: string | null }, source: string) {
  let lead = await prisma.lead.findFirst({ where: { contactId: contact.id, status: 'OPEN', workspaceId } });
  if (lead) return lead;
  const pipeline = await newLeadTarget(workspaceId);
  const owner = await prisma.user.findFirst({ where: { workspaceId, role: 'OWNER' } });
  if (!pipeline?.stages[0] || !owner) return null;
  return prisma.lead.create({
    data: {
      title: `WhatsApp - ${contact.firstName || ''}`.trim(), source, workspaceId,
      pipelineId: pipeline.id, stageId: pipeline.stages[0].id, contactId: contact.id, createdById: owner.id,
    },
  });
}

async function applyReaction(workspaceId: string, msg: any, actor: 'contact' | 'phone', io: any) {
  const targetId = msg.reaction?.message_id;
  if (!targetId) return;
  const target = await prisma.message.findFirst({ where: { externalId: targetId } });
  if (!target) return;
  const emoji: string = msg.reaction?.emoji || '';
  const reactions: Record<string, string[]> = { ...((target.reactions as any) || {}) };
  for (const k of Object.keys(reactions)) {
    reactions[k] = reactions[k].filter((id) => id !== actor);
    if (!reactions[k].length) delete reactions[k];
  }
  if (emoji) reactions[emoji] = [...(reactions[emoji] || []), actor];
  const updated = await prisma.message.update({
    where: { id: target.id },
    data: { reactions: (Object.keys(reactions).length ? reactions : null) as any },
  });
  if (io) io.to(`workspace:${workspaceId}`).emit('message:updated', updated);
}

async function ingest(c: Cloud, msg: any, waId: string, profileName: string, fromMe: boolean, io: any): Promise<void> {
  const workspaceId = c.workspaceId;
  if (msg.type === 'reaction') return applyReaction(workspaceId, msg, fromMe ? 'phone' : 'contact', io);
  if (msg.type === 'system') { console.log('[cloud] mensagem de sistema:', msg.system?.body || ''); return; }
  if (msg.id) {
    const exists = await prisma.message.findFirst({ where: { externalId: msg.id }, select: { id: true } });
    if (exists) return;
    if (fromMe) {
      await new Promise((r) => setTimeout(r, 3000));
      if (await prisma.message.findFirst({ where: { externalId: msg.id }, select: { id: true } })) return;
    }
  }
  const parsed = await parseContent(c, msg);
  if (!parsed) return;

  const contact = await findOrCreateContact(workspaceId, waId, fromMe ? '' : profileName);
  const ref = msg.referral;
  const source = ref?.source_type === 'ad' ? `Anúncio WhatsApp${ref.headline ? `: ${String(ref.headline).slice(0, 80)}` : ''}` : 'WhatsApp (Meta)';
  const lead = await findOrCreateLead(workspaceId, contact, source);
  if (ref && !fromMe) console.log(`[cloud] conversa de anuncio ${ref.source_id || '?'} (${ref.headline || '-'}) contacto=${contact.id}`);

  let replyToId: string | undefined;
  if (msg.context?.id) {
    const q = await prisma.message.findFirst({ where: { externalId: msg.context.id, contactId: contact.id }, select: { id: true } });
    if (q) replyToId = q.id;
  }

  const saved = await prisma.message.create({
    data: {
      content: parsed.content, type: parsed.type as any,
      direction: fromMe ? 'OUTBOUND' : 'INBOUND', channel: 'WHATSAPP',
      status: fromMe ? 'SENT' : 'DELIVERED',
      externalId: msg.id || undefined, mediaUrl: parsed.mediaUrl, mediaType: parsed.mediaType,
      fileName: parsed.fileName || null, leadId: lead?.id, contactId: contact.id, replyToId,
      createdAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
    },
    include: { replyTo: { select: { id: true, content: true, direction: true, sentBy: { select: { name: true } } } } },
  });
  if (io) {
    io.to(`workspace:${workspaceId}`).emit('message:new', saved);
    if (lead) io.to(`lead:${lead.id}`).emit('message:new', saved);
  }
  if (fromMe) return;

  // "PARAR" (opcao de saida do modelo de follow-up): a Leiz deixa de escrever
  // a este contacto. Menos bloqueios = melhor qualidade do numero na Meta.
  if (/^\s*(parar|stop|sair)\s*[.!]*\s*$/i.test(parsed.content)) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiSalesDisabledConversationIds: true } });
    const ids = Array.isArray(ws?.aiSalesDisabledConversationIds) ? (ws!.aiSalesDisabledConversationIds as string[]) : [];
    if (!ids.includes(contact.id)) {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { aiSalesDisabledConversationIds: [...ids, contact.id] as any } });
      console.log(`[cloud] contacto ${contact.id} pediu PARAR: Leiz desligada nesta conversa`);
    }
    return;
  }

  const { autoAssignConversation } = await import('../routes/webhooks');
  autoAssignConversation(workspaceId, contact.id, 'WHATSAPP').then((id) => {
    if (id && io) io.to(`user:${id}`).emit('notification:new', { type: 'auto_assign' });
  }).catch(() => {});
  if ((parsed.type === 'TEXT' || parsed.type === 'INTERACTIVE') && parsed.content) {
    runChatbotForMessage({
      workspaceId, contactId: contact.id, leadId: lead?.id,
      message: parsed.interactiveId || parsed.content, channel: 'WHATSAPP', io,
    }).catch((e) => console.error('Chatbot engine (cloud) error:', e));
  }
  triggerAutomations({ type: 'message_received', workspaceId, entityType: 'message', entityId: saved.id }).catch(() => {});
  maybeTriggerSalesSuggestion({
    workspaceId, contactId: contact.id, leadId: lead?.id,
    triggerMessageId: saved.id, triggerMessageContent: parsed.content, io,
  });
  notifyNewMessage(saved.id).catch(() => {});
}

const RANK: Record<string, number> = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

async function applyStatus(workspaceId: string, s: any, io: any): Promise<void> {
  const mapped = s.status === 'read' ? 'READ' : s.status === 'delivered' ? 'DELIVERED' : s.status === 'sent' ? 'SENT' : s.status === 'failed' ? 'FAILED' : null;
  if (!s.id || !mapped) return;
  // YCloud: guardamos o wamid, mas pode ter ficado o id da YCloud (s.altId).
  const ids = [s.id, s.altId].filter(Boolean);
  const cur = await prisma.message.findFirst({ where: { externalId: { in: ids } }, select: { id: true, status: true, deliveredAt: true, readAt: true, contactId: true } });
  if (!cur) return;
  if (mapped !== 'FAILED' && (RANK[cur.status] ?? 0) >= RANK[mapped]) return;
  if (mapped === 'FAILED') {
    const e = s.errors?.[0] || {};
    console.warn(`[cloud] mensagem ${s.id.slice(-8)} falhou: ${explainError(e.code, e.error_data?.details || e.title || 'erro')} (${e.code || '?'})`);
  }
  const updated = await prisma.message.update({
    where: { id: cur.id },
    data: {
      status: mapped as any,
      ...((mapped === 'DELIVERED' || mapped === 'READ') && !cur.deliveredAt ? { deliveredAt: new Date(Number(s.timestamp || 0) * 1000 || Date.now()) } : {}),
      ...(mapped === 'READ' && !cur.readAt ? { readAt: new Date(Number(s.timestamp || 0) * 1000 || Date.now()) } : {}),
    },
  });
  if (io) {
    io.to(`workspace:${workspaceId}`).emit('message:updated', updated);
    if (updated.leadId) io.to(`lead:${updated.leadId}`).emit('message:updated', updated);
  }
}

export async function handleCloudWebhook(body: any, io: any): Promise<void> {
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      try {
        const phoneId = v.metadata?.phone_number_id;
        const c = phoneId ? await cloudByPhoneId(phoneId) : null;
        if (!c) {
          if (change.field === 'messages' || change.field === 'smb_message_echoes') console.warn(`[cloud] phone_number_id ${phoneId} sem integracao activa`);
          else console.log(`[cloud] evento ${change.field}`, JSON.stringify(v).slice(0, 300));
          continue;
        }
        if (change.field === 'messages') {
          const names = new Map<string, string>();
          for (const ct of v.contacts || []) if (ct.wa_id) names.set(ct.wa_id, ct.profile?.name || '');
          for (const m of v.messages || []) {
            try { await ingest(c, m, m.from, names.get(m.from) || '', false, io); }
            catch (e: any) { console.error(`[cloud] falha a gravar mensagem ${String(m.id).slice(-8)}:`, e?.message || e); }
          }
          for (const s of v.statuses || []) {
            try { await applyStatus(c.workspaceId, s, io); }
            catch (e: any) { console.error('[cloud] falha no estado:', e?.message || e); }
          }
        } else if (change.field === 'smb_message_echoes') {
          // Coexistencia: mensagens escritas na app WhatsApp Business do telemovel.
          for (const m of v.message_echoes || []) {
            try { await ingest(c, m, m.to, '', true, io); }
            catch (e: any) { console.error('[cloud] falha a gravar eco:', e?.message || e); }
          }
        } else {
          // history, smb_app_state_sync, message_template_status_update, account_update...
          console.log(`[cloud] evento ${change.field}`, JSON.stringify(v).slice(0, 300));
        }
      } catch (e: any) {
        console.error(`[cloud] falha no evento ${change.field}:`, e?.message || e);
      }
    }
  }
}

// ---------- YCloud ----------
// Converte os eventos da YCloud para o formato da Meta e usa o mesmo caminho.
const seenEvents = new Map<string, number>();
function seen(id: string | undefined): boolean {
  if (!id) return false;
  if (seenEvents.has(id)) return true;
  seenEvents.set(id, Date.now());
  if (seenEvents.size > 5000) {
    const cut = Date.now() - 3600_000;
    for (const [k, t] of seenEvents) if (t < cut) seenEvents.delete(k);
  }
  return false;
}

const digits = (s: any) => String(s || '').replace(/\D/g, '');
const ts = (iso: any) => (iso ? Math.floor(Date.parse(iso) / 1000) : undefined);

function ycToMeta(m: any): any {
  const { id: _yid, wamid, from, to, sendTime, customerProfile, wabaId, ...rest } = m;
  return { ...rest, id: wamid || _yid, from: digits(from), to: digits(to), timestamp: ts(sendTime || m.createTime) };
}

export async function handleYcloudWebhook(body: any, io: any): Promise<void> {
  if (seen(body?.id)) return;
  const type: string = body?.type || '';
  try {
    if (type === 'whatsapp.inbound_message.received') {
      const m = body.whatsappInboundMessage || {};
      const c = await cloudByPhoneId(digits(m.to));
      if (!c) { console.warn(`[ycloud] numero ${digits(m.to).slice(-4)} sem integracao activa`); return; }
      if (m.groupId) return; // grupos fora
      await ingest(c, ycToMeta(m), digits(m.from), m.customerProfile?.name || '', false, io);
    } else if (type === 'whatsapp.message.updated') {
      const m = body.whatsappMessage || {};
      const c = await cloudByPhoneId(digits(m.from));
      if (!c) return;
      const code = Number(m.whatsappApiError?.code || 0) || undefined;
      await applyStatus(c.workspaceId, {
        id: m.wamid || m.id, altId: m.id, status: m.status,
        timestamp: ts(m.readTime || m.deliverTime || m.sendTime || m.createTime),
        errors: m.status === 'failed' ? [{ code, title: m.errorMessage, error_data: m.whatsappApiError?.error_data }] : undefined,
      }, io);
    } else if (type === 'whatsapp.smb.message.echoes' || type === 'whatsapp.smb.message.created') {
      const m = body.whatsappMessage || {};
      const c = await cloudByPhoneId(digits(m.from));
      if (!c) return;
      await ingest(c, ycToMeta(m), digits(m.to), '', true, io);
    } else {
      console.log(`[ycloud] evento ${type}`, JSON.stringify(body).slice(0, 300));
    }
  } catch (e: any) {
    console.error(`[ycloud] falha no evento ${type}:`, e?.message || e);
  }
}
