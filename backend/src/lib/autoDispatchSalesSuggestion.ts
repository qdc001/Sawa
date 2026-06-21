// Auto-dispatch de sugestoes da IA Vendedora em modo autonomo (Fase 4).
//
// Usado pelo maybeTriggerSalesSuggestion quando o workspace tem
// aiSalesMode='auto' e a accao da IA e send_text ou send_product.
//
// Logica espelha o endpoint /suggestions/:id/approve mas sem decisorId
// (sentById fica null para distinguir envios automaticos dos humanos)
// e marca o status como SENT.

import prisma from './prisma';
import { sendWhatsAppOut } from './whatsappSend';

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

  const sentMessageIds: string[] = [];
  let errorDetail: string | null = null;

  // Envia partes em sequencia com pausa entre fragmentos
  for (let i = 0; i < partsArr.length; i++) {
    const text = partsArr[i];
    const result = await sendWhatsAppOut(suggestion.workspaceId, phone, text, 'TEXT');
    const msg = await prisma.message.create({
      data: {
        content: text,
        type: 'TEXT',
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: result.ok ? 'SENT' : 'FAILED',
        externalId: result.externalId,
        contactId: suggestion.contactId,
        leadId: suggestion.leadId || undefined,
        // sentById fica null: marca envio automatico pela IA
      },
    });
    sentMessageIds.push(msg.id);
    if (io) {
      io.to(`workspace:${suggestion.workspaceId}`).emit('message:new', msg);
      if (suggestion.leadId) io.to(`lead:${suggestion.leadId}`).emit('message:new', msg);
    }
    if (!result.ok) { errorDetail = result.error || 'Falha desconhecida'; break; }
    if (i < partsArr.length - 1) await new Promise((r) => setTimeout(r, 700));
  }

  // Anexos
  if (!errorDetail) {
    for (const file of productFiles) {
      const mtype = file.type?.startsWith('image/') ? 'IMAGE'
        : file.type?.startsWith('video/') ? 'VIDEO'
        : file.type?.startsWith('audio/') ? 'AUDIO'
        : 'DOCUMENT';
      const result = await sendWhatsAppOut(suggestion.workspaceId, phone, file.name || 'Anexo', mtype, file.url, file.name || undefined);
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
          contactId: suggestion.contactId,
          leadId: suggestion.leadId || undefined,
        },
      });
      sentMessageIds.push(msg.id);
      if (io) {
        io.to(`workspace:${suggestion.workspaceId}`).emit('message:new', msg);
        if (suggestion.leadId) io.to(`lead:${suggestion.leadId}`).emit('message:new', msg);
      }
      if (!result.ok) { errorDetail = result.error || 'Falha em anexo'; break; }
    }
  }

  const updated = await prisma.aiSalesSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: errorDetail ? 'FAILED' : 'SENT',
      decidedAt: new Date(),
      // decidedById fica null: marca decisao automatica pela IA
      finalParts: partsArr as any,
      sentMessageIds: sentMessageIds as any,
      errorDetail,
    },
  });
  if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
}
