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
import { triggerAutomations } from './automationEngine';

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
    // Despoletar automacoes message_sent (ex: mover etapa ao enviar PDF)
    triggerAutomations({
      type: 'message_sent', workspaceId,
      entityType: 'message', entityId: msg.id,
    }).catch((e) => console.error('Automation message_sent (sales) error:', e));
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
    // Despoletar automacoes message_sent (ex: mover etapa ao enviar PDF)
    triggerAutomations({
      type: 'message_sent', workspaceId,
      entityType: 'message', entityId: msg.id,
    }).catch((e) => console.error('Automation message_sent (sales) error:', e));
    if (!result.ok) {
      return { sentMessageIds, failedAt: parts.length, error: result.error };
    }
  }
  return { sentMessageIds };
}

// Executa a accao concreta associada a uma sugestao (book_appointment /
// create_task). Partilhada entre modo autonomo e aprovacao/edicao humana:
// o comportamento tem de ser o mesmo para o humano avaliar realmente o que
// a Leizy fara em auto.
//
// Devolve { createdEntity, executionError }:
//  - createdEntity: null se accao nao produz entidade (send_text, handoff,
//    wait, send_product) ou se falhou. Caso contrario { type, id }.
//  - executionError: string com detalhe humano do que correu mal, para
//    quem chama decidir se envia mensagem alternativa (auto) ou aborta
//    e devolve erro ao humano (approve/edit).
export async function executeSuggestionAction(
  suggestion: { id: string; workspaceId: string; contactId: string; leadId: string | null; action: string; actionPayload: any },
  io: any,
): Promise<{ createdEntity: { type: string; id: string } | null; executionError: string | null }> {
  let createdEntity: { type: string; id: string } | null = null;
  let executionError: string | null = null;

  if (suggestion.action === 'book_appointment' && suggestion.actionPayload) {
    try {
      const payload = suggestion.actionPayload as any;
      const startsAt = new Date(payload.startsAtISO);
      // Detectar conflitos: outra consulta do mesmo contacto na mesma hora
      // (janela de +/- 15min) e ja com estado activo.
      const existing = await prisma.appointment.findFirst({
        where: {
          workspaceId: suggestion.workspaceId,
          contactId: suggestion.contactId,
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          startsAt: {
            gte: new Date(startsAt.getTime() - 15 * 60_000),
            lte: new Date(startsAt.getTime() + 15 * 60_000),
          },
        },
      });
      if (existing) {
        executionError = `Ja ha marcacao proxima dessa hora (id=${existing.id}), nao criei nova para nao duplicar.`;
      } else {
        const appt = await prisma.appointment.create({
          data: {
            workspaceId: suggestion.workspaceId,
            contactId: suggestion.contactId,
            leadId: suggestion.leadId,
            title: String(payload.title || 'Consulta').slice(0, 200),
            startsAt,
            durationMin: Math.max(5, Math.min(240, Number(payload.durationMin) || 30)),
            notes: payload.notes ? String(payload.notes).slice(0, 500) : null,
            status: 'SCHEDULED',
            createdByAi: true,
          },
        });
        createdEntity = { type: 'appointment', id: appt.id };
        if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('appointment:new', appt);
      }
    } catch (e: any) {
      executionError = `Falha a criar consulta: ${e.message || 'desconhecido'}`;
    }
  } else if (suggestion.action === 'create_task' && suggestion.actionPayload) {
    try {
      const payload = suggestion.actionPayload as any;
      // Respeita regra "1 tarefa aberta por contacto"
      const existing = await prisma.task.findFirst({
        where: {
          contactId: suggestion.contactId,
          parentTaskId: null,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      });
      if (existing) {
        executionError = `Contacto ja tem tarefa aberta (id=${existing.id}), Leizy nao criou duplicada.`;
      } else {
        // Tasks precisam de assignedToId. Se a Leizy cria uma tarefa, atribuimos
        // ao primeiro OWNER/ADMIN do workspace por defeito. O admin pode reatribuir.
        const defaultAssignee = await prisma.user.findFirst({
          where: {
            workspaceId: suggestion.workspaceId,
            role: { in: ['OWNER', 'ADMIN'] },
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!defaultAssignee) {
          executionError = 'Nenhum OWNER/ADMIN activo para atribuir a tarefa.';
        } else {
          const days = Math.max(0, Math.min(30, Number(payload.dueInDays) || 1));
          const due = new Date(Date.now() + days * 24 * 60 * 60_000);
          due.setHours(23, 59, 0, 0);
          const task = await prisma.task.create({
            data: {
              title: String(payload.title || 'Seguimento pedido pela Leizy').slice(0, 200),
              description: payload.description ? String(payload.description).slice(0, 1000) : null,
              type: 'OTHER',
              status: 'PENDING',
              priority: payload.priority || 'MEDIUM',
              dueAt: due,
              contactId: suggestion.contactId,
              leadId: suggestion.leadId,
              assignedToId: defaultAssignee.id,
            },
          });
          createdEntity = { type: 'task', id: task.id };
          if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('task:new', task);
        }
      }
    } catch (e: any) {
      executionError = `Falha a criar tarefa: ${e.message || 'desconhecido'}`;
    }
  }

  return { createdEntity, executionError };
}

export async function autoDispatchSuggestion(suggestionId: string, io: any): Promise<void> {
  const suggestion = await prisma.aiSalesSuggestion.findUnique({
    where: { id: suggestionId },
    include: { contact: true },
  });
  if (!suggestion) return;
  if (suggestion.status !== 'PENDING') return;
  const supported = new Set(['send_text', 'send_product', 'book_appointment', 'create_task']);
  if (!supported.has(suggestion.action)) return;

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

  // Executar accao concreta ANTES de enviar as parts. Se falhar (ex: choque
  // de horarios), a Leizy nao anuncia ao paciente algo que nao aconteceu.
  const { createdEntity, executionError } = await executeSuggestionAction(
    { id: suggestion.id, workspaceId: suggestion.workspaceId, contactId: suggestion.contactId, leadId: suggestion.leadId, action: suggestion.action, actionPayload: suggestion.actionPayload },
    io,
  );

  let effectiveParts = partsArr;
  if (executionError) {
    console.warn(`[autoDispatch] execution error for suggestion=${suggestion.id}: ${executionError}`);
    // Substituir por mensagem de handoff simples
    effectiveParts = ['Um momento, vou confirmar com a equipa e ja regresso.'];
  }

  const dispatch = await dispatchSalesParts({
    workspaceId: suggestion.workspaceId,
    contactId: suggestion.contactId,
    contactPhone: phone,
    leadId: suggestion.leadId,
    parts: effectiveParts,
    productFiles,
    sentById: null, // modo automatico
    io,
  });

  const updated = await prisma.aiSalesSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: dispatch.error || executionError ? 'FAILED' : 'SENT',
      decidedAt: new Date(),
      // decidedById fica null: marca decisao automatica pela IA
      finalParts: effectiveParts as any,
      sentMessageIds: dispatch.sentMessageIds as any,
      errorDetail: executionError || dispatch.error || null,
      createdEntityType: createdEntity?.type || null,
      createdEntityId: createdEntity?.id || null,
    },
  });
  if (io) io.to(`workspace:${suggestion.workspaceId}`).emit('aiSales:decided', updated);
}
