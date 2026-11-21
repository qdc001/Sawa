// Leiz Pro: segue o Guia de Atendimento da Zona Nerd passo a passo.
//
// Diferenca para a Leizy: a Leizy pede a um LLM externo para escrever a
// resposta. A Leiz Pro usa um modelo local (Ollama) so para PERCEBER a mensagem;
// o texto enviado e sempre o do guia, preenchido pelo codigo. Assim nao ha
// precos ou promessas inventadas e nada sai do servidor. A assistente
// apresenta-se ao estudante como "Sherone" (ver guide.ts).
//
// Activa so nos workspaces cujo dono tem um email em LEIZPRO_OWNER_EMAILS
// (por defeito znerd@gmail.com). Reaproveita tudo o resto da IA Vendedora:
// AiSalesSuggestion, aprovacao no Inbox, modo supervisionado/automatico.
//
// Estado por contacto: guardado no actionPayload.leizpro da ultima sugestao
// da Leiz Pro que nao foi descartada. Descartar uma sugestao volta ao estado
// anterior (util para "nao, continua"); o reset de contexto da IA recomeca.
//
// Robustez (respostas que nao respondem ao que foi perguntado):
//  - Diagnostico por "campos em falta": pergunta so o que ainda nao sabe,
//    aceita os dados por qualquer ordem e todos de uma vez.
//  - Correccoes ("afinal e UP") substituem o valor anterior.
//  - Resposta vaga: repete a pergunta uma vez; a segunda vez passa a equipa.
//  - A mesma objeccao duas vezes seguidas: passa a equipa (evita lacos).
//  - Audio/imagem: pede para escrever uma vez; depois passa a equipa.

import prisma from '../prisma';
import { T, AVAILABLE_SUBJECTS, type TemplateKey } from './guide';
import { understand, monthsUntil, recommendPackage, LEIZPRO_MODEL, type Understanding, type Slot } from './understand';

// Igual a AI_RESET_MARKER do aiSalesAgent (copiado para evitar import circular).
const AI_RESET_MARKER = '__AI_CONTEXT_RESET__';

export type Step =
  | 'start' | 'diagnosis' | 'connection' | 'ask_online' | 'ask_commitment' | 'ask_budget'
  | 'ask_exam_date' | 'packages_sent' | 'free_trial' | 'handoff';

export type LeizProState = {
  step: Step;
  name: string | null;
  university: string | null;
  course: string | null;
  subjects: string[];
  missingSubjects: string[];
  examMonth: number | null;
  examMonthsAhead: number | null;
  lastKey: TemplateKey | null;      // ultima mensagem enviada (para detectar lacos de objeccoes)
  lastQuestion: TemplateKey | null; // ultima pergunta do fluxo (para a repetir se a resposta nao responder)
  retries: number;                  // respostas vagas seguidas no passo actual
};

export const INITIAL_STATE: LeizProState = {
  step: 'start', name: null, university: null, course: null, subjects: [], missingSubjects: [],
  examMonth: null, examMonthsAhead: null, lastKey: null, lastQuestion: null, retries: 0,
};

// Objeccoes que nao avancam a conversa (e que, repetidas, passam a equipa).
const OBJECTION_KEYS: TemplateKey[] = [
  'accessProblem', 'linkProblem', 'presencial', 'expensive', 'paymentSafe', 'willIPass', 'tooBasic',
  'schedule', 'weakPhone', 'shareAccount', 'oneMonth', 'nonText',
];

// ---- Activacao --------------------------------------------------------------
const OWNER_EMAILS = (process.env.LEIZPRO_OWNER_EMAILS || 'znerd@gmail.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
let wsCache: { at: number; ids: Set<string> } | null = null;

export async function isLeizProWorkspace(workspaceId: string): Promise<boolean> {
  if (!wsCache || Date.now() - wsCache.at > 5 * 60_000) {
    const users = await prisma.user.findMany({
      where: { email: { in: OWNER_EMAILS, mode: 'insensitive' } },
      select: { workspaceId: true },
    });
    wsCache = { at: Date.now(), ids: new Set(users.map((u) => u.workspaceId).filter(Boolean) as string[]) };
  }
  return wsCache.ids.has(workspaceId);
}

// ---- Texto ------------------------------------------------------------------
function firstName(name: string | null): string | null {
  return name ? name.split(/\s+/)[0] : null;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function fill(parts: readonly string[], st: LeizProState, vars: Record<string, string> = {}): string[] {
  const nome = firstName(st.name);
  return parts.map((p) => {
    let s = p;
    if (nome) s = s.replace(/\[NOME\]/g, nome);
    else s = s.replace(/,\s*\[NOME\]/g, '').replace(/\s*\[NOME\]/g, '');
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  });
}

// Bloqueia mensagens com campos por preencher ("O que NUNCA dizer" do guia).
export function hasPlaceholders(parts: string[]): boolean {
  return parts.some((p) => /\[[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{3,}\]|\{[a-z_]+\}/.test(p));
}

// ---- Decisao ----------------------------------------------------------------
export type Decision = {
  action: 'send_text' | 'handoff';
  parts: string[];
  next: LeizProState;
  reason: string;
};

function vars(st: LeizProState): Record<string, string> {
  return {
    universidade: st.university || '',
    curso: st.course || '',
    disponiveis: joinList(st.subjects),
    em_falta: joinList(st.missingSubjects),
  };
}

function say(key: TemplateKey, st: LeizProState, nextStep: Step, reason: string, extra: Record<string, string> = {}): Decision {
  const advanced = nextStep !== st.step;
  return {
    action: 'send_text',
    parts: fill(T[key], st, { ...vars(st), ...extra }),
    next: {
      ...st,
      step: nextStep,
      lastKey: key,
      lastQuestion: OBJECTION_KEYS.includes(key) ? st.lastQuestion : key,
      retries: advanced ? 0 : st.retries,
    },
    reason,
  };
}

function handoff(st: LeizProState, reason: string): Decision {
  return {
    action: 'handoff',
    parts: [`Leiz Pro passou a conversa para a equipa: ${reason}`, ...fill(T.handoffDraft, st)],
    next: { ...st, step: 'handoff', retries: 0 },
    reason,
  };
}

// Repete a ultima pergunta (ultima parte da ultima mensagem) uma vez.
function repeatOrHandoff(st: LeizProState, why: string): Decision {
  if (st.retries >= 1 || !st.lastQuestion) {
    return handoff(st, `${why} (depois de repetir a pergunta)`);
  }
  const question = fill(T[st.lastQuestion], st, vars(st)).slice(-1);
  return {
    action: 'send_text',
    parts: [...fill(T.repeatPrefix, st), ...question],
    next: { ...st, lastKey: 'repeatPrefix', retries: st.retries + 1 },
    reason: `${why}: repetir a pergunta`,
  };
}

function examMonths(st: LeizProState): number | null {
  if (st.examMonthsAhead !== null) return st.examMonthsAhead;
  if (st.examMonth !== null) return monthsUntil(st.examMonth);
  return null;
}

function packagesDecision(st: LeizProState, reason: string): Decision {
  if (!st.subjects.length) return handoff(st, `${reason}, mas ainda nao sabemos as disciplinas`);
  const months = examMonths(st);
  if (months === null) {
    return say('askExamDate', st, 'ask_exam_date', `${reason}; falta a data do exame para calcular`);
  }
  const rec = recommendPackage(st.subjects.length, months);
  return say('packages', st, 'packages_sent', `${reason}; recomendado Pacote ${rec.pkg} (${rec.total} MZN, ${months} meses)`, { recomendacao: rec.text });
}

// Proxima pergunta do diagnostico (Passos 1.1 a 1.4), so do que falta.
// "Prazer, Elton!" so na primeira vez que sabemos o nome (nao a cada pergunta).
function diagnosisNext(st: LeizProState, reason: string, newName = true): Decision {
  const d = diagnosisQuestion(st, reason);
  if (!newName && d.action === 'send_text' && d.parts.length > 1 && /^Prazer/.test(d.parts[0])) {
    d.parts = d.parts.slice(1);
  }
  return d;
}

function diagnosisQuestion(st: LeizProState, reason: string): Decision {
  if (!st.name && !st.university) return say('askNameAgain', st, 'diagnosis', `${reason}; falta nome e universidade`);
  if (!st.name) return say('askNameOnly', st, 'diagnosis', `${reason}; falta o nome`);
  if (!st.university && !st.course) return say('askUniCourse', st, 'diagnosis', `${reason}; falta universidade e curso`);
  if (!st.university) return say('askUniOnly', st, 'diagnosis', `${reason}; falta a universidade`);
  if (!st.course) return say('askCourse', st, 'diagnosis', `${reason}; falta o curso (Passo 1.3)`);
  if (!st.subjects.length && !st.missingSubjects.length) return say('askSubjects', st, 'diagnosis', `${reason}; faltam as disciplinas (Passo 1.4)`);
  if (!st.subjects.length) {
    return handoff(st, `as disciplinas pedidas nao estao na Zona Nerd (${joinList(st.missingSubjects)}): ser honesto e nao insistir`);
  }
  return say('connection', st, 'connection', `${reason}; diagnostico completo, conexao (Passo 1.4.1)`);
}

// Respostas do Fluxo 5 que valem em qualquer passo (a conversa fica no mesmo passo).
function objection(u: Understanding, st: LeizProState): Decision | null {
  const map: Partial<Record<Understanding['intent'], [TemplateKey, string]>> = {
    problema_acesso: ['accessProblem', 'problema de acesso (conta/e-mail/codigo)'],
    problema_link: ['linkProblem', 'o link nao abre'],
    prefere_presencial: ['presencial', 'objeccao: prefere presencial'],
    acha_caro: ['expensive', 'objeccao: acha caro'],
    pagamento_seguro: ['paymentSafe', 'pergunta se o pagamento e seguro'],
    vai_passar: ['willIPass', 'pergunta se vai passar'],
    muito_basico: ['tooBasic', 'acha o capitulo 1 basico'],
    horario_apoio: ['schedule', 'pergunta por horarios/assistencia'],
    telemovel_fraco: ['weakPhone', 'telemovel fraco / internet cara'],
    partilhar_conta: ['shareAccount', 'quer partilhar a conta'],
    um_mes: ['oneMonth', 'quer so 1 mes'],
    sem_texto: ['nonText', 'mandou audio/imagem em vez de escrever'],
  };
  if (u.intent === 'ja_pagou') return handoff(st, 'o estudante diz que ja pagou (validar o comprovativo)');
  if (u.intent === 'quer_pagar') return handoff(st, 'o estudante quer pagar (numeros de pagamento ainda por confirmar no guia)');
  if (u.intent === 'sem_dinheiro') return handoff(st, 'o estudante diz que nao tem condicoes agora (marcar contacto com dia e hora)');
  if (u.intent === 'duvida') return handoff(st, 'pergunta sobre o conteudo/funcionamento que o guia nao cobre');
  if (u.intent === 'desconfianca') return handoff(st, 'o estudante desconfia (burla/golpe): resposta tem de ser de uma pessoa da equipa');
  const hit = map[u.intent];
  if (!hit) return null;
  const [key, reason] = hit;
  // A mesma objeccao duas vezes seguidas: o texto do guia nao resolveu.
  if (st.lastKey === key) return handoff(st, `${reason}, repetido depois da resposta do guia`);
  // Mantem o passo; a proxima resposta "sim/nao" volta a ser lida no passo actual.
  return say(key, st, st.step, reason);
}

function merge(stIn: LeizProState, u: Understanding): LeizProState {
  // Valores novos substituem os antigos (o estudante pode corrigir: "afinal e UP").
  // Excepcao: o nome so muda se ainda nao o tinhamos, para uma frase solta
  // nao trocar o nome do estudante.
  return {
    ...stIn,
    name: stIn.name || u.name,
    university: u.university || stIn.university,
    course: u.course || stIn.course,
    subjects: u.subjects.length || u.missingSubjects.length ? u.subjects : stIn.subjects,
    missingSubjects: u.subjects.length || u.missingSubjects.length ? u.missingSubjects : stIn.missingSubjects,
    examMonth: u.examMonth ?? (u.examMonthsAhead !== null ? null : stIn.examMonth),
    examMonthsAhead: u.examMonthsAhead ?? (u.examMonth !== null ? null : stIn.examMonthsAhead),
  };
}

export function decide(stIn: LeizProState, u: Understanding, rawText = ''): Decision {
  const st = merge(stIn, u);
  const text = rawText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const gotData = u.intent === 'da_dados';

  // Primeira mensagem (gatilho do anuncio ou qualquer outra).
  if (st.step === 'start') {
    if (u.intent === 'pergunta_preco') return say('priceFirst', st, 'diagnosis', 'primeiro contacto a perguntar o preco (Passo 1.2)');
    // Ja veio com dados ("Ola, sou o Elton, vou fazer UEM"): salta a saudacao.
    if (st.name) return diagnosisNext(st, 'primeira mensagem ja com dados', true);
    const obj = objection(u, st);
    if (obj && obj.action === 'handoff') return obj;
    return say('greeting', st, 'diagnosis', 'primeiro contacto (Passo 1.1)');
  }

  const obj = objection(u, st);
  if (obj) return obj;

  // "So quero 1 mes" -> "O mais curto e o A. Queres comecar por esse?" -> "sim"
  if (st.lastKey === 'oneMonth' && u.intent === 'sim') {
    return handoff(st, 'aceitou o Pacote A (2 meses, 390 MZN): orientar o pagamento');
  }

  // Pergunta o preco: antes do diagnostico completo explica que depende (1.2);
  // depois, o guia manda passar logo aos pacotes (1.5.4).
  if (u.intent === 'pergunta_preco') {
    if (st.step === 'diagnosis') {
      if (st.lastKey === 'priceFirst' || st.lastQuestion === 'priceFirst') return repeatOrHandoff(st, 'insiste no preco antes do diagnostico');
      return say('priceFirst', st, 'diagnosis', 'pergunta o preco antes do diagnostico (Passo 1.2)');
    }
    return packagesDecision(st, 'pediu os valores (Passo 1.5.4)');
  }

  switch (st.step) {
    case 'diagnosis': {
      if (u.intent === 'nao_sei' && st.lastQuestion === 'askSubjects') {
        return { ...handoff(st, 'nao sabe as disciplinas do exame: a equipa confirma (Passo 1.4)'), parts: [
          'Leiz Pro passou a conversa para a equipa: nao sabe as disciplinas do exame, confirmar e responder.',
          ...fill(T.subjectsUnknown, st, vars(st)),
        ] };
      }
      const progressed = gotData && (
        st.name !== stIn.name || st.university !== stIn.university || st.course !== stIn.course
        || st.subjects.join() !== stIn.subjects.join() || st.missingSubjects.join() !== stIn.missingSubjects.join()
      );
      if (!progressed) return repeatOrHandoff(st, `resposta nao trouxe o que foi perguntado (intencao ${u.intent})`);
      return diagnosisNext(st, 'dados recebidos', !stIn.name && !!st.name);
    }

    case 'connection': {
      // Qualquer resposta serve (o guia so quer deixa-lo falar). Segue para a vacina.
      if (st.missingSubjects.length) {
        // 1.6 e depois, do 1.5.1, so as linhas sobre os estudos e a pergunta do online.
        const a = fill(T.missingSubject, st, vars(st));
        const b = fill(T.vaccineOnline, st, vars(st)).slice(2);
        return { action: 'send_text', parts: [...a, ...b], next: { ...st, step: 'ask_online', lastKey: 'vaccineOnline', lastQuestion: 'vaccineOnline', retries: 0 }, reason: 'Passo 1.6 + vacina do online (1.5.1)' };
      }
      const d = say('vaccineOnline', st, 'ask_online', 'vacina do online (Passo 1.5.1)');
      // "nada", "nao" ao "o que foi mais dificil?": nao faz sentido "muita gente passa por isso".
      if (u.intent === 'nao' || /^(nada|nenhum|nenhuma|nao|n)\b/.test(text)) {
        d.parts[0] = st.name ? `Óptimo, ${st.name.split(/\s+/)[0]}! 😊` : 'Óptimo! 😊';
      }
      return d;
    }

    case 'ask_online':
      if (u.intent === 'sim') return say('vaccineCommitment', st, 'ask_commitment', 'esta a vontade com o online: vacina do compromisso (Passo 1.5.2)');
      if (u.intent === 'nao') {
        if (st.lastKey === 'presencial') return handoff(st, 'continua hesitante com o estudo online');
        return { ...say('presencial', st, 'ask_online', 'hesita com o online: resposta do Fluxo 5 (presencial)') };
      }
      return repeatOrHandoff(st, `resposta vaga a "estas a vontade online?" (intencao ${u.intent})`);

    case 'ask_commitment':
      if (u.intent === 'sim') return say('vaccineBudget', st, 'ask_budget', 'comprometido: vacina do orcamento (Passo 1.5.3)');
      if (u.intent === 'nao') return say('freeTrial', st, 'free_trial', 'resposta hesitante ao compromisso: sugerir o capitulo 1 gratis (nao forcar)');
      return repeatOrHandoff(st, `resposta vaga ao compromisso (intencao ${u.intent})`);

    case 'ask_budget':
      if (u.intent === 'sim') return packagesDecision(st, 'orcamento ok (Passo 1.5.4)');
      if (u.intent === 'nao') return handoff(st, 'algo o faz esperar: perceber o motivo e marcar contacto com dia e hora');
      if (gotData && (st.examMonth !== null || st.examMonthsAhead !== null)) return packagesDecision(st, 'deu a data do exame');
      return repeatOrHandoff(st, `resposta vaga ao orcamento (intencao ${u.intent})`);

    case 'ask_exam_date':
      if (examMonths(st) !== null && (u.examMonth !== null || u.examMonthsAhead !== null)) return packagesDecision(st, 'data do exame recebida');
      if (u.intent === 'nao_sei') return handoff(st, 'nao sabe a data do exame (a equipa ajuda a confirmar e escolhe A/B ou C/D)');
      return repeatOrHandoff(st, `nao percebi a data do exame (intencao ${u.intent})`);

    case 'packages_sent':
      if (gotData && (u.examMonth !== null || u.examMonthsAhead !== null || u.subjects.length)) {
        return packagesDecision(st, 'mudou a data ou as disciplinas: recalcular');
      }
      return handoff(st, `resposta depois dos pacotes (intencao ${u.intent}): a equipa acompanha a escolha`);

    case 'free_trial':
      return handoff(st, `resposta depois do convite para o capitulo 1 gratis (intencao ${u.intent})`);

    case 'handoff':
      break;
  }

  return handoff(st, `mensagem fora do guia neste passo (${st.step}, intencao ${u.intent})`);
}

// ---- Estado -----------------------------------------------------------------
async function loadState(workspaceId: string, contactId: string): Promise<LeizProState> {
  const reset = await prisma.message.findFirst({
    where: { contactId, isInternal: true, content: AI_RESET_MARKER },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const last = await prisma.aiSalesSuggestion.findFirst({
    where: {
      workspaceId,
      contactId,
      modelUsed: { startsWith: 'leizpro' },
      status: { not: 'DISCARDED' },
      ...(reset ? { createdAt: { gt: reset.createdAt } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: { actionPayload: true },
  });
  const saved = (last?.actionPayload as any)?.leizpro;
  return saved && typeof saved === 'object' ? { ...INITIAL_STATE, ...saved } : { ...INITIAL_STATE };
}

// Mensagens do estudante desde a ultima resposta nossa (ele escreve em varias linhas).
async function pendingInboundText(contactId: string): Promise<string> {
  const lastOut = await prisma.message.findFirst({
    where: { contactId, direction: 'OUTBOUND', isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const inbound = await prisma.message.findMany({
    where: {
      contactId, direction: 'INBOUND', isInternal: false,
      ...(lastOut ? { createdAt: { gt: lastOut.createdAt } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
    select: { content: true, transcription: true, type: true },
  });
  return inbound
    .map((m) => m.content || m.transcription || (m.type !== 'TEXT' ? `[${m.type}]` : ''))
    .filter(Boolean)
    .join('\n');
}

// Uma volta completa (compreensao + decisao + verificacao). Exportada para o
// simulador de testes (scripts/leizProSimulate.ts) usar exactamente o mesmo caminho.
export async function runTurn(state: LeizProState, text: string) {
  const u = await understand(text, expectingFor(state), slotFor(state));
  let d = decide(state, u, text);
  if (d.action === 'send_text' && hasPlaceholders(d.parts)) {
    d = handoff(state, 'a resposta ficou com campos por preencher');
  }
  return { u, d };
}

function slotFor(st: LeizProState): Slot {
  if (st.step === 'diagnosis') {
    if (!st.name) return 'name';
    if (!st.university) return 'university';
    if (!st.course) return 'course';
    return 'subjects';
  }
  if (st.step === 'ask_exam_date') return 'date';
  return null;
}

function expectingFor(st: LeizProState): string {
  switch (st.step) {
    case 'start': return 'nada ainda (primeira mensagem)';
    case 'diagnosis': {
      if (!st.name) return 'o nome e a universidade do estudante';
      if (!st.university) return 'a universidade e o curso';
      if (!st.course) return 'o curso a que se vai candidatar';
      return 'as disciplinas do exame de admissao';
    }
    case 'connection': return 'se ja tentou estudar antes e o que foi mais dificil';
    case 'ask_online': return 'se esta a vontade para estudar online pelo telemovel (sim/nao)';
    case 'ask_commitment': return 'se esta comprometido a dar o melhor (sim/nao)';
    case 'ask_budget': return 'se consegue comecar ja caso os valores caibam no orcamento';
    case 'ask_exam_date': return 'quando e o exame (mes)';
    case 'packages_sent': return 'qual pacote escolhe';
    case 'free_trial': return 'o que achou do capitulo 1 gratis';
    default: return 'nada';
  }
}

// Gera a sugestao da Leiz Pro. Devolve o mesmo formato que generateSalesSuggestion
// para o maybeTriggerSalesSuggestion poder tratar igual (socket, modo auto).
export async function generateLeizProSuggestion(opts: {
  workspaceId: string;
  contactId: string;
  leadId?: string | null;
  triggerMessageId?: string | null;
}) {
  const state = await loadState(opts.workspaceId, opts.contactId);
  // Depois de passar para a equipa, a Leiz Pro fica calada nesta conversa ate
  // alguem descartar a passagem (volta ao estado anterior) ou fazer reset.
  if (state.step === 'handoff') return null;

  const text = await pendingInboundText(opts.contactId);
  if (!text.trim()) return null;

  const { u, d } = await runTurn(state, text);

  const reasoning = [
    d.reason,
    `Passo ${state.step} -> ${d.next.step}.`,
    `Intencao: ${u.intent} (${u.intentSource}).`,
    u.modelError ? `Modelo local indisponivel: ${u.modelError}.` : '',
  ].filter(Boolean).join(' ');

  const suggestion = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      triggerMessageId: opts.triggerMessageId || null,
      parts: d.parts as any,
      action: d.action,
      productId: null,
      productFileIds: [] as any,
      actionPayload: { leizpro: d.next, understood: { ...u } } as any,
      reasoning,
      principlesUsed: [] as any,
      modelUsed: `leizpro:${u.modelUsed || 'regras'}`,
      status: 'PENDING',
    },
  });
  return { suggestion, normalized: { action: d.action } };
}

export { LEIZPRO_MODEL, AVAILABLE_SUBJECTS };
