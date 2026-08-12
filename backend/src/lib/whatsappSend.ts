// Helper partilhado para enviar mensagens WhatsApp via canal disponivel.
// Tenta Evolution API primeiro (suporta audio nativo e grupos via JID),
// depois faz fallback para WhatsApp Cloud API (Meta).
//
// Extraido de routes/messages.ts para ser reutilizado pelo agente IA
// Vendedora (Fase 3) e por qualquer outro modulo que precise enviar
// mensagens fora do fluxo de Inbox.

import fs from 'fs';
import path from 'path';
import prisma from './prisma';
import { getCreds } from './integrationCrypto';
import { publicMediaUrl } from './evolutionMedia';

// Acima disto, preferimos mandar URL em vez de base64. O base64 infla o
// payload em ~33% e vai tudo num unico JSON; ficheiros grandes (viram-se
// apresentacoes/relatorios na pratica, ja vimos .pptx de 1.2MB nos logs)
// ficam expostos a limites de payload e timeouts do lado da Evolution.
// So e possivel se PUBLIC_API_URL estiver configurada (senao nao ha URL
// publico para o ficheiro local).
const LARGE_MEDIA_THRESHOLD_BYTES = 5 * 1024 * 1024;

// Se o mediaUrl for local (/uploads/xxx.doc), le o ficheiro do disco e
// converte para base64. Evolution API aceita base64 no campo "media" e
// isto e mais fiavel que URL (nao depende de a Evolution conseguir
// aceder ao nosso host). Se o mediaUrl ja for absoluto (http/https), devolve
// null para o caller usar como URL directa.
//
// Devolve `missing: true` quando o path e local mas o ficheiro nao existe no
// disco (caso comum de mensagens migradas do M.E.T.A. antigo cujos ficheiros
// nao foram trazidos). O caller deve tratar como erro em vez de tentar enviar
// path relativo invalido para a Evolution.
function resolveMediaPayload(mediaUrl: string): { base64?: string; url?: string; missing?: boolean } {
  if (!mediaUrl) return {};
  // URL absoluto — usar como esta
  if (/^https?:\/\//i.test(mediaUrl)) {
    // Se aponta para o proprio backend em /uploads, tentar ler do disco para base64 (mais fiavel)
    const uploadsIdx = mediaUrl.indexOf('/uploads/');
    if (uploadsIdx >= 0) {
      const rel = mediaUrl.slice(uploadsIdx + '/uploads/'.length);
      const filePath = path.join(__dirname, '../../uploads', path.basename(rel));
      try {
        const buf = fs.readFileSync(filePath);
        if (buf.length > LARGE_MEDIA_THRESHOLD_BYTES && process.env.PUBLIC_API_URL) {
          return { url: publicMediaUrl(`/uploads/${path.basename(rel)}`) };
        }
        return { base64: buf.toString('base64') };
      } catch { /* fallback URL — o ficheiro pode estar acessivel via HTTP externo */ }
    }
    return { url: mediaUrl };
  }
  // URL relativo (/uploads/xxx) — ler do disco. Se nao existe, sinalizamos
  // explicitamente para o caller nao tentar enviar path relativo invalido.
  if (mediaUrl.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '../../uploads', path.basename(mediaUrl));
    try {
      const buf = fs.readFileSync(filePath);
      if (buf.length > LARGE_MEDIA_THRESHOLD_BYTES && process.env.PUBLIC_API_URL) {
        return { url: publicMediaUrl(mediaUrl) };
      }
      return { base64: buf.toString('base64') };
    } catch (e: any) {
      console.error('[whatsappSend] falha a ler ficheiro local:', filePath, e.message);
      return { missing: true };
    }
  }
  return { url: mediaUrl };
}

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
        // Numeros internacionais validos tem entre 8 e 15 digitos (E.164).
        // Sem esta verificacao, um numero corrompido na BD (prefixo
        // duplicado, dado migrado mal) so falha depois de uma chamada
        // completa a Evolution — vimos no log o mesmo numero invalido a
        // falhar 4 vezes seguidas em tentativas diferentes.
        if (!isGroupJid && (destination.length < 8 || destination.length > 15)) {
          return { ok: false, error: `Número de telefone inválido: "${phone}" (${destination.length} dígitos após limpeza). Verifica o contacto.` };
        }
        let body: any = { number: destination };

        if (type === 'AUDIO' && mediaUrl) {
          path = `/message/sendWhatsAppAudio/${creds.instanceName}`;
          const resolved = resolveMediaPayload(mediaUrl);
          if (resolved.missing) {
            return { ok: false, error: 'Ficheiro de áudio não encontrado no disco. Se a mensagem foi importada do CRM antigo, os ficheiros não foram trazidos. Refaz o upload.' };
          }
          // Evolution v2 aceita base64 puro (sem prefixo data:) ou URL.
          body.audio = resolved.base64 || resolved.url || mediaUrl;
        } else if (type !== 'TEXT' && mediaUrl) {
          path = `/message/sendMedia/${creds.instanceName}`;
          body.mediatype = type === 'IMAGE' ? 'image' : type === 'VIDEO' ? 'video' : 'document';
          // Preferir base64 (le do disco) para nao depender de URL publica
          // acessivel pela Evolution. Evolution v2 exige base64 PURO (sem
          // prefixo "data:mime;base64,") ou URL absoluta. O mimetype vai
          // no campo separado body.mimetype.
          const resolved = resolveMediaPayload(mediaUrl);
          if (resolved.missing) {
            return { ok: false, error: 'Ficheiro não encontrado no disco. Se este anexo foi importado do CRM antigo (M.E.T.A.), o ficheiro não foi trazido. Refaz o upload para reenviar.' };
          }
          body.media = resolved.base64 || resolved.url || mediaUrl;
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
          // Evolution v2 exige mimetype para documentos (senao WhatsApp
          // rejeita ou entrega sem preview). Determinar a partir da extensao
          // do ficheiro.
          if (body.mediatype === 'document') {
            const ext = String(body.fileName).split('.').pop()?.toLowerCase() || '';
            body.mimetype =
              ext === 'pdf' ? 'application/pdf' :
              ext === 'doc' ? 'application/msword' :
              ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
              ext === 'xls' ? 'application/vnd.ms-excel' :
              ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
              ext === 'ppt' ? 'application/vnd.ms-powerpoint' :
              ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' :
              ext === 'txt' ? 'text/plain' :
              ext === 'csv' ? 'text/csv' :
              ext === 'zip' ? 'application/zip' :
              ext === 'rar' ? 'application/vnd.rar' :
              'application/octet-stream';
          } else if (body.mediatype === 'image') {
            const ext = String(body.fileName || mediaUrl).split('.').pop()?.toLowerCase() || '';
            body.mimetype =
              ext === 'png' ? 'image/png' :
              ext === 'gif' ? 'image/gif' :
              ext === 'webp' ? 'image/webp' :
              'image/jpeg';
          } else if (body.mediatype === 'video') {
            body.mimetype = 'video/mp4';
          }
        } else {
          path = `/message/sendText/${creds.instanceName}`;
          body.text = content;
        }
        const mediaField: string = body.media || body.audio || '';
        const isUrl = /^https?:\/\//i.test(mediaField);
        console.log(`[whatsappSend] via evolution type=${type} to=${destination.slice(-4)} mode=${isUrl ? 'url' : (mediaField ? 'base64' : '-')} mime=${body.mimetype || '-'} file=${body.fileName || '-'}`);

        const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`;
        const requestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
          body: JSON.stringify(body),
        };

        // Uma tentativa extra em falhas transitorias (rede, 5xx). Erros 4xx
        // (numero invalido, payload mal formado) nao se resolvem repetindo,
        // por isso nao entram no retry. Antes, qualquer falha perdia-se de
        // vez sem segunda oportunidade.
        let r: Response;
        let respText: string;
        try {
          r = await fetch(url, requestInit);
          respText = await r.text();
        } catch (networkErr: any) {
          console.error(`[whatsappSend] falha de rede, a tentar 1x: ${networkErr.message}`);
          await new Promise((res) => setTimeout(res, 1500));
          r = await fetch(url, requestInit);
          respText = await r.text();
        }
        if (!r.ok && r.status >= 500) {
          console.error(`[whatsappSend] HTTP ${r.status}, a tentar 1x`);
          await new Promise((res) => setTimeout(res, 1500));
          r = await fetch(url, requestInit);
          respText = await r.text();
        }

        let data: any = respText;
        try { data = JSON.parse(respText); } catch {}
        if (r.ok) {
          console.log(`[whatsappSend] ok externalId=${data?.key?.id || '?'}`);
          return { ok: true, externalId: data?.key?.id, via: 'evolution' };
        }
        console.error(`[whatsappSend] falhou HTTP ${r.status} body=${respText.substring(0, 500)}`);
        // A Evolution devolve este formato quando o numero nao existe no
        // WhatsApp: {"response":{"message":[{"jid":"...","exists":false}]}}.
        // Vale a pena distinguir de um erro generico porque nao adianta
        // reenviar nem culpar a integracao — o numero em si esta errado.
        const notOnWhatsapp = Array.isArray(data?.response?.message) &&
          data.response.message.some((m: any) => m?.exists === false);
        if (notOnWhatsapp) {
          return { ok: false, error: `O número ${destination} não tem WhatsApp activo.` };
        }
        return { ok: false, error: data?.message || data?.error || `HTTP ${r.status}: ${respText.substring(0, 200)}` };
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

// Envia "presence" (typing indicator) ao destinatario via Evolution API.
// Estados validos: 'composing' (a escrever), 'recording', 'paused', 'available'.
// WhatsApp Cloud (Meta) nao expoe presence directo via API: para esse canal
// esta funcao e no-op silencioso. Usa-se na IA Vendedora para mostrar ao
// lead que esta a ser preparada uma resposta.
export async function sendWhatsAppPresence(
  workspaceId: string,
  phone: string,
  presence: 'composing' | 'recording' | 'paused' | 'available',
  delayMs?: number,
): Promise<void> {
  try {
    const evo = await prisma.integration.findFirst({
      where: { workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
    });
    if (!evo) return;
    const creds: any = getCreds(evo);
    if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) return;
    const isGroupJid = typeof phone === 'string' && phone.includes('@g.us');
    const destination = isGroupJid ? phone : String(phone).replace(/\D/g, '');
    await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/sendPresence/${creds.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: JSON.stringify({ number: destination, presence, delay: delayMs ?? 1200 }),
    });
  } catch {
    // Best-effort: nunca bloqueia o envio.
  }
}
