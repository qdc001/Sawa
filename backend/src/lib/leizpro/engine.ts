// Leiz Pro: segue o Guia de Atendimento da Zona Nerd (v21) passo a passo.
//
// A Leiz Pro usa um modelo local (Ollama) so para PERCEBER a mensagem; o texto
// enviado e sempre o do guia, preenchido pelo codigo. Nada sai do servidor e
// nao ha precos ou promessas inventadas. Apresenta-se como "Sherone".
//
// Objectivo da conversa (v21): diagnostico curto, vacinas e marcar uma chamada
// de 10 minutos (Passo 1.5.3). Quando o estudante escolhe a hora, a sugestao
// cria a chamada na Agenda do Klaru (accao book_appointment). A chamada em si
// e feita por uma pessoa da equipa.
//
// Activa so nos workspaces cujo dono tem um email em LEIZPRO_OWNER_EMAILS
// (por defeito znerd@gmail.com). Reaproveita a IA Vendedora: AiSalesSuggestion,
// aprovacao no Inbox, modo supervisionado/automatico.
//
// Estado por contacto: em actionPayload.leizpro da ultima sugestao da Leiz Pro
// que nao foi descartada. Descartar volta ao estado anterior; o reset de
// contexto da IA recomeca a conversa.
//
// Robustez: pergunta so o que falta e aceita dados por qualquer ordem; as
// correccoes substituem o valor antigo; resposta vaga repete a pergunta uma
// vez e a segunda passa a equipa; a mesma objeccao duas vezes passa a equipa;
// tudo o que o guia ainda marca como [CONFIRMAR] passa a equipa.

import prisma from '../prisma';
import { T, SUPER_NERD_PRICES, AVAILABLE_SUBJECTS, type TemplateKey } from './guide';
import { loadTexts, type Texts } from './texts';
import { understand, LEIZPRO_MODEL, type Understanding, type Slot as AskSlot } from './understand';
import { proposeSlots, parseTimeChoice, slotLabel, type Slot } from './schedule';

// Textos em uso nesta volta (guia + edicoes do painel). Definido em runTurn
// antes de decide(), que e sincrono, por isso nao ha mistura entre conversas.
let CUR: Texts = T;

// Igual a AI_RESET_MARKER do aiSalesAgent (copiado para evitar import circular).
const AI_RESET_MARKER = '__AI_CONTEXT_RESET__';

export type Step =
  | 'start' | 'diagnosis' | 'connection' | 'ask_online' | 'ask_commitment' | 'ask_call_time'
  | 'call_booked' | 'by_text' | 'sn_choice' | 'sn_activate' | 'sn_paying' | 'handoff';

export type LeizProState = {
  step: Step;
  name: string | null;
  university: string | null;
  course: string | null;
  difficulty: string | null;     // o que contou no Passo 1.4 (vai para as notas da chamada)
  offered: Slot[] | null;        // horas propostas para a chamada
  callAt: string | null;         // chamada marcada (ISO)
  snCount: number | null;
  snMonths: 1 | 2 | null;
  snReturn: Step | null;         // passo a retomar depois de dizer o valor do Super Nerd
  snReturnQ: TemplateKey | null; // e a pergunta desse passo
  paidOnce: boolean;
  lastKey: TemplateKey | null;      // ultima mensagem enviada (para detectar lacos de objeccoes)
  lastQuestion: TemplateKey | null; // ultima pergunta do fluxo (para a repetir)
  retries: number;
};

export const INITIAL_STATE: LeizProState = {
  step: 'start', name: null, university: null, course: null, difficulty: null, offered: null, callAt: null,
  snCount: null, snMonths: null, snReturn: null, snReturnQ: null, paidOnce: false, lastKey: null, lastQuestion: null, retries: 0,
};

// Mensagens que respondem a algo e nao avancam o fluxo.
const OBJECTION_KEYS: TemplateKey[] = [
  'expensive', 'paymentSafe', 'friendReferral', 'coversExam', 'willIPass', 'noUniversity', 'weakPhone',
  'shareAccount', 'payOtherPerson', 'accessProblem', 'linkProblem', 'presencial', 'schedule', 'tooBasic',
  'nonText', 'noMoney', 'paidInfo',
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
  return parts.some((p) => /\[[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{3,}\]|\{[a-z_0-9]+\}/.test(p));
}

// ---- Decisao ----------------------------------------------------------------
export type Appointment = { title: string; startsAtISO: string; durationMin: number; notes: string };

export type Decision = {
  action: 'send_text' | 'handoff' | 'book_appointment' | 'wait';
  parts: string[];
  next: LeizProState;
  reason: string;
  appointment?: Appointment;
};

function vars(st: LeizProState): Record<string, string> {
  return {
    universidade: st.university || '',
    curso: st.course || '',
    opcao1: st.offered?.[0]?.label || '',
    opcao2: st.offered?.[1]?.label || '',
  };
}

function say(key: TemplateKey, st: LeizProState, nextStep: Step, reason: string, extra: Record<string, string> = {}): Decision {
  const advanced = nextStep !== st.step;
  return {
    action: 'send_text',
    parts: fill(CUR[key], st, { ...vars(st), ...extra }),
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
    parts: [`Leiz Pro passou a conversa para a equipa: ${reason}`, ...fill(CUR.handoffDraft, st)],
    next: { ...st, step: 'handoff', retries: 0 },
    reason,
  };
}

// Ultima parte (a pergunta) da ultima pergunta do fluxo, ja preenchida.
function lastQuestionText(st: LeizProState): string | null {
  if (!st.lastQuestion) return null;
  const parts = fill(CUR[st.lastQuestion], st, vars(st));
  return parts[parts.length - 1] || null;
}

// Repete a ultima pergunta uma vez; a segunda passa a equipa.
function repeatOrHandoff(st: LeizProState, why: string): Decision {
  const q = lastQuestionText(st);
  if (st.retries >= 1 || !q) return handoff(st, `${why} (depois de repetir a pergunta)`);
  return {
    action: 'send_text',
    parts: [...fill(CUR.repeatPrefix, st), q],
    next: { ...st, lastKey: 'repeatPrefix', retries: st.retries + 1 },
    reason: `${why}: repetir a pergunta`,
  };
}

// Junta a uma resposta a pergunta do passo em que o estudante esta, para a
// conversa continuar (ex.: responde ao "esta caro" e volta a pergunta do online).
function withResume(d: Decision, st: LeizProState): Decision {
  const resumable: Step[] = ['diagnosis', 'connection', 'ask_online', 'ask_commitment', 'ask_call_time'];
  if (!resumable.includes(st.step)) return d;
  const q = lastQuestionText(st);
  if (q && !d.parts.includes(q)) d.parts = [...d.parts, q];
  return d;
}

// ---- Chamada ------------------------------------------------------------------
function withSlots(st: LeizProState): LeizProState {
  return { ...st, offered: proposeSlots() };
}

function inviteCall(st: LeizProState, key: 'callInvite' | 'hesitant', reason: string): Decision {
  const s2 = withSlots(st);
  return say(key, s2, 'ask_call_time', reason);
}

function bookCall(st: LeizProState, at: Date, reason: string): Decision {
  const quando = slotLabel(at);
  const d = say('callConfirm', st, 'call_booked', reason, { quando });
  const who = [st.name || 'Estudante'];
  const notes = [
    st.course || st.university ? `Curso: ${st.course || '?'}${st.university ? ` na ${st.university}` : ''}.` : '',
    st.difficulty ? `Dificuldade que contou: "${st.difficulty.slice(0, 200)}".` : '',
    'Marcada pela Sherone (Leiz Pro). Guião: Passo 1.5.4 do guia.',
  ].filter(Boolean).join(' ');
  return {
    ...d,
    action: 'book_appointment',
    next: { ...d.next, callAt: at.toISOString(), offered: null },
    appointment: { title: `Chamada Zona Nerd: ${who.join(' ')}`, startsAtISO: at.toISOString(), durationMin: 15, notes },
  };
}

// ---- Modo Super Nerd ------------------------------------------------------------
function snLabel(count: number): string { return count === 1 ? '1 disciplina' : `${count} disciplinas`; }

function superNerd(st: LeizProState, reason: string): Decision {
  const entering = st.step !== 'sn_choice';
  const base: LeizProState = {
    ...st,
    snReturn: entering ? st.step : st.snReturn,
    snReturnQ: entering ? st.lastQuestion : st.snReturnQ,
  };
  if (!base.snCount || !base.snMonths) {
    if (base.snCount && base.snCount >= 3) {
      return handoff(base, `quer o modo Super Nerd com ${base.snCount} disciplinas (valor das disciplinas extra por confirmar no guia)`);
    }
    if (st.step === 'sn_choice') {
      // Ja perguntamos; pedir so o que falta.
      if (!base.snCount && base.snMonths) {
        return { ...say('snAskCount', base, 'sn_choice', `${reason}: falta o numero de disciplinas`) };
      }
      if (base.snCount && !base.snMonths) {
        return { ...say('snAskMonths', base, 'sn_choice', `${reason}: falta a duracao`) };
      }
      return repeatOrHandoff(base, `${reason}: nao percebi quantas disciplinas e quanto tempo`);
    }
    return say('superNerdAsk', base, 'sn_choice', `${reason} (Passo 3.1)`);
  }
  if (base.snCount >= 3) {
    return handoff(base, `quer o modo Super Nerd com ${base.snCount} disciplinas (valor das disciplinas extra por confirmar no guia)`);
  }
  const valor = SUPER_NERD_PRICES[base.snCount as 1 | 2][base.snMonths];
  const price = fill(CUR.superNerdPrice, base, {
    disciplinas: snLabel(base.snCount), duracao: base.snMonths === 1 ? '1 mês' : '2 meses', valor: String(valor),
  });
  const why = `${reason}: modo Super Nerd ${base.snCount} disc. ${base.snMonths} mes(es) = ${valor} MZN (Passo 3.1.1)`;
  // Com chamada marcada (ou depois): oferece explicar como activar.
  if (base.callAt || !base.snReturn || ['call_booked', 'by_text', 'sn_activate', 'sn_paying'].includes(base.snReturn)) {
    return {
      action: 'send_text',
      parts: [...price, ...fill(CUR.superNerdActivateQ, base)],
      next: { ...base, step: 'sn_activate', lastKey: 'superNerdActivateQ', lastQuestion: 'superNerdActivateQ', retries: 0 },
      reason: why,
    };
  }
  // Antes da chamada: o guia manda voltar a conta gratis e ao fluxo.
  const back: LeizProState = { ...base, step: base.snReturn, lastQuestion: base.snReturnQ };
  const q = lastQuestionText(back);
  return {
    action: 'send_text',
    parts: [...price, ...fill(CUR.priceBackToFree, base), ...(q ? [q] : [])],
    next: { ...back, lastKey: 'superNerdPrice', retries: 0 },
    reason: `${why}; volta ao passo ${base.snReturn}`,
  };
}

// ---- Diagnostico (Passos 1.1 a 1.3) ---------------------------------------------
// "Prazer, Elton!" so na primeira vez que sabemos o nome.
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
  return say('connection', st, 'connection', `${reason}; diagnostico completo, conexao (Passo 1.4)`);
}

// ---- Situacoes comuns (Fluxo 5) -------------------------------------------------
function objection(u: Understanding, st: LeizProState): Decision | null {
  switch (u.intent) {
    case 'desconfianca': return handoff(st, 'o estudante desconfia (burla/golpe): resposta tem de ser de uma pessoa da equipa');
    case 'duvida': return handoff(st, 'pergunta sobre o conteudo/funcionamento que o guia nao cobre');
    case 'problema_codigo': return handoff(st, 'problema com e-mail/codigo/palavra-passe (como se cria a conta ainda esta por confirmar no guia)');
    case 'instalar_app': return handoff(st, 'quer instalar a app (link do APK ainda por confirmar no guia)');
    case 'vidas': return handoff(st, 'pergunta sobre as vidas (como se gastam e enchem ainda esta por confirmar no guia)');
    case 'nao_abriu': return handoff(st, 'diz que pagou e o modo Super Nerd nao abriu: verificar no painel (Passo 4.3)');
    case 'ja_pagou':
      if (st.paidOnce || st.lastKey === 'paidInfo') return handoff(st, 'volta a falar do pagamento: verificar no painel (Passo 4.3)');
      return { ...say('paidInfo', st, st.step, 'diz que ja pagou (Passo 4.1)'), next: { ...st, paidOnce: true, lastKey: 'paidInfo' } };
    case 'quer_pagar': return say('paymentInApp', st, 'sn_paying', 'quer activar/pagar o modo Super Nerd (Passo 3.2)');
    case 'sem_chamada':
      if (st.callAt || st.step === 'by_text') return handoff(st, 'nao pode falar por chamada: continuar por mensagens');
      return say('noCall', st, 'by_text', 'nao pode falar por chamada: criar a conta por mensagens (Passo 1.5.6)');
  }
  const map: Partial<Record<Understanding['intent'], [TemplateKey, string]>> = {
    acha_caro: ['expensive', 'objeccao: acha caro'],
    pagamento_seguro: ['paymentSafe', 'pergunta se o pagamento e seguro'],
    indicar_amigo: ['friendReferral', 'conhece alguem que quer tambem'],
    cobre_exame: ['coversExam', 'pergunta se o conteudo cobre o exame'],
    vai_passar: ['willIPass', 'pergunta se vai passar'],
    universidade_fora: ['noUniversity', 'nao ve a universidade dele'],
    telemovel_fraco: ['weakPhone', 'telemovel fraco / internet cara'],
    partilhar_conta: ['shareAccount', 'quer partilhar a conta'],
    pagar_outra_pessoa: ['payOtherPerson', 'pagar com M-Pesa de outra pessoa'],
    problema_acesso: ['accessProblem', 'nao consegue entrar/criar conta'],
    problema_link: ['linkProblem', 'o link nao abre'],
    horario_apoio: ['schedule', 'pergunta por horarios/assistencia'],
    muito_basico: ['tooBasic', 'acha a amostra basica'],
    sem_texto: ['nonText', 'mandou audio/imagem em vez de escrever'],
  };
  if (u.intent === 'sem_dinheiro') {
    if (st.lastKey === 'noMoney') return handoff(st, 'volta a dizer que nao tem condicoes: marcar contacto com dia e hora');
    const base = fill(CUR.noMoney, st);
    const socials = fill(CUR.socials, st);
    if (st.callAt) {
      return { action: 'send_text', parts: [...base, ...socials], next: { ...st, lastKey: 'noMoney' }, reason: 'nao tem condicoes (chamada ja marcada): o gratis + redes' };
    }
    const s2 = withSlots(st);
    const q = `Já criaste a tua conta? Se quiseres, ligo-te ${s2.offered![0].label} e fazemos juntos.`;
    return {
      action: 'send_text',
      parts: [...base, ...socials, q],
      next: { ...s2, step: 'ask_call_time', lastKey: 'noMoney', lastQuestion: 'callInvite', retries: 0 },
      reason: 'nao tem condicoes: o gratis, as redes e convite para a chamada (Fluxo 5)',
    };
  }
  if (u.intent === 'prefere_presencial') {
    if (st.lastKey === 'presencial') return handoff(st, 'continua a preferir presencial depois da resposta do guia');
    const parts = fill(CUR.presencial, st);
    if (st.step === 'ask_online' || st.callAt || st.step === 'handoff') {
      return withResume({ action: 'send_text', parts, next: { ...st, lastKey: 'presencial' }, reason: 'objeccao: prefere presencial' }, st);
    }
    // Noutros passos o guia termina com o convite para a chamada.
    const s2 = withSlots(st);
    return {
      action: 'send_text',
      parts: [...parts, `Para veres como é na prática, ligo-te uns 10 minutos e criamos juntos a tua conta grátis. Pode ser ${s2.offered![0].label} ou preferes ${s2.offered![1].label}?`],
      next: { ...s2, step: 'ask_call_time', lastKey: 'presencial', lastQuestion: 'callInvite', retries: 0 },
      reason: 'objeccao: prefere presencial, convite para a chamada',
    };
  }
  const hit = map[u.intent];
  if (!hit) return null;
  const [key, reason] = hit;
  if (st.lastKey === key) return handoff(st, `${reason}, repetido depois da resposta do guia`);
  return withResume(say(key, st, st.step, reason), st);
}

function merge(stIn: LeizProState, u: Understanding): LeizProState {
  const snTalk = stIn.step === 'sn_choice' || u.intent === 'super_nerd' || u.intent === 'pergunta_preco';
  return {
    ...stIn,
    name: stIn.name || u.name,
    university: u.university || stIn.university,
    course: u.course || stIn.course,
    // So conta quando se esta a falar do modo Super Nerd (senao "Biologia" como
    // curso contava como "1 disciplina").
    snCount: snTalk ? (u.snCount ?? stIn.snCount) : stIn.snCount,
    snMonths: snTalk ? (u.snMonths ?? stIn.snMonths) : stIn.snMonths,
  };
}

export function decide(stIn: LeizProState, u: Understanding, rawText = ''): Decision {
  const st = merge(stIn, u);
  const text = rawText.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const gotData = u.intent === 'da_dados';
  // "ok obrigado", "combinado, obrigada!", "👍": nao e preciso responder.
  const THANKS = new Set(['ok', 'okay', 'okk', 'obrigado', 'obrigada', 'obg', 'ta', 'esta', 'bem', 'combinado', 'beleza', 'blz',
    'certo', 'perfeito', 'fixe', 'sim', 'muito', 'entendido', 'percebido', 'tudo', 'bom', 'boa', 'valeu']);
  const words = text.replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const isThanks = (words.length > 0 && words.length <= 5 && words.every((w) => THANKS.has(w)))
    || (words.length === 0 && /[👍🙏✅]/u.test(rawText));

  // Primeira mensagem (gatilho do anuncio ou qualquer outra).
  if (st.step === 'start') {
    if (u.intent === 'pergunta_preco' || u.intent === 'super_nerd') return say('priceFirst', st, 'diagnosis', 'primeiro contacto a perguntar o preco (Passo 1.2)');
    if (st.name) return diagnosisNext(st, 'primeira mensagem ja com dados', true);
    const obj = objection(u, st);
    if (obj && obj.action === 'handoff') return obj;
    return say('greeting', st, 'diagnosis', 'primeiro contacto (Passo 1.1)');
  }

  // Modo Super Nerd: a escolher quantas disciplinas e quanto tempo.
  if (st.step === 'sn_choice' && (gotData || u.snCount || u.snMonths || /^\d$/.test(text))) {
    const s2 = { ...st };
    if (!s2.snCount && /^\d$/.test(text)) s2.snCount = Number(text);
    return superNerd(s2, 'escolheu disciplinas/duracao');
  }

  const obj = objection(u, st);
  if (obj) return obj;

  // "Nao percebi": repete a ultima pergunta com outra introducao (uma vez).
  if (u.intent === 'nao_percebi') {
    const q = lastQuestionText(st);
    if (st.retries >= 1 || !q) return handoff(st, 'nao percebeu a pergunta, mesmo depois de a repetir');
    return {
      action: 'send_text',
      parts: [...fill(CUR.clarifyPrefix, st), ...fill(CUR[st.lastQuestion!], st, vars(st)).slice(-1)],
      next: { ...st, lastKey: 'clarifyPrefix', retries: st.retries + 1 },
      reason: 'nao percebeu: repetir a pergunta',
    };
  }

  // Preco / modo Super Nerd. Antes do diagnostico, a primeira vez explica o
  // gratis (1.2); se insistir, diz o valor para o caso dele (3.1 / 3.1.1).
  if (u.intent === 'pergunta_preco' || u.intent === 'super_nerd') {
    if (st.step === 'diagnosis' && st.lastKey !== 'priceFirst' && u.intent === 'pergunta_preco') {
      return say('priceFirst', st, 'diagnosis', 'pergunta o preco antes do diagnostico (Passo 1.2)');
    }
    return superNerd(st, 'pergunta pelo preco / modo Super Nerd');
  }

  switch (st.step) {
    case 'diagnosis': {
      const progressed = gotData && (st.name !== stIn.name || st.university !== stIn.university || st.course !== stIn.course);
      if (!progressed) return repeatOrHandoff(st, `resposta nao trouxe o que foi perguntado (intencao ${u.intent})`);
      return diagnosisNext(st, 'dados recebidos', !stIn.name && !!st.name);
    }

    case 'connection': {
      // Qualquer resposta serve: o guia so quer deixa-lo falar. Guarda a
      // dificuldade para as notas da chamada.
      const s2 = { ...st, difficulty: rawText.trim().slice(0, 300) || null };
      const d = say('vaccineOnline', s2, 'ask_online', 'vacina do online (Passo 1.5.1)');
      if (u.intent === 'nao' || /^(nada|nenhum|nenhuma|nao|n)\b/.test(text)) {
        d.parts[0] = s2.name ? `Óptimo, ${firstName(s2.name)}! 😊` : 'Óptimo! 😊';
      }
      return d;
    }

    case 'ask_online':
      if (u.intent === 'sim') return say('vaccineCommitment', st, 'ask_commitment', 'esta a vontade com o online: vacina do compromisso (Passo 1.5.2)');
      if (u.intent === 'nao') {
        if (st.lastKey === 'presencial') return handoff(st, 'continua hesitante com o estudo online');
        return withResume({ action: 'send_text', parts: fill(CUR.presencial, st), next: { ...st, lastKey: 'presencial' }, reason: 'hesita com o online: resposta do Fluxo 5 (presencial)' }, st);
      }
      return repeatOrHandoff(st, `resposta vaga a "estas a vontade online?" (intencao ${u.intent})`);

    case 'ask_commitment':
      if (u.intent === 'sim') return inviteCall(st, 'callInvite', 'comprometido: convite para a chamada (Passo 1.5.3)');
      if (u.intent === 'nao') return inviteCall(st, 'hesitant', 'resposta hesitante ao compromisso: amostra sem conta e marcar contacto');
      return repeatOrHandoff(st, `resposta vaga ao compromisso (intencao ${u.intent})`);

    case 'ask_call_time': {
      const refuses = /\b(nao (posso|da|consigo|vou poder)|ocupad|outra hora|outro dia|mais tarde)/.test(text);
      const choice = refuses && !/\d/.test(text) ? { kind: 'none' as const } : parseTimeChoice(rawText, st.offered);
      if (choice.kind === 'slot') return bookCall(st, choice.at, 'escolheu a hora da chamada (Passo 1.5.3)');
      if (choice.kind === 'out_of_hours' || choice.kind === 'day_only') {
        if (st.lastKey === 'callAskHour') return handoff(st, 'nao conseguimos acertar a hora da chamada');
        return say('callAskHour', { ...st, offered: null }, 'ask_call_time', 'hora fora do horario ou sem hora concreta');
      }
      if (u.intent === 'nao' || refuses) {
        if (st.lastKey === 'callOtherTime') return handoff(st, 'nao conseguimos acertar a hora da chamada');
        return say('callOtherTime', { ...st, offered: null }, 'ask_call_time', 'pede outra hora (Passo 1.5.6)');
      }
      return repeatOrHandoff(st, `nao percebi a hora da chamada (intencao ${u.intent})`);
    }

    case 'call_booked':
      if (isThanks) return { action: 'wait', parts: [], next: st, reason: 'agradeceu/confirmou depois de marcar a chamada: nao e preciso responder' };
      return handoff(st, `mensagem depois de marcada a chamada (${st.callAt ? slotLabel(new Date(st.callAt)) : ''}): a equipa responde`);

    case 'sn_activate':
      if (u.intent === 'sim') return say('paymentInApp', st, 'sn_paying', 'quer activar o modo Super Nerd (Passo 3.2)');
      if (u.intent === 'nao') return { action: 'wait', parts: [], next: { ...st, step: st.callAt ? 'call_booked' : 'by_text' }, reason: 'nao quer activar agora: o modo Super Nerd e opcional' };
      return repeatOrHandoff(st, `resposta vaga a "queres que explique como activar?" (intencao ${u.intent})`);

    case 'sn_paying':
      if (isThanks) return { action: 'wait', parts: [], next: st, reason: 'confirmou: espera o pagamento na app' };
      return handoff(st, `mensagem durante o pagamento do modo Super Nerd (intencao ${u.intent})`);

    case 'by_text':
      return handoff(st, 'a conversa continua por mensagens (criar a conta): a equipa acompanha');

    case 'sn_choice':
      return superNerd(st, 'resposta ao modo Super Nerd');

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
  if (!saved || typeof saved !== 'object') return { ...INITIAL_STATE };
  // Estados do guia v20 (pacotes, data do exame) ja nao existem: recomeca o
  // diagnostico mantendo o que ja sabiamos.
  const known: Step[] = ['start', 'diagnosis', 'connection', 'ask_online', 'ask_commitment', 'ask_call_time',
    'call_booked', 'by_text', 'sn_choice', 'sn_activate', 'sn_paying', 'handoff'];
  const st = { ...INITIAL_STATE, ...saved } as LeizProState;
  if (!known.includes(st.step)) st.step = 'diagnosis';
  if (st.lastKey && !(st.lastKey in T)) st.lastKey = null;
  if (st.lastQuestion && !(st.lastQuestion in T)) st.lastQuestion = null;
  return st;
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

function slotFor(st: LeizProState): AskSlot {
  if (st.step === 'diagnosis') {
    if (!st.name) return 'name';
    if (!st.university) return 'university';
    if (!st.course) return 'course';
  }
  return null;
}

function expectingFor(st: LeizProState): string {
  switch (st.step) {
    case 'start': return 'nada ainda (primeira mensagem)';
    case 'diagnosis': {
      if (!st.name) return 'o nome e a universidade do estudante';
      if (!st.university) return 'a universidade e o curso';
      return 'o curso a que se vai candidatar';
    }
    case 'connection': return 'se ja tentou estudar antes e o que foi mais dificil';
    case 'ask_online': return 'se esta a vontade para estudar online pelo telemovel (sim/nao)';
    case 'ask_commitment': return 'se esta comprometido a dar o melhor (sim/nao)';
    case 'ask_call_time': return 'a que horas pode receber uma chamada de 10 minutos';
    case 'sn_choice': return 'quantas disciplinas e por quanto tempo (1 ou 2 meses) quer o modo Super Nerd';
    case 'sn_activate': return 'se quer que expliquem como activar o modo Super Nerd (sim/nao)';
    default: return 'nada';
  }
}

// Uma volta completa (compreensao + decisao + verificacao). Exportada para o
// simulador de testes (scripts/leizProSimulate.ts) usar exactamente o mesmo caminho.
export async function runTurn(state: LeizProState, text: string, workspaceId?: string) {
  const u = await understand(text, expectingFor(state), slotFor(state));
  CUR = workspaceId ? await loadTexts(workspaceId) : T;
  let d = decide(state, u, text);
  if ((d.action === 'send_text' || d.action === 'book_appointment') && hasPlaceholders(d.parts)) {
    d = handoff(state, 'a resposta ficou com campos por preencher');
  }
  return { u, d };
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

  const { u, d } = await runTurn(state, text, opts.workspaceId);

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
      // book_appointment le title/startsAtISO/durationMin/notes do topo do payload.
      actionPayload: { ...(d.appointment || {}), leizpro: d.next, understood: { ...u } } as any,
      reasoning,
      principlesUsed: [] as any,
      modelUsed: `leizpro:${u.modelUsed || 'regras'}`,
      status: 'PENDING',
    },
  });
  return { suggestion, normalized: { action: d.action } };
}

export { LEIZPRO_MODEL, AVAILABLE_SUBJECTS };
