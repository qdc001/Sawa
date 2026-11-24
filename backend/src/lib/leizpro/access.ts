// Acesso activo (guia v34, Passo 4.2 e Fluxo 7).
//
// A equipa manda a mensagem de boas-vindas ("O teu acesso já está activo: tens
// todos os capítulos de [DISCIPLINAS] até [DATA DE FIM]"). Dela saem a data de
// inicio (quando foi enviada), a data de fim e as disciplinas. A Sherone manda
// depois:
//  - a meio do acesso (15.o dia no pacote de 1 mes, 30.o no de 2 meses);
//  - 3 dias antes do fim (renovacao);
//  - no ultimo dia, se ele nao respondeu a renovacao.
// Envia na janela das 12h desse dia (ou na seguinte, se ja passou).
//
// Sem base de dados: o agendador e os testes usam exactamente estas funcoes.

import { nextSendTime } from './fuTiming';

const OFFSET_MS = 2 * 3600_000; // Maputo = UTC+2
const DAY = 86_400_000;

export type Access = {
  start: string;            // ISO: quando a equipa mandou as boas-vindas
  end: string;              // ISO: 12h (Maputo) do ultimo dia do acesso
  subjects: string | null;  // "Biologia e Química"
  mid: boolean;             // mensagem a meio ja enviada
  renew: number;            // 0, 1 (3 dias antes) ou 2 (ultimo dia)
  renewAt?: string;         // quando saiu a 1.a de renovacao
};

export const WELCOME_RE = /acesso j[aá] est[aá] (activo|ativo)/i;

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function strip(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// 12h (Maputo) do dia y-m-d.
function noon(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d, 12) - OFFSET_MS);
}

function localParts(t: Date) {
  const l = new Date(t.getTime() + OFFSET_MS);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate() };
}

// "ate 24/12", "ate 24/12/2026", "ate 24 de dezembro (de 2026)", "ate dia 24 de dezembro".
export function parseEndDate(text: string, sentAt: Date): Date | null {
  const s = strip(text);
  const after = s.split(/\bate\b/).slice(1).join(' ate ');
  if (!after) return null;
  const now = localParts(sentAt);
  let d: number, m: number, y: number | null = null;
  const num = after.match(/^\s*(?:o\s+)?(?:dia\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  const words = after.match(/^\s*(?:o\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/);
  if (num) { d = +num[1]; m = +num[2] - 1; if (num[3]) y = +num[3] < 100 ? 2000 + +num[3] : +num[3]; }
  else if (words) {
    m = MONTHS.indexOf(words[2]);
    if (m < 0) return null;
    d = +words[1]; if (words[3]) y = +words[3];
  } else return null;
  if (d < 1 || d > 31 || m < 0 || m > 11) return null;
  if (y === null) {
    y = now.y;
    if (noon(y, m, d).getTime() < sentAt.getTime() - DAY) y += 1; // "ate 5 de janeiro" dito em dezembro
  }
  return noon(y, m, d);
}

// "todos os capitulos de Biologia e Quimica ate ..." -> "Biologia e Química"
export function parseSubjects(text: string): string | null {
  const m = text.match(/cap[ií]tulos d[eao]s?\s+(.+?)\s+at[eé](?=\s|$)/i);
  if (!m) return null;
  const v = m[1].trim().replace(/[.,;:]+$/, '');
  return v && v.length <= 120 && !/[[\]{}]/.test(v) ? v : null;
}

// Boas-vindas da equipa -> acesso. Sem data de fim na mensagem, usa a duracao
// do pacote escolhido (1 ou 2 meses); sem ela, null.
export function parseWelcome(text: string, sentAt: Date, months: 1 | 2 | null, fallbackSubjects: string | null): Access | null {
  if (!WELCOME_RE.test(text)) return null;
  let end = parseEndDate(text, sentAt);
  if (!end && months) {
    const p = localParts(sentAt);
    end = noon(p.y, p.m, p.d + 30 * months);
  }
  if (!end || end.getTime() <= sentAt.getTime()) return null;
  return { start: sentAt.toISOString(), end: end.toISOString(), subjects: parseSubjects(text) || fallbackSubjects, mid: false, renew: 0 };
}

export type AccessKey = 'accessMid' | 'renew1' | 'renew2';

// Proxima mensagem do acompanhamento e quando sai (null = nada a mandar).
// repliedAfterRenew: o estudante escreveu depois da 1.a de renovacao.
export function accessDue(a: Access, repliedAfterRenew: boolean): { key: AccessKey; at: Date } | null {
  const start = new Date(a.start), end = new Date(a.end);
  const e = localParts(end);
  const renew1Day = noon(e.y, e.m, e.d - 3);
  if (a.renew === 0) {
    if (!a.mid) {
      // Metade do acesso: 15.o dia (1 mes) ou 30.o (2 meses).
      const days = Math.round((end.getTime() - start.getTime()) / DAY);
      const s = localParts(start);
      const midDay = noon(s.y, s.m, s.d + Math.round(days / 2));
      if (midDay.getTime() < renew1Day.getTime() - DAY) return { key: 'accessMid', at: nextSendTime(midDay) };
    }
    return { key: 'renew1', at: nextSendTime(renew1Day) };
  }
  if (a.renew === 1 && !repliedAfterRenew) return { key: 'renew2', at: nextSendTime(end) };
  return null;
}

// Mensagem que ja nao faz sentido mandar (o dia passou).
export function accessStale(key: AccessKey, at: Date, a: Access, now = new Date()): boolean {
  const end = new Date(a.end).getTime();
  if (key === 'renew2') return now.getTime() > end + 12 * 3600_000; // so no proprio ultimo dia
  if (key === 'renew1') return now.getTime() > end;
  return now.getTime() > at.getTime() + 3 * DAY; // a meio: ate 3 dias de atraso
}

// "faltam X dias" para a nota da equipa.
export function daysLeft(a: Access, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(a.end).getTime() - now.getTime()) / DAY));
}
