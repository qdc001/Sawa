// Auto-dispatch de sugestoes da IA Vendedora em modo autonomo (Fase 4).
//
// Usado pelo maybeTriggerSalesSuggestion quando o workspace tem
// aiSalesMode='auto' e a accao da IA e send_text ou send_product.
//
// Logica espelha o endpoint /suggestions/:id/approve mas sem decisorId
// (sentById fica null para distinguir envios automaticos dos humanos)
// e marca o status como SENT.

import prisma from './prisma';
import { sendWhatsAppOut, sendWhatsAppPresence } from './whatsappSend';

// Pausa proporcional ao comprimento da proxima mensagem para simular
// digitacao humana. Limites razoaveis: minimo 800ms (mostra typing pelo
// menos esse tempo), maximo 4500ms (nao deixa o lead a aguardar demais).
// Calculo: base 600ms + 30ms por caracter.
function typingDelayFor(text: string): number {
  const len = (text || '').length;
  const computed = 600 + len * 30;
  return Math.max(800, Math.min(4500, computed));
}

// Helper publico para ser reutilizado tambem por dispatchSuggestion no
// router (Fase 3): envia partes em sequencia com presence "composing"
// antes de cada uma e pausa proporcional ao tamanho da proxima mensagem.
// Cria entradas Message com direction OUTBOUND e emite socket message:new.
//
// sentById=null marca envio automatico (modo auto); humano define o seu id
// quando vier de aprovacao manual.
export async function dispatchSalesParts(opts: {
  workspaceId: string;
  contactId: string;
  contactPhone: string;
  leadId: string | null;
  parts: string[];
  productFiles: Array<{ id: string; url: string; type: string; name?: string | null }>;
  sentById: string | null;
  io: any;
}): Promise<{ sentMessageIds: string[]; failedAt?: number; error?: string }> {
  const { workspaceId, contactId, contactPhone, leadId, parts, productFiles, sentById, io } = opts;
  const sentMessageIds: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const text = parts[i];
    // Presence: "a escrever" + pausa proporcional ao texto.
    await sendWhatsAppPresence(workspaceId, contactPhone, 'composing', typingDelayFor(text));
    await new Promise((r) => setTimeout(r, typingDelayFor(text)));

    const result = await sendWhatsAppOut(workspaceId, contactPhone, text, 'TEXT');
    // Limpa typing apos enviar (no caso de haver mais partes, a proxima
    // iteracao volta a marcar composing).
    sendWhatsAppPresence(workspaceId, contactPhone, 'paused').catch(() => {});

    const msg = await prisma.message.create({
      data: {
        content: text,
        type: 'TEXT',
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: result.ok ? 'SENT' : 'FAILED',
        externalId: result.externalId,
        contactId,
        leadId: leadId || undefined,
        sentById: sentById || undefined,
      },
    });
    sentMessageIds.push(msg.id);
    if (io) {
      io.to(`workspace:${workspaceId}`).emit('message:new', msg);
      if (leadId) io.to(`lead:${leadId}`).emit('message:new', msg);
    }
    if (!result.ok) {
      return { sentMessageIds, failedAt: i, error: result.error };
    }
  }

  // Anexos de produto: tambem com pequena pausa entre cada para nao
  // bombardear o destinatario.
  for (const file of productFiles) {
    const mtype = file.type?.startsWith('image/') ? 'IMAGE'
      : file.type?.startsWith('video/') ? 'VIDEO'
      : file.type?.startsWith('audio/') ? 'AUDIO'
      : 'DOCUMENT';
    await sendWhatsAppPresence(workspaceId, contactPhone, 'composing', 1500);
    await new Promise((r) => setTimeout(r, 1500));

    const result = await sendWhatsAppOut(workspaceId, contactPhone, file.name || 'Anexo', mtype, file.url, file.name || undefined);
    sendWhatsAppPresence(workspaceId, contactPhone, 'paused').catch(() => {});

    const msg = await prisma.message.create({
      data: {
        content: file.name || 'Anexo',
        type: mtype as any,
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: result.ok ? 'SENT' : 'FAILED',
        externalId: result.externalId,
        mediaUrl: file.url,
        mediaType: file.type,
        contactId,
        leadId: leadId || undefined,
        sentById: sentById || undefined,
      },
    });
    sentMessageIds.push(msg.id);
    if (io) {
      io.to(`workspace:${workspaceId}`).emit('message:new', msg);
      if (leadId) io.to(`lead:${leadId}`).emit('message:new', msg);
    }
    if (!result.ok) {
      return { sentMessageIds, failedAt: parts.length, error: result.error };
    }
  }
  return { sentMessageIds };
}

export async function autoDispatchSuggestion(suggestionId: string, io: any): Promise<void> {
  const suggestion = await prisma.aiSalesSuggestion.findUnique({
    where: { id: suggestionId },
    include: { contact: true },
  });
  if (!suggestion) return;
  if (suggestion.status !== 'PENDING') return;
  if (suggestion.action !== 'send_text' && suggestion.action !== 'send_product') return;

  const phone = suggestion.contact.whatsapp || suggestion.contact.phone;
  if (!phone) {
    await prisma.aiSalesSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'FAILED', decidedAt: new Date(), errorDetail: 'Contacto sem numero de WhatsApp/telefone' },
    });
    return;
  }

  const partsArr = Array.isArray(suggestion.parts) ? (suggestion.parts as any[]).filter((p) => typeof p === 'string') : [];

  // Anexos de produto
  let productFiles: Array<{ id: string; url: string; type: string; name?: string | null }> = [];
  if (suggestion.action === 'send_product' && Array.isArray(suggestion.productFileIds)) {
    const ids = (suggestion.productFileIds as any[]).filter((x) => typeof x === 'string');
    if (ids.length > 0) {
      const files = await prisma.file.findMany({ where: { id: { in: ids } } });
      productFiles = files.map((f) => ({ id: f.id, url: f.url, type: f.mimeType, name: f.name }));
    }
  }

  const dispatch = await dispatchSalesParts({
    workspaceId: suggestion.workspaceId,
    contactId: suggestion.contactId,
    contactPhone: phone,
    leadId: suggestion.leadId,
    parts: partsArr,
    productFiles,
    sentById: null, // modo automatico
    io,
  });

  const updated = await prisma.aiSalesSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: dispatch.error ? 'FAILED' : 'SENT',
      decidedAt: new Date(),
      // decidedById fica null: marca decisao automatica pela IA
      finalParts: partsArr as any,
      sentMessageIds: dispatch.sentMessageIds as any,
      errorDetail: dispatch.error || null,
    },
  });
  if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
}
