// Helper partilhado para enviar mensagens WhatsApp via canal disponivel.
// Tenta Evolution API primeiro (suporta audio nativo e grupos via JID),
// depois faz fallback para WhatsApp Cloud API (Meta).
//
// Extraido de routes/messages.ts para ser reutilizado pelo agente IA
// Vendedora (Fase 3) e por qualquer outro modulo que precise enviar
// mensagens fora do fluxo de Inbox.

import prisma from './prisma';
import { getCreds } from './integrationCrypto';

export type WhatsAppSendResult = {
  ok: boolean;
  externalId?: string;
  via?: string;
  error?: string;
};

export async function sendWhatsAppOut(
  workspaceId: string,
  phone: string,
  content: string,
  type: string,
  mediaUrl?: string,
  fileName?: string,
): Promise<WhatsAppSendResult> {
  // 1. Tentar Evolution
  const evo = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
  });
  if (evo) {
    const creds: any = getCreds(evo);
    if (creds.baseUrl && creds.apiKey && creds.instanceName) {
      try {
        let path: string;
        const isGroupJid = typeof phone === 'string' && phone.includes('@g.us');
        const destination = isGroupJid ? phone : phone.replace(/\D/g, '');
        let body: any = { number: destination };

        if (type === 'AUDIO' && mediaUrl) {
          path = `/message/sendWhatsAppAudio/${creds.instanceName}`;
          body.audio = mediaUrl;
        } else if (type !== 'TEXT' && mediaUrl) {
          path = `/message/sendMedia/${creds.instanceName}`;
          body.mediatype = type === 'IMAGE' ? 'image' : type === 'VIDEO' ? 'video' : 'document';
          body.media = mediaUrl;
          body.caption = content && content !== 'Anexo' ? content : '';
          if (fileName && fileName.trim()) {
            body.fileName = fileName.trim();
          } else if (content && content !== 'Anexo' && !content.startsWith('[')) {
            body.fileName = content;
          } else {
            body.fileName = (mediaUrl || '').split('/').pop()
              ?.replace(/^\d+-[a-z0-9]+-/, '')
              ?.replace(/^wa_\d+_\w+\./, 'arquivo.') || 'arquivo';
          }
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

  // 2. Fallback WhatsApp Cloud (Meta)
  const cloud = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WHATSAPP', isActive: true },
  });
  if (cloud) {
    const creds: any = getCreds(cloud);
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

  return { ok: false, error: 'Sem integracao WhatsApp activa' };
}
