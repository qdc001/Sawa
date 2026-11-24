// Horas da chamada (Passo 1.5.3 do guia v21).
//
// A Sherone propoe duas horas concretas ("hoje as 15h ou amanha as 18h"),
// dentro do horario da equipa (8h-20h, todos os dias), e percebe a escolha do
// estudante ("a primeira", "amanha", "as 17h", "sexta as 10"). Tudo em hora de
// Maputo (UTC+2, sem hora de verao), independente do fuso do servidor.

import { CALL_HOURS } from './guide';
import { norm } from './understand';

const OFFSET_MS = 2 * 3600_000; // Maputo = UTC+2

export type Slot = { iso: string; label: string }; // label: "hoje às 15h"

// Data "de Maputo" representada num Date em UTC (getUTC* = hora de Maputo).
function toLocal(d: Date): Date { return new Date(d.getTime() + OFFSET_MS); }
function fromLocal(y: number, m: number, day: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, day, h, min) - OFFSET_MS);
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function slotLabel(at: Date, now = new Date()): string {
  const a = toLocal(at);
  const n = toLocal(now);
  const dayDiff = Math.round((Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
    - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86_400_000);
  const hh = a.getUTCMinutes() ? `${a.getUTCHours()}h${String(a.getUTCMinutes()).padStart(2, '0')}` : `${a.getUTCHours()}h`;
  const day = dayDiff === 0 ? 'hoje' : dayDiff === 1 ? 'amanhã' : `${WEEKDAYS[a.getUTCDay()]}`;
  return `${day} às ${hh}`;
}

// Duas propostas: a hora livre mais proxima hoje (pelo menos 1h a frente) e
// amanha a mesma hora; se hoje ja nao da, amanha as 9h e as 18h.
export function proposeSlots(now = new Date(), notToday = false): [Slot, Slot] {
  const n = toLocal(now);
  let h = n.getUTCHours() + (n.getUTCMinutes() > 0 ? 2 : 1);
  const lastStart = CALL_HOURS.to - 1; // ultima chamada comeca as 19h
  const y = n.getUTCFullYear(), m = n.getUTCMonth(), d = n.getUTCDate();
  let first: Date;
  let second: Date;
  if (h < CALL_HOURS.from) h = CALL_HOURS.from;
  if (h <= lastStart && !notToday) {
    first = fromLocal(y, m, d, h);
    second = fromLocal(y, m, d + 1, Math.min(Math.max(h, 9), 18));
  } else {
    first = fromLocal(y, m, d + 1, 9);
    second = fromLocal(y, m, d + 1, 18);
  }
  return [
    { iso: first.toISOString(), label: slotLabel(first, now) },
    { iso: second.toISOString(), label: slotLabel(second, now) },
  ];
}

export type TimeChoice =
  | { kind: 'slot'; at: Date }          // hora concreta dentro do horario
  | { kind: 'out_of_hours'; at: Date }  // hora concreta fora das 8h-20h
  | { kind: 'day_only' }                // "amanha", sem hora
  | { kind: 'none' };

// Le a escolha do estudante, depois de lhe propormos `offered`.
export function parseTimeChoice(text: string, offered: Slot[] | null, now = new Date()): TimeChoice {
  const t = norm(text).replace(/\s+/g, ' ').trim();
  const n = toLocal(now);

  // "a primeira", "a segunda", "pode ser" / "sim" -> a primeira proposta
  if (offered && offered.length === 2) {
    if (/\b(a primeira|primeira opcao|o primeiro|a 1a|opcao 1)\b/.test(t)) return { kind: 'slot', at: new Date(offered[0].iso) };
    if (/\b(a segunda|segunda opcao|o segundo|a 2a|opcao 2)\b/.test(t)) return { kind: 'slot', at: new Date(offered[1].iso) };
  }

  // Dia
  let dayOffset: number | null = null;
  if (/\bdepois de amanha\b/.test(t)) dayOffset = 2;
  else if (/\bamanha\b/.test(t)) dayOffset = 1;
  else if (/\bhoje\b|\bagora\b|\bja\b/.test(t)) dayOffset = 0;
  else {
    const wd = [/\bdomingo\b/, /\bsegunda\b/, /\bterca\b/, /\bquarta\b/, /\bquinta\b/, /\bsexta\b/, /\bsabado\b/]
      .findIndex((re) => re.test(t));
    if (wd >= 0) dayOffset = ((wd - n.getUTCDay()) + 7) % 7 || 7;
  }

  // Hora: "15h", "15:30", "as 3 da tarde", "as 10", "18 horas"
  let hour: number | null = null;
  let minute = 0;
  const hm = t.match(/\b(\d{1,2})\s*(?:h|:|horas?)\s*(\d{2})?\b/) || t.match(/\bas (\d{1,2})\b/);
  if (hm) {
    hour = Number(hm[1]);
    minute = hm[2] ? Number(hm[2]) : 0;
    if (/\b(da tarde|a tarde|de tarde|da noite|a noite|de noite)\b/.test(t) && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) hour = null;
  }

  // So "sim"/"pode ser"/"ok" a uma proposta: fica a primeira.
  if (hour === null && dayOffset === null && offered && /^(sim|pode ser|ok|okay|combinado|esta bem|pode|claro|bora|yes|yeah|ya|serve|perfeito|ta bem|certo)\b/.test(t)) {
    return { kind: 'slot', at: new Date(offered[0].iso) };
  }

  if (hour === null) {
    // Periodo do dia ("de manha", "a tarde", "a noite"), sem hora.
    const period = /\b(de manha|pela manha|manha)\b/.test(t) ? [8, 12]
      : /\b(a tarde|de tarde|da tarde|pela tarde|tarde)\b/.test(t) ? [12, 18]
      : /\b(a noite|de noite|da noite|noite)\b/.test(t) ? [18, 20] : null;
    // Dia sem hora: se coincide com o dia (e o periodo) de uma proposta, usa essa.
    if (dayOffset !== null && offered) {
      for (const s of offered) {
        const lbl = s.label;
        const sh = toLocal(new Date(s.iso)).getUTCHours();
        const dayOk = (dayOffset === 0 && lbl.startsWith('hoje')) || (dayOffset === 1 && lbl.startsWith('amanhã'));
        if (dayOk && (!period || (sh >= period[0] && sh < period[1]))) {
          return { kind: 'slot', at: new Date(s.iso) };
        }
      }
    }
    if (period && dayOffset === null) return { kind: 'day_only' };
    return dayOffset !== null ? { kind: 'day_only' } : { kind: 'none' };
  }

  // Hora sem dia: hoje se ainda da (pelo menos 15 min a frente), senao amanha.
  if (dayOffset === null) {
    const today = fromLocal(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), hour, minute);
    dayOffset = today.getTime() >= now.getTime() + 15 * 60_000 ? 0 : 1;
  }
  const at = fromLocal(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + dayOffset, hour, minute);
  // Hora ja passada ou daqui a menos de 15 min: pedir outra hora.
  if (at.getTime() < now.getTime() + 15 * 60_000) return { kind: 'day_only' };
  const inHours = hour >= CALL_HOURS.from && (hour < CALL_HOURS.to || (hour === CALL_HOURS.to && minute === 0)) && hour < CALL_HOURS.to;
  return inHours ? { kind: 'slot', at } : { kind: 'out_of_hours', at };
}

// Dia combinado no envio dos pacotes (Passo 1.5.3): amanha as 18h, para o
// estudante ver com calma. A regua de follow-up (Fluxo 6) conta a partir dai.
export function decisionSlot(now = new Date()): Slot {
  const n = toLocal(now);
  const at = fromLocal(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 18);
  return { iso: at.toISOString(), label: slotLabel(at, now) };
}
