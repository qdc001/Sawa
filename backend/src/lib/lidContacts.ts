// Contactos com LID ("Contacto WhatsApp 1234").
//
// O WhatsApp identifica muitas pessoas por um LID (identificador interno) em
// vez do numero. A mesma pessoa pode por isso aparecer com dois
// identificadores: o LID (no historico guardado na Evolution) e o numero
// real (quando o WhatsApp o revela numa mensagem nova). Sem ligar os dois, a
// conversa ficava partida em dois contactos: o historico num
// "Contacto WhatsApp 1234" e as mensagens novas no contacto com o numero.
import prisma from './prisma';
import { analysePhone, nameFromPushOrPhone } from './phoneFormat';

const PN_KEYS = ['remoteJidAlt', 'senderPn', 'participantPn', 'pn', 'phoneNumber', 'jidAlt', 'lidAlt'];

// Procura um JID de numero real ("2588...@s.whatsapp.net") nos campos que a
// Evolution/Baileys usam para o identificador alternativo.
export function pnFromObject(obj: any, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  // Numa mensagem enviada por nos, senderPn/participantPn sao o NOSSO numero:
  // so o remoteJidAlt aponta para a outra pessoa.
  const keys = obj.fromMe === true ? ['remoteJidAlt'] : PN_KEYS;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.endsWith('@s.whatsapp.net')) return v.split('@')[0].replace(/\D/g, '') || null;
  }
  for (const k of ['key', 'lastMessage', 'contact']) {
    const found = pnFromObject(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

const isPlaceholder = (name: string | null | undefined) => {
  const t = (name || '').trim();
  return !t || t.startsWith('Contacto WhatsApp') || /^\+?\d[\d\s]*$/.test(t);
};

// Passa TUDO o que esta no contacto LID para o contacto com o numero real:
// mensagens, historico da Leiz (as sugestoes guardam o passo da conversa),
// marcacoes, tarefas, etiquetas, campos, etc. Antes so as mensagens e os
// leads mudavam e o contacto LID era apagado: o apagar levava em cascata o
// historico da Leiz (que voltava ao inicio da conversa), marcacoes e etiquetas.
// So apaga o contacto LID depois de tudo mudado, e se ficar sem leads.
async function mergeInto(fromId: string, toId: string, workspaceId: string) {
  const toLead = await prisma.lead.findFirst({ where: { contactId: toId, status: 'OPEN', workspaceId }, select: { id: true } });
  if (!toLead) {
    // O contacto real nao tem lead aberto: os leads do LID passam para ele.
    await prisma.lead.updateMany({ where: { contactId: fromId, workspaceId }, data: { contactId: toId } });
  }
  const move = { contactId: toId };
  const where = { contactId: fromId };
  const moved = await prisma.message.updateMany({ where, data: { ...move, ...(toLead ? { leadId: toLead.id } : {}) } });
  await prisma.aiSalesSuggestion.updateMany({ where, data: { ...move, ...(toLead ? { leadId: toLead.id } : {}) } });
  await prisma.appointment.updateMany({ where, data: move });
  await prisma.task.updateMany({ where, data: move });
  await prisma.scheduledDelivery.updateMany({ where, data: move });
  await prisma.chatbotSession.updateMany({ where, data: move });
  await prisma.automationRun.updateMany({ where, data: move });
  await prisma.csatRequest.updateMany({ where, data: move });
  await prisma.quote.updateMany({ where, data: move });
  await prisma.broadcastRecipient.updateMany({ where, data: move });
  await prisma.financeStudent.updateMany({ where, data: move });
  await prisma.defenseSession.updateMany({ where, data: move });

  // Etiquetas: juntar (sem repetir as que o contacto real ja tem).
  const tags = await prisma.tagOnContact.findMany({ where });
  if (tags.length) {
    await prisma.tagOnContact.createMany({ data: tags.map((t: any) => ({ ...t, contactId: toId })), skipDuplicates: true });
    await prisma.tagOnContact.deleteMany({ where });
  }
  // Campos personalizados: so os que o contacto real ainda nao tem.
  const fields = await prisma.customFieldValue.findMany({ where });
  for (const f of fields as any[]) {
    const has = await prisma.customFieldValue.findFirst({ where: { contactId: toId, fieldId: f.fieldId } });
    if (!has) await prisma.customFieldValue.update({ where: { id: f.id }, data: move });
  }
  // Estado da conversa (atribuicao, arquivada...): fica o do contacto real se ja existir.
  const metas = await prisma.conversationMeta.findMany({ where });
  for (const m of metas as any[]) {
    const has = await prisma.conversationMeta.findFirst({ where: { workspaceId: m.workspaceId, contactId: toId, channel: m.channel } });
    if (!has) await prisma.conversationMeta.update({ where: { id: m.id }, data: move });
  }
  // Leiz ligada/desligada nesta conversa (listas por contactId no workspace).
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiSalesEnabledConversationIds: true, aiSalesDisabledConversationIds: true } });
  if (ws) {
    const swap = (v: any) => {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      return arr.includes(fromId) ? [...new Set(arr.map((x) => (x === fromId ? toId : x)))] : null;
    };
    const en = swap(ws.aiSalesEnabledConversationIds);
    const dis = swap(ws.aiSalesDisabledConversationIds);
    if (en || dis) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: { ...(en ? { aiSalesEnabledConversationIds: en } : {}), ...(dis ? { aiSalesDisabledConversationIds: dis } : {}) },
      });
    }
  }

  const from = await prisma.contact.findUnique({ where: { id: fromId } });
  const leadsLeft = await prisma.lead.count({ where: { contactId: fromId } });
  if (from && isPlaceholder(from.firstName) && leadsLeft === 0) {
    try { await prisma.contact.delete({ where: { id: fromId } }); } catch { /* tem outras ligacoes: fica */ }
  }
  console.log(`[lid] ${moved.count} mensagens juntadas no contacto com numero real`);
}

// O LID `lid` pertence ao numero `real`. Garante que fica um so contacto
// (o do numero real, com o LID guardado) e devolve-o, ou null se a pessoa
// ainda nao existe no CRM.
export async function linkLid(workspaceId: string, lid: string, real: string, pushName?: string | null) {
  if (!lid || !real || lid === real) return null;
  const info = analysePhone(real);
  if (info.isLid) return null;
  let realC = await prisma.contact.findFirst({ where: { workspaceId, whatsapp: real } });
  const lidC = await prisma.contact.findFirst({
    where: { workspaceId, OR: [{ whatsapp: lid }, { whatsappLid: lid }], NOT: realC ? { id: realC.id } : undefined },
  });
  if (!realC && lidC) {
    // So existia o contacto LID: passa a ter o numero real.
    realC = await prisma.contact.update({
      where: { id: lidC.id },
      data: {
        whatsapp: real,
        whatsappLid: lid,
        phone: lidC.phone || info.display,
        ...(isPlaceholder(lidC.firstName) ? { firstName: nameFromPushOrPhone(pushName, real) } : {}),
      },
    });
    console.log(`[lid] contacto LID ${lid.slice(-4)} passou para o numero real ${real.slice(-4)}`);
    return realC;
  }
  if (!realC) return null;
  if (realC.whatsappLid !== lid) {
    realC = await prisma.contact.update({ where: { id: realC.id }, data: { whatsappLid: lid } });
  }
  if (lidC) await mergeInto(lidC.id, realC.id, workspaceId);
  return realC;
}

// O LID `lid` pertence a este contacto (sabido por uma mensagem NOSSA: o eco,
// a confirmacao de entrega ou a resposta do envio trazem o LID da conversa).
// Guarda o LID no contacto e junta nele o contacto duplicado criado quando a
// pessoa respondeu so com o LID (27/11, Jurelma: "Ta bem" foi parar a um
// contacto novo). Devolve true se juntou algum duplicado.
export async function attachLid(workspaceId: string, contactId: string, lid: string): Promise<boolean> {
  lid = String(lid || '').replace(/\D/g, '');
  if (!lid) return false;
  const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true, whatsapp: true, whatsappLid: true, type: true } });
  if (!c || c.type !== 'PERSON' || !c.whatsapp || c.whatsapp === lid || analysePhone(c.whatsapp).isLid) return false;
  if (c.whatsappLid !== lid) {
    // O LID ja estava guardado noutro contacto com numero real: nao mexer (ambiguo).
    const other = await prisma.contact.findFirst({ where: { workspaceId, whatsappLid: lid, NOT: { id: c.id } }, select: { id: true, whatsapp: true } });
    if (other && other.whatsapp && other.whatsapp !== lid && !analysePhone(other.whatsapp).isLid) return false;
    await prisma.contact.update({ where: { id: c.id }, data: { whatsappLid: lid } });
  }
  const dups = await prisma.contact.findMany({
    where: { workspaceId, type: 'PERSON', NOT: { id: c.id }, OR: [{ whatsapp: lid }, { whatsappLid: lid }] },
    select: { id: true, whatsapp: true },
  });
  let merged = false;
  for (const d of dups) {
    // So junta contactos que sao so o LID (sem numero real proprio).
    if (d.whatsapp && d.whatsapp !== lid && !analysePhone(d.whatsapp).isLid) continue;
    await mergeContacts(workspaceId, d.id, c.id);
    merged = true;
  }
  if (merged) console.log(`[lid] duplicado juntado: LID ${lid.slice(-4)} -> contacto ${c.id.slice(-6)}`);
  return merged;
}

// Junta o contacto `fromId` (duplicado) no `toId` (fica). Usado pela revisao
// manual dos duplicados (Integracoes > WhatsApp).
export async function mergeContacts(workspaceId: string, fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const [from, to] = await Promise.all([
    prisma.contact.findFirst({ where: { id: fromId, workspaceId } }),
    prisma.contact.findFirst({ where: { id: toId, workspaceId } }),
  ]);
  if (!from || !to) throw new Error('contacto nao encontrado');
  const lid = from.whatsappLid || (from.whatsapp && analysePhone(from.whatsapp).isLid ? from.whatsapp : null);
  if (lid && !to.whatsappLid) await prisma.contact.update({ where: { id: to.id }, data: { whatsappLid: lid } });
  await mergeInto(from.id, to.id, workspaceId);
  // mergeInto so apaga contactos com nome de placeholder; aqui a equipa confirmou: apagar se ficou vazio.
  const left = await prisma.contact.findUnique({ where: { id: from.id } });
  if (left) {
    const msgs = await prisma.message.count({ where: { contactId: from.id } });
    if (!msgs) {
      // O lead do duplicado (criado sozinho quando a mensagem entrou) sai: o
      // contacto que fica ja tem o seu. Tarefas/mensagens ficam sem esse lead.
      await prisma.lead.deleteMany({ where: { contactId: from.id, workspaceId } });
      try { await prisma.contact.delete({ where: { id: from.id } }); } catch { /* tem outras ligacoes: fica */ }
    }
  }
}

// Contacto ja conhecido por este LID (numero real ja revelado antes).
export function contactByLid(workspaceId: string, lid: string) {
  return prisma.contact.findFirst({ where: { workspaceId, whatsappLid: lid } });
}

// Reparacao: conversas que perderam o passo da Leiz Pro quando um contacto
// LID duplicado foi juntado e apagado (versao anterior desta junção apagava o
// historico das sugestoes em cascata). A Leiz relê a conversa (boas-vindas,
// pagamento, PDF dos pacotes) e guarda o passo, como no "Devolver a Leiz".
// Nao envia nada. Idempotente: so toca em contactos sem passo guardado.
export async function repairLostLeizState(workspaceId?: string): Promise<number> {
  const { isLeizProWorkspace, handBackToLeiz } = await import('./leizpro/engine');
  const candidates = await prisma.contact.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      whatsappLid: { not: null },
      type: 'PERSON',
      messages: { some: { direction: 'OUTBOUND', isInternal: false } },
    },
    select: { id: true, workspaceId: true },
  });
  let fixed = 0;
  for (const c of candidates) {
    if (!(await isLeizProWorkspace(c.workspaceId))) continue;
    // So conta um passo que ficou decidido (aprovado/editado/enviado). Depois
    // de perder o passo, a Leiz pode ter gerado sugestoes por decidir ja com o
    // passo errado ("primeiro contacto"): essas nao contam.
    const hasState = await prisma.aiSalesSuggestion.findFirst({
      where: { contactId: c.id, modelUsed: { startsWith: 'leizpro' }, status: { in: ['APPROVED', 'EDITED', 'SENT'] } },
      select: { id: true },
    });
    if (hasState) continue;
    try {
      // Sugestoes por decidir calculadas sem o passo (ex: "diz-me o teu nome") ja nao servem.
      await prisma.aiSalesSuggestion.updateMany({
        where: { contactId: c.id, status: 'PENDING' },
        data: { status: 'DISCARDED', decidedAt: new Date(), errorDetail: 'Descartada: passo da Leiz reconstruido a partir da conversa' },
      });
      const lead = await prisma.lead.findFirst({ where: { contactId: c.id, status: 'OPEN' }, select: { id: true } });
      const r = await handBackToLeiz(c.workspaceId, c.id, lead?.id || null, null);
      fixed++;
      console.log(`[lid] passo da Leiz reconstruido (${c.id.slice(-6)}): ${r.summary}`);
    } catch (e: any) {
      console.error('[lid] falha a reconstruir passo da Leiz:', e.message);
    }
  }
  return fixed;
}
