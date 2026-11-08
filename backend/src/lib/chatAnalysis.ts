// Analise de conversas: detecta possiveis problemas com regras simples
// (sem IA), para a equipa saber onde actuar primeiro. Funcao pura, testavel.
//
// Sinais detectados:
//  - unanswered : cliente a espera de resposta (ultima mensagem e dele)
//  - insistence : cliente insistiu varias vezes / "alo?", "estao ai?"
//  - complaint  : palavras de reclamacao/insatisfacao nas mensagens do cliente
//  - promise    : a equipa prometeu algo ("em breve", "amanha") e passou tempo
//  - slow       : respostas lentas ao longo da conversa
//  - no_owner   : conversa com problema mas sem responsavel

import { computeResponseTimes, isAcknowledgement, BusinessHours } from './responseTimes';

export type IssueType = 'unanswered' | 'insistence' | 'complaint' | 'promise' | 'slow' | 'no_owner';

export type ChatMsg = {
  direction: 'INBOUND' | 'OUTBOUND';
  content: string | null;
  type: string | null;
  createdAt: Date;
  reactions?: unknown;
};

export type Issue = { type: IssueType; severity: 1 | 2 | 3; label: string; detail: string };

export type Analysis = {
  issues: Issue[];
  score: number;
  waitingHours: number | null;
};

const H = 3600 * 1000;

const COMPLAINT_RE = new RegExp(
  [
    'reclam', 'pessim', 'p[ée]ssim', 'horr[ií]vel', 'inaceit', 'absurd', 'vergonh', 'queixa', 'insatisf',
    'atrasad', 'atraso', 'demor', 'ningu[ée]m (responde|atende)', 'n[ãa]o (me )?(responde|respondem|atende|atendem)',
    'n[ãa]o recebi', 'ainda n[ãa]o (recebi|chegou)', 'n[ãa]o chegou', 'n[ãa]o funciona', 'n[ãa]o consigo',
    'reembols', 'devolu', 'cancel', 'enganad', 'burl', 'mentira', 'prometeram', 'prometeu', 'j[áa] pagu',
    'estou (a espera|à espera|esperando)', 'at[ée] quando', 'm[áa] qualidade', 'erro', 'problema',
  ].join('|'),
  'i',
);
const STRONG_COMPLAINT_RE = /reclam|pessim|p[ée]ssim|horr[ií]vel|inaceit|absurd|vergonh|queixa|reembols|enganad|burl|mentira|cancel/i;
const CHASER_RE = /(\?\?+|\bal[oô]+\b|est[ãa]o a[ií]|estas a[ií]|est[áa] a[ií]|\bol[áa]\?|ningu[ée]m|bom dia\?|boa tarde\?|boa noite\?|\bresposta\b)/i;
const PROMISE_RE = /em breve|amanh[ãa]|vou (enviar|mandar|ver|verificar|responder)|irei|ir[áa] receber|envio (hoje|amanh)|j[áa] (envio|mando)|logo que|assim que|aguarde|retorno|daqui a (pouco|instantes)|at[ée] (hoje|amanh|ao fim)/i;

function norm(s: string | null | undefined) {
  return (s || '').trim();
}

function reactedByTeam(reactions: unknown): boolean {
  return Object.values((reactions as Record<string, string[]>) || {})
    .some((ids) => Array.isArray(ids) && ids.some((id) => id !== 'contact'));
}

function fmtH(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} dias`;
}

export function analyzeConversation(
  msgsIn: ChatMsg[],
  now: Date,
  opts: { hasOwner: boolean; bh?: BusinessHours; offset?: number },
): Analysis {
  const msgs = [...msgsIn].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const issues: Issue[] = [];
  let waitingHours: number | null = null;
  if (msgs.length === 0) return { issues, score: 0, waitingHours };

  // --- Espera actual: bloco final de mensagens do cliente sem resposta ---
  let runStart = msgs.length;
  while (runStart > 0 && msgs[runStart - 1].direction === 'INBOUND') runStart--;
  const run = msgs.slice(runStart); // mensagens do cliente depois da ultima nossa
  const realRun = run.filter((m) => !isAcknowledgement(m.content, m.type));
  const answeredByReaction = run.some((m) => reactedByTeam(m.reactions));
  if (realRun.length > 0 && !answeredByReaction) {
    waitingHours = (now.getTime() - realRun[0].createdAt.getTime()) / H;
    if (waitingHours >= 2) {
      const sev: 1 | 2 | 3 = waitingHours >= 24 ? 3 : waitingHours >= 8 ? 2 : 1;
      issues.push({
        type: 'unanswered', severity: sev,
        label: 'Sem resposta',
        detail: `Cliente à espera há ${fmtH(waitingHours)}.`,
      });
    }
    // Insistencia
    const chasers = realRun.filter((m) => CHASER_RE.test(norm(m.content)));
    if (realRun.length >= 3 || chasers.length > 0) {
      issues.push({
        type: 'insistence', severity: realRun.length >= 4 || chasers.length >= 2 ? 3 : 2,
        label: 'Cliente a insistir',
        detail: `${realRun.length} mensagens seguidas sem resposta${chasers.length ? ` (ex.: "${norm(chasers[0].content).slice(0, 40)}")` : ''}.`,
      });
    }
  }

  // --- Reclamacoes: ultimas 72h de mensagens do cliente ---
  const recentCut = now.getTime() - 72 * H;
  const complaints = msgs.filter((m) => m.direction === 'INBOUND' && m.createdAt.getTime() >= recentCut && COMPLAINT_RE.test(norm(m.content)));
  if (complaints.length > 0) {
    const strong = complaints.some((m) => STRONG_COMPLAINT_RE.test(norm(m.content)));
    const sample = norm(complaints[complaints.length - 1].content).replace(/\s+/g, ' ').slice(0, 70);
    issues.push({
      type: 'complaint', severity: strong || complaints.length >= 3 ? 3 : 2,
      label: 'Possível reclamação',
      detail: `${complaints.length} mensagem(ns) com sinais de insatisfação (ex.: "${sample}").`,
    });
  }

  // --- Promessa da equipa por cumprir ---
  const lastOut = [...msgs].reverse().find((m) => m.direction === 'OUTBOUND');
  // A ultima mensagem nossa e a que fica por cumprir: se uma mensagem posterior
  // nossa (ex.: o ficheiro prometido) existisse, seria ela a ultima.
  if (lastOut && PROMISE_RE.test(norm(lastOut.content))) {
    const age = (now.getTime() - lastOut.createdAt.getTime()) / H;
    if (age >= 36) {
      issues.push({
        type: 'promise', severity: age >= 72 ? 3 : 2,
        label: 'Promessa por cumprir',
        detail: `Última mensagem nossa prometia algo ("${norm(lastOut.content).replace(/\s+/g, ' ').slice(0, 60)}") há ${fmtH(age)}, sem seguimento.`,
      });
    }
  }

  // --- Respostas lentas ao longo da conversa ---
  const bh: BusinessHours = opts.bh || { enabled: false, startHour: 8, endHour: 17, weekdaysOnly: true };
  const { perUser } = computeResponseTimes(
    msgs.map((m) => ({
      contactId: 'c', assigneeId: 'a', direction: m.direction, sentById: null, createdAt: m.createdAt,
      content: m.content, type: m.type, reactionTimes: undefined,
    })),
    { from: msgs[0].createdAt, to: now, bh, offset: opts.offset ?? 2 * H, capMs: 72 * H },
  );
  const samples = perUser.get('a') || [];
  if (samples.length >= 2) {
    const avgH = samples.reduce((s, x) => s + x, 0) / samples.length / H;
    if (avgH >= 8) {
      issues.push({
        type: 'slow', severity: avgH >= 24 ? 3 : 2,
        label: 'Respostas lentas',
        detail: `Demoramos em média ${fmtH(avgH)} a responder nesta conversa (${samples.length} respostas).`,
      });
    }
  }

  // --- Sem responsavel (so relevante se ja ha um problema) ---
  if (!opts.hasOwner && issues.length > 0) {
    issues.push({ type: 'no_owner', severity: 2, label: 'Sem responsável', detail: 'Ninguém é responsável por este contacto.' });
  }

  const score = issues.reduce((s, i) => s + i.severity * (i.type === 'no_owner' ? 1 : 2), 0);
  return { issues, score, waitingHours };
}
