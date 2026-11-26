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

// Passa tudo o que esta no contacto LID para o contacto com o numero real.
// So apaga o contacto LID se ficar vazio e sem nada ligado (senao fica, sem
// mensagens, para nao se perder trabalho feito nele).
async function mergeInto(fromId: string, toId: string, workspaceId: string) {
  const toLead = await prisma.lead.findFirst({ where: { contactId: toId, status: 'OPEN', workspaceId }, select: { id: true } });
  if (!toLead) {
    // O contacto real nao tem lead aberto: os leads do LID passam para ele.
    await prisma.lead.updateMany({ where: { contactId: fromId, workspaceId }, data: { contactId: toId } });
  }
  const moved = await prisma.message.updateMany({
    where: { contactId: fromId },
    data: { contactId: toId, ...(toLead ? { leadId: toLead.id } : {}) },
  });
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

// Contacto ja conhecido por este LID (numero real ja revelado antes).
export function contactByLid(workspaceId: string, lid: string) {
  return prisma.contact.findFirst({ where: { workspaceId, whatsappLid: lid } });
}
