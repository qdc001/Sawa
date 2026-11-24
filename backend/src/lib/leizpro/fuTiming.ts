// Quando mandar o follow-up de uma etapa (guia v31, "Follow-ups por etapa").
//
// Olha para os tiques do WhatsApp da ultima mensagem nossa:
//  - ✓✓ azuis (viu e nao respondeu): 1.o follow-up 3 a 4 horas depois (ou no
//    dia seguinte, se ja for noite); 2.o no dia seguinte; 3.o dois dias depois.
//  - ✓✓ cinzentos (entregue, nao viu): nada no mesmo dia. Ao fim de 24 horas sem
//    ver, so o 1.o follow-up, a outra hora do dia. Se ao fim de 48 horas ainda
//    nao viu, uma ultima tentativa no dia seguinte e parar.
//  - ✓ um so tique (nao entregue): nada. O tempo conta a partir dos dois tiques.
//  - Nunca ficam azuis (confirmacao de leitura desligada): "viu" ao fim de 24 horas.
// Envia so das 12h as 13h ou das 18h as 20h (hora de Maputo), nunca depois das 21h.
// Maximo 3 por etapa; depois, a Reactivacao 2 a 3 semanas depois.
//
// Sem base de dados: o agendador e os testes usam exactamente esta funcao.

const OFFSET_MS = 2 * 3600_000; // Maputo = UTC+2
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// Janelas de envio, em hora de Maputo: [inicio, fim).
export const SEND_WINDOWS: Array<[number, number]> = [[12, 13], [18, 20]];
export const REACTIVATION_DAYS = 16; // "2 a 3 semanas depois"

function localHour(d: Date): number {
  const l = new Date(d.getTime() + OFFSET_MS);
  return l.getUTCHours() + l.getUTCMinutes() / 60;
}

function windowOf(d: Date): number | null {
  const h = localHour(d);
  const i = SEND_WINDOWS.findIndex(([a, b]) => h >= a && h < b);
  return i < 0 ? null : i;
}

// Primeiro momento >= t dentro de uma janela de envio. avoid: indice de janela
// a evitar ("a outra hora do dia").
export function nextSendTime(t: Date, avoid: number | null = null): Date {
  const l = new Date(t.getTime() + OFFSET_MS);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate();
  for (let day = 0; day < 4; day++) {
    for (let i = 0; i < SEND_WINDOWS.length; i++) {
      if (i === avoid) continue;
      const [a, b] = SEND_WINDOWS[i];
      const start = new Date(Date.UTC(y, m, d + day, a) - OFFSET_MS);
      const end = new Date(Date.UTC(y, m, d + day, b) - OFFSET_MS);
      if (t.getTime() < start.getTime()) return start;
      if (t.getTime() < end.getTime()) return t;
    }
  }
  return t; // nao chega aqui
}

// Mesmo dia + n, a partir das 12h ("no dia seguinte", "dois dias depois").
function dayStart(t: Date, plusDays: number): Date {
  const l = new Date(t.getTime() + OFFSET_MS);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + plusDays, 0) - OFFSET_MS);
}

// Guia v32: "anotar no CRM o dia que ele disser e mandar o 1.o follow-up nesse
// dia, a tarde". Le o dia da mensagem do estudante e devolve o inicio da janela
// das 12h desse dia (hora de Maputo). Sem dia concreto ("quando receber",
// "mais tarde"): null, e seguem-se as regras dos tiques.
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
export function payDayAt(text: string, now = new Date()): Date | null {
  const l = new Date(now.getTime() + OFFSET_MS);
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate(), wd = l.getUTCDay();
  let plus: number | null = null;
  let dayOfMonth: number | null = null;
  if (/\bdepois de amanha\b/.test(text)) plus = 2;
  else if (/\bamanha\b/.test(text)) plus = 1;
  else if (/\bhoje\b/.test(text)) plus = 0;
  else if (/\b(proxima semana|semana que vem|semana seguinte)\b/.test(text)) plus = ((8 - wd) % 7) || 7;
  else if (/\b(fim|final) do mes\b/.test(text)) dayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  else {
    const dm = text.match(/\bdia (\d{1,2})\b/);
    if (dm && +dm[1] >= 1 && +dm[1] <= 31) dayOfMonth = +dm[1];
    else {
      const i = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
      if (i >= 0) plus = ((i - wd + 7) % 7) || 7;
    }
  }
  let target: Date;
  if (plus !== null) target = new Date(Date.UTC(y, m, d + plus, 12) - OFFSET_MS);
  else if (dayOfMonth !== null) {
    const mm = dayOfMonth >= d ? m : m + 1;
    target = new Date(Date.UTC(y, mm, dayOfMonth, 12) - OFFSET_MS);
  } else return null;
  // Hoje e ja passou das 12h: a janela seguinte (18h); depois das 20h, amanha.
  return target.getTime() < now.getTime() ? nextSendTime(now) : target;
}

export type Ticks = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export type FuInput = {
  sent: number;                 // follow-ups desta etapa ja enviados (0..3; 4 = reactivacao feita)
  last: {                       // a ultima mensagem nossa (a pergunta da etapa ou o ultimo follow-up)
    status: Ticks;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
  };
  receiptsOff: boolean;         // o estudante responde mas as nossas mensagens nunca ficam azuis
};

export type FuDue = { at: Date; kind: 'fu' | 'last' | 'reactivation'; why: string } | null;

export function fuDue(x: FuInput): FuDue {
  const { last } = x;
  if (x.sent >= 4) return null;
  // ✓ um so tique (ou falhou): nao mandar nada.
  if (last.status !== 'DELIVERED' && last.status !== 'READ') return null;
  const delivered = last.deliveredAt || last.readAt || last.createdAt;
  const seenAt = last.status === 'READ'
    ? (last.readAt || delivered)
    : x.receiptsOff ? new Date(delivered.getTime() + DAY) : null;

  if (x.sent === 3) {
    return { at: nextSendTime(new Date(last.createdAt.getTime() + REACTIVATION_DAYS * DAY)), kind: 'reactivation', why: `reactivacao, ${REACTIVATION_DAYS} dias depois do ultimo follow-up` };
  }

  if (x.sent === 0) {
    if (seenAt) {
      return { at: nextSendTime(new Date(seenAt.getTime() + 3 * HOUR)), kind: 'fu', why: last.status === 'READ' ? 'viu (✓✓ azul) e nao respondeu: 3 a 4 horas depois' : 'confirmacao de leitura desligada: tratar como visto ao fim de 24 horas' };
    }
    // ✓✓ cinzento: 24 horas depois, a outra hora do dia.
    return { at: nextSendTime(new Date(delivered.getTime() + DAY), windowOf(last.createdAt)), kind: 'fu', why: 'nao viu (✓✓ cinzento): 1.o follow-up 24 horas depois, a outra hora do dia' };
  }

  // Do 2.o em diante, conta a partir do follow-up anterior (a ultima mensagem).
  if (!seenAt) {
    // Ainda nao viu ao fim de 48 horas: ultima tentativa no dia seguinte e parar.
    return { at: nextSendTime(dayStart(last.createdAt, 1), windowOf(last.createdAt)), kind: 'last', why: 'continua sem ver (✓✓ cinzento): ultima tentativa e parar' };
  }
  if (x.sent === 1) return { at: nextSendTime(dayStart(last.createdAt, 1)), kind: 'fu', why: '2.o follow-up, no dia seguinte' };
  return { at: nextSendTime(dayStart(last.createdAt, 2)), kind: 'fu', why: '3.o follow-up (fecho da etapa), dois dias depois' };
}
