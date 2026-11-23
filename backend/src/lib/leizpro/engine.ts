// Leiz Pro: segue o Guia de Atendimento da Zona Nerd (v26) passo a passo.
//
// A Leiz Pro usa um modelo local (Ollama) so para PERCEBER a mensagem; o texto
// enviado e sempre o do guia, preenchido pelo codigo. Nada sai do servidor e
// nao ha precos ou promessas inventadas. Apresenta-se como "Sherone".
//
// Fluxo v26: diagnostico curto (nome, universidade, curso), conexao, vacinas do
// online e do compromisso, PDF dos pacotes (1.5.3), ajudar a criar a conta
// (1.5.4), conta criada (1.5.5: capitulo 1 + convites + proximo contacto) e,
// quando o estudante escolhe um pacote, os canais de pagamento (3.2). Quem
// paga pelo WhatsApp e validado pela equipa (a Leiz Pro avisa-a).
//
// O PDF dos pacotes vem do catalogo do Klaru: um Produto activo cujo nome tem
// "pacote" (ex.: "Pacotes Zona Nerd") com o PDF anexado. Sem esse produto, os
// pacotes vao em texto.
//
// Activa so nos workspaces cujo dono tem um email em LEIZPRO_OWNER_EMAILS
// (por defeito znerd@gmail.com). Estado por contacto: em actionPayload.leizpro
// da ultima sugestao da Leiz Pro que nao foi descartada.

import prisma from '../prisma';
import {
  T, PDF_MARK, SUPER_NERD_PRICES, EXTRA_SUBJECT_PRICE, PACKAGES, AVAILABLE_SUBJECTS, type TemplateKey,
} from './guide';
import { loadTexts, type Texts } from './texts';
import { understand, norm, LEIZPRO_MODEL, type Understanding, type Slot as AskSlot } from './understand';
import { examSubjects, examOptions, findCourseIn } from './courses';
import { syncStage } from './pipeline';
import { proposeSlots, decisionSlot, parseTimeChoice, slotLabel, type Slot } from './schedule';

// Textos em uso nesta volta (guia + edicoes do painel). Definido em runTurn
// antes de decide(), que e sincrono, por isso nao ha mistura entre conversas.
let CUR: Texts = T;

// Igual a AI_RESET_MARKER do aiSalesAgent (copiado para evitar import circular).
const AI_RESET_MARKER = '__AI_CONTEXT_RESET__';

export type Step =
  | 'start' | 'diagnosis' | 'connection' | 'ask_online' | 'ask_commitment'
  | 'pdf_sent'        // recebeu os pacotes (ou a amostra, se hesitou)
  | 'account_help'    // a criar a conta por mensagem (1.5.4)
  | 'followup'        // conta criada, a experimentar o capitulo 1
  | 'sn_choice'       // a escolher disciplinas/duracao do modo Super Nerd
  | 'sn_activate'     // "queres que te explique como activar?"
  | 'paying'          // recebeu os canais de pagamento
  | 'handoff';

export type LeizProState = {
  step: Step;
  name: string | null;
  university: string | null;
  course: string | null;
  difficulty: string | null;     // o que contou no Passo 1.4
  hardSubject: string | null;    // disciplina em que tem mais dificuldade (para o capitulo 1)
  offered: Slot[] | null;        // hora proposta para o proximo contacto
  snCount: number | null;
  snMonths: 1 | 2 | null;
  snReturn: Step | null;
  snReturnQ: TemplateKey | null;
  pkg: string | null;            // pacote escolhido (ex.: "Pacote D")
  // Regua de follow-up (Fluxo 6): dia combinado e quantos contactos ja foram.
  regua: { startAt: string; sent: number } | null;
  // Follow-up de pagamento: quando sai (1 dia depois dos canais) e se ja saiu.
  payFollow: { at: string; sent: boolean; skip?: boolean } | null; // skip: disse quando paga (sem follow-up)
  paidOnce: boolean;
  lastKey: TemplateKey | null;
  lastQuestion: TemplateKey | null;
  retries: number;
};

export const INITIAL_STATE: LeizProState = {
  step: 'start', name: null, university: null, course: null, difficulty: null, hardSubject: null, offered: null,
  snCount: null, snMonths: null, snReturn: null, snReturnQ: null, pkg: null, regua: null, payFollow: null, paidOnce: false,
  lastKey: null, lastQuestion: null, retries: 0,
};

// Mensagens que respondem a algo e nao avancam o fluxo.
const OBJECTION_KEYS: TemplateKey[] = [
  'isFree', 'whyAsk', 'expensive', 'paymentSafe', 'friendReferral', 'coversExam', 'willIPass', 'noUniversity',
  'weakPhone', 'shareAccount', 'payOtherPerson', 'lives', 'accessProblem', 'emailCode', 'forgotPassword',
  'changeSubjects', 'linkProblem', 'presencial', 'howOnline', 'schedule', 'tooBasic', 'nonText', 'noMoney',
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

// Todos os workspaces com a Leiz Pro (para tarefas periodicas).
export async function leizProWorkspaceIds(): Promise<string[]> {
  await isLeizProWorkspace('');
  return [...wsCache!.ids];
}

// Mensagem de gatilho do anuncio: "Ola! Vi o anuncio da Zona Nerd e gostaria
// de saber como fazer parte." (aceita pequenas variacoes).
export function isTriggerText(text: string): boolean {
  const t = norm(text);
  return /vi o anuncio/.test(t) || (/zona nerd/.test(t) && /fazer parte/.test(t));
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
    // "na Instituto Industrial" -> "no Instituto Industrial"
    s = s.replace(/\bna (Instituto|Centro|IFP|IICM|ETP|ISCTEM|ISCAM|ISCISA|ISUTC|ISDB|ISGN|ISCIM|ISEDEF|ISGECOF|instituto|centro)\b/g, 'no $1');
    return s;
  });
}

// Bloqueia mensagens com campos por preencher ("O que NUNCA dizer" do guia).
export function hasPlaceholders(parts: string[]): boolean {
  return parts.some((p) => p.trim() !== PDF_MARK && /\[[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{3,}\]|\{[a-z_0-9]+\}/.test(p));
}

// ---- Decisao ----------------------------------------------------------------
export type Decision = {
  action: 'send_text' | 'send_pdf' | 'handoff' | 'wait';
  parts: string[];
  next: LeizProState;
  reason: string;
  notify?: string;   // avisar a equipa (mesmo enviando uma resposta)
};

function vars(st: LeizProState): Record<string, string> {
  return {
    universidade: st.university || '',
    curso: st.course || '',
    opcao1: st.offered?.[0]?.label || '',
    opcao2: st.offered?.[1]?.label || '',
    capitulo1: capitulo1(st),
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

function wait(st: LeizProState, reason: string, next?: Partial<LeizProState>): Decision {
  return { action: 'wait', parts: [], next: { ...st, ...(next || {}) }, reason };
}

function lastQuestionText(st: LeizProState): string | null {
  if (!st.lastQuestion) return null;
  const parts = fill(CUR[st.lastQuestion], st, vars(st));
  return parts[parts.length - 1] || null;
}

// Resposta que a Sherone nao percebe: passa logo a equipa (sem repetir a
// pergunta). Nas conversas reais, repetir "So para eu te orientar bem"
// irritava quem estava a falar de outra coisa.
function repeatOrHandoff(st: LeizProState, why: string): Decision {
  return handoff(st, `nao percebi a resposta: ${why}`);
}

// Junta a uma resposta a pergunta do passo em que o estudante esta.
function withResume(d: Decision, st: LeizProState): Decision {
  const resumable: Step[] = ['diagnosis', 'connection', 'ask_online', 'ask_commitment', 'pdf_sent', 'sn_activate'];
  if (!resumable.includes(st.step)) return d;
  const q = lastQuestionText(st);
  if (q && !d.parts.includes(q)) d.parts = [...d.parts, q];
  return d;
}

function withSlot(st: LeizProState): LeizProState {
  return { ...st, offered: proposeSlots() };
}

// ---- Pacotes e precos ---------------------------------------------------------
function priceFor(count: number, months: 1 | 2): number {
  const base = SUPER_NERD_PRICES[Math.min(count, 2) as 1 | 2][months];
  return base + Math.max(0, count - 2) * EXTRA_SUBJECT_PRICE[months];
}

function packageLabel(count: number, months: 1 | 2): string {
  const letter = count === 1 ? (months === 1 ? 'A' : 'C') : (months === 1 ? 'B' : 'D');
  if (count <= 2) return `Pacote ${letter}`;
  const extra = count - 2;
  return `Pacote ${letter} com mais ${extra} disciplina${extra > 1 ? 's' : ''}`;
}

// Mensagem do PDF (1.5.3): com o PDF se estiver no catalogo, senao em texto.
// Fecha com o dia combinado (amanha as 18h): a regua conta a partir dai.
function capitulo1(st: LeizProState): string {
  if (st.hardSubject) return `o capítulo 1 de ${st.hardSubject}`;
  const exam = examSubjects(st.university, st.course);
  if (exam) return `o capítulo 1 de ${joinOr(exam)}`;
  return 'o capítulo 1 da disciplina em que tens mais dificuldade';
}

// ["Biologia", "Química"] -> "Biologia ou de Química"
function joinOr(subjects: string[]): string {
  if (subjects.length <= 1) return subjects[0] || '';
  return `${subjects.slice(0, -1).join(', de ')} ou de ${subjects[subjects.length - 1]}`;
}

function sendPackages(st: LeizProState, reason: string): Decision {
  const slot = decisionSlot();
  const s2: LeizProState = { ...st, offered: [slot], regua: { startAt: slot.iso, sent: 0 } };
  const d = say('packagesPdf', s2, 'pdf_sent', reason, { capitulo1: capitulo1(s2) });
  return { ...d, action: 'send_pdf' };
}

export function packagesTextParts(st: LeizProState): string[] {
  return fill(CUR.packagesText, st, { ...vars(st), capitulo1: capitulo1(st) });
}

// Pacote escolhido -> canais de pagamento (3.2).
function choosePackage(st: LeizProState, count: number, months: 1 | 2, reason: string): Decision {
  const label = packageLabel(count, months);
  const valor = priceFor(count, months);
  const s2: LeizProState = {
    ...st, snCount: count, snMonths: months, pkg: `${label} (${valor} MZN)`,
    payFollow: { at: new Date(Date.now() + 86_400_000).toISOString(), sent: false },
  };
  const d = say('paymentChannels', s2, 'paying', `${reason}: ${label}, ${valor} MZN (Passo 3.2)`);
  d.notify = `escolheu o ${label} (${valor} MZN) e recebeu os canais de pagamento`;
  return d;
}

// Modo Super Nerd: pergunta disciplinas e duracao e diz UM valor (3.1 / 3.1.1).
function superNerd(st: LeizProState, reason: string): Decision {
  const entering = st.step !== 'sn_choice';
  const base: LeizProState = {
    ...st,
    snReturn: entering ? st.step : st.snReturn,
    snReturnQ: entering ? st.lastQuestion : st.snReturnQ,
  };
  if (!base.snCount || !base.snMonths) {
    if (!entering) {
      if ((st.lastKey === 'snAskCount' && !base.snCount) || (st.lastKey === 'snAskMonths' && !base.snMonths)) {
        return handoff(base, `${reason}: nao percebi a resposta ao modo Super Nerd depois de perguntar duas vezes`);
      }
      if (!base.snCount && base.snMonths) return say('snAskCount', base, 'sn_choice', `${reason}: falta o numero de disciplinas`);
      if (base.snCount && !base.snMonths) return say('snAskMonths', base, 'sn_choice', `${reason}: falta a duracao`);
      return repeatOrHandoff(base, `${reason}: nao percebi quantas disciplinas e quanto tempo`);
    }
    return say('superNerdAsk', base, 'sn_choice', `${reason} (Passo 3.1)`);
  }
  const valor = priceFor(base.snCount, base.snMonths);
  const pacote = packageLabel(base.snCount, base.snMonths);
  const price = fill(CUR.superNerdPrice, base, {
    disciplinas: base.snCount === 1 ? '1 disciplina' : `${base.snCount} disciplinas`,
    duracao: base.snMonths === 1 ? '1 mês' : '2 meses',
    pacote, valor: String(valor),
  });
  return {
    action: 'send_text',
    parts: [...price, ...fill(CUR.superNerdActivateQ, base)],
    next: { ...base, step: 'sn_activate', lastKey: 'superNerdActivateQ', lastQuestion: 'superNerdActivateQ', retries: 0 },
    reason: `${reason}: ${pacote} = ${valor} MZN (Passo 3.1.1)`,
  };
}

// ---- Diagnostico (Passos 1.1 a 1.3) ---------------------------------------------
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

// Conta criada (1.5.5): comeca pelo capitulo 1 da disciplina dificil.
function accountCreated(st: LeizProState, reason: string): Decision {
  const s2 = withSlot(st);
  const exam = examSubjects(s2.university, s2.course);
  const comeca = s2.hardSubject
    ? `Começa pelo capítulo 1 de ${s2.hardSubject}, que é onde disseste que te custa mais.`
    : exam
      ? `Começa pelo capítulo 1 de ${joinOr(exam)}, que ${exam.length > 1 ? 'são as disciplinas' : 'é a disciplina'} do teu exame.`
      : 'Começa pelo capítulo 1 da disciplina em que tens mais dificuldade.';
  return say('accountCreated', s2, 'followup', reason, { comeca_por: comeca });
}

// ---- Situacoes comuns (Fluxo 5) -------------------------------------------------
function objection(u: Understanding, st: LeizProState, text = ''): Decision | null {
  switch (u.intent) {
    case 'desconfianca': return handoff(st, 'o estudante desconfia (burla/golpe): resposta tem de ser de uma pessoa da equipa');
    case 'e_ia': return handoff(st, 'pergunta se esta a falar com uma IA ou com uma pessoa: a equipa responde');
    case 'duvida': return handoff(st, 'pergunta sobre o conteudo/funcionamento que o guia nao cobre');
    case 'instalar_app': return handoff(st, 'quer instalar a app (link do APK ainda por confirmar no guia)');
    case 'paguei_errado': return handoff(st, 'pagou o valor errado ou pede devolucao (regra por confirmar no guia)');
    case 'nao_abriu': return handoff(st, 'diz que pagou e o modo Super Nerd nao abriu: verificar no painel (Passo 4.3)');
    // A Leiz Pro nao confirma pagamentos: e sempre a equipa.
    case 'ja_pagou': return handoff({ ...st, paidOnce: true }, `diz que ja pagou${st.pkg ? ` o ${st.pkg}` : ''}: confirmar o pagamento e activar o acesso`);
    case 'quer_pagar':
      if (st.snCount && st.snMonths) return choosePackage(st, st.snCount, st.snMonths, 'quer pagar');
      return superNerd(st, 'quer pagar, falta escolher o pacote');
    case 'acesso_acabou': return withResume(say('accessEnded', st, 'sn_choice', 'o acesso acabou e quer continuar'), st);
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
    vidas: ['lives', 'pergunta sobre as vidas'],
    problema_acesso: ['accessProblem', 'nao consegue entrar/criar conta'],
    problema_codigo: ['emailCode', 'codigo do e-mail / e-mail com problema'],
    esqueci_senha: ['forgotPassword', 'esqueceu a palavra-passe'],
    trocar_disciplinas: ['changeSubjects', 'quer trocar as disciplinas'],
    problema_link: ['linkProblem', 'o link nao abre'],
    como_funciona: ['howOnline', 'pergunta como funciona estudar online'],
    horario_apoio: ['schedule', 'pergunta por horarios/assistencia'],
    muito_basico: ['tooBasic', 'acha o capitulo 1 basico'],
    sem_texto: ['nonText', 'mandou audio/imagem em vez de escrever'],
    gratis: ['isFree', 'pergunta se e gratis / se tem taxas'],
  };
  if (u.intent === 'sem_dinheiro') {
    if (st.lastKey === 'noMoney') return handoff(st, 'volta a dizer que nao tem condicoes: marcar contacto com dia e hora');
    const s2 = withSlot(st);
    return {
      action: 'send_text',
      parts: [...fill(CUR.noMoney, s2), ...fill(CUR.socials, s2), `Falamos ${s2.offered![0].label} para ver como estás?`],
      next: { ...s2, lastKey: 'noMoney' },
      reason: 'nao tem condicoes agora: capitulo 1 gratis, redes e proximo contacto (Fluxo 5)',
    };
  }
  // Depois de perguntar porque prefere o presencial: o motivo (o modelo le-o
  // muitas vezes como "prefere presencial") recebe "como e estudar online".
  const insists = /^(nao|n)\b|\b(quero mesmo|so presencial|mesmo presencial|nao quero online)\b/.test(text);
  if (st.lastKey === 'presencial' && !insists && !['sim', 'da_dados'].includes(u.intent)) {
    return withResume(say('howOnline', st, st.step, 'explicou porque prefere presencial: como e estudar online'), st);
  }
  if (u.intent === 'prefere_presencial') {
    if (st.lastKey === 'presencial' || st.lastKey === 'howOnline') return handoff(st, 'continua a preferir presencial depois da resposta do guia');
    return say('presencial', st, st.step, 'objeccao: prefere presencial (pergunta o motivo)');
  }
  if (u.intent === 'porque_pergunta' && st.lastQuestion) {
    if (st.lastKey === 'whyAsk') return handoff(st, 'continua a perguntar porque precisamos destes dados');
    return withResume(say('whyAsk', st, st.step, 'pergunta porque perguntamos'), st);
  }
  const hit = map[u.intent];
  if (!hit) return null;
  const [key, reason] = hit;
  if (st.lastKey === key) return handoff(st, `${reason}, repetido depois da resposta do guia`);
  return withResume(say(key, st, st.step, reason), st);
}

function merge(stIn: LeizProState, u: Understanding): LeizProState {
  const snTalk = ['sn_choice', 'pdf_sent', 'followup', 'sn_activate'].includes(stIn.step)
    || ['super_nerd', 'pergunta_preco', 'escolhe_pacote', 'quer_pagar'].includes(u.intent);
  return {
    ...stIn,
    name: stIn.name || u.name,
    university: u.university || stIn.university,
    course: u.course || stIn.course,
    snCount: snTalk ? (u.snCount ?? stIn.snCount) : stIn.snCount,
    snMonths: snTalk ? (u.snMonths ?? stIn.snMonths) : stIn.snMonths,
  };
}

export function decide(stIn: LeizProState, u0: Understanding, rawText = ''): Decision {
  const text = norm(rawText).trim();
  // Nas vacinas e nas perguntas de sim/nao, "Sim, estou! Tudo o que quero e
  // entrar" ou "Yeah claro" sao um sim (o modelo lia-os como dados ou vago).
  const yesNoSteps: Step[] = ['ask_online', 'ask_commitment', 'sn_activate', 'pdf_sent'];
  let u = u0;
  // So corrige leituras vagas do modelo; "quero o modo super nerd" continua Super Nerd.
  if (yesNoSteps.includes(stIn.step) && (u0.intentSource !== 'rule' || ['sim', 'da_dados', 'outro'].includes(u0.intent))
      && /^(sim|siim|claro|com certeza|estou|tou|yes|yeah|yah|pos sim|pois sim|quero|sem duvida|exacto|exato|obvio|consigo)\b/.test(text.replace(/^(eu|ah|oh|bom|ok)\s+/, ''))
      && !/\bnao\b/.test(text)) {
    u = { ...u0, intent: 'sim' };
  }
  const st = merge(stIn, u);
  // Curso pela lista dos editais ("Quimica ambiental e geologia..." -> o primeiro).
  let courseFound = false;
  if (st.step === 'diagnosis' && !st.course && st.name && st.university) {
    const c = findCourseIn(st.university, rawText);
    if (c) { st.course = c; courseFound = true; }
  }
  const gotData = u.intent === 'da_dados' || courseFound;
  const THANKS = new Set(['ok', 'okay', 'okk', 'obrigado', 'obrigada', 'obg', 'ta', 'esta', 'bem', 'combinado', 'beleza', 'blz',
    'certo', 'perfeito', 'fixe', 'sim', 'muito', 'entendido', 'percebido', 'entendi', 'tudo', 'valeu', 'tranquilo',
    'ate', 'la', 'amanha', 'logo', 'mais', 'inshallah', 'insha', 'incha', 'inch', 'allah', 'ja', 'agradeco', 'pela', 'informacao',
    'e', 'aguardo', 'pronto', 'pronta', 'vou', 'ver', 'abrir', 'tentar', 'sem', 'problema', 'problemas', 'ficarei', 'fico', 'ligada', 'ligado', 'atenta', 'atento', 'aguardando']);
  const words = text.replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const isThanks = (words.length > 0 && words.length <= 9 && words.every((w) => THANKS.has(w)))
    || (words.length === 0 && /[👍🙏✅]/u.test(rawText));

  if (u.intent === 'vazio' && st.step !== 'start') return wait(st, 'mensagem sem texto (so pontuacao): nao responder');

  // Audios: a Sherone nao responde (a equipa ouve). Imagens logo no inicio tambem.
  if (/\[(audio|ptt)\]/i.test(rawText)) return handoff(st, 'mandou um audio: a Sherone nao responde a audios');
  if (st.step === 'start' && /\[(image|imagem|video|document|sticker)\]/i.test(rawText)) {
    return handoff(st, 'primeira mensagem e uma imagem/documento: a equipa ve o conteudo');
  }

  // Primeira mensagem (gatilho do anuncio ou qualquer outra).
  if (st.step === 'start') {
    if (u.intent === 'pergunta_preco' || u.intent === 'super_nerd') return say('priceFirst', st, 'diagnosis', 'primeiro contacto a perguntar o preco (Passo 1.2)');
    if (st.name) return diagnosisNext(st, 'primeira mensagem ja com dados', true);
    const obj = objection(u, st, text);
    if (obj && obj.action === 'handoff') return obj;
    return say('greeting', st, 'diagnosis', 'primeiro contacto (Passo 1.1)');
  }

  // Modo Super Nerd: a escolher quantas disciplinas e quanto tempo.
  if (st.step === 'sn_choice' && (gotData || u.snCount || u.snMonths || u.pkg || /^\d$/.test(text))) {
    const s2 = { ...st };
    if (u.pkg) [s2.snCount, s2.snMonths] = PACKAGES[u.pkg];
    if (/^\d$/.test(text)) {
      const n = Number(text);
      if (!s2.snCount) s2.snCount = n;
      else if (!s2.snMonths && (n === 1 || n === 2)) s2.snMonths = n as 1 | 2;
    }
    if (u.pkg) return choosePackage(s2, s2.snCount!, s2.snMonths!, `escolheu o pacote ${u.pkg}`);
    return superNerd(s2, 'escolheu disciplinas/duracao');
  }

  // Escolheu um pacote ("quero o pacote D"): canais de pagamento.
  if (u.pkg && (u.intent === 'escolhe_pacote' || ['pdf_sent', 'followup', 'sn_activate', 'paying'].includes(st.step))) {
    const [c, m] = PACKAGES[u.pkg];
    return choosePackage(st, c, m, `escolheu o pacote ${u.pkg}`);
  }

  // Imagem, video ou documento: a Leiz Pro nao ve o conteudo, passa sempre a equipa.
  if (/\[(image|imagem|video|document|sticker)\]/i.test(rawText)) {
    if (st.step === 'paying') return handoff({ ...st, paidOnce: true }, `mandou uma imagem/documento depois dos canais de pagamento (comprovativo?)${st.pkg ? ` do ${st.pkg}` : ''}: confirmar o pagamento`);
    if (st.step === 'account_help') {
      // O print da conta: o rascunho para a equipa ja e a mensagem de conta criada.
      const created = accountCreated(st, 'print da conta');
      return {
        ...handoff(created.next, 'mandou um print durante a criacao da conta: ver o print; se a conta estiver criada, aprova o rascunho (Passo 1.5.5)'),
        parts: ['Leiz Pro passou a conversa para a equipa: mandou um print durante a criacao da conta. Se a conta estiver criada, envia esta mensagem:', ...created.parts],
      };
    }
    return handoff(st, 'mandou uma imagem/video/documento: a equipa ve o conteudo');
  }
  // A criar a conta: "ja criei", "consegui".
  if (st.step === 'account_help' && /\b(criei|ja esta|feito|consegui)\b/.test(text) && !/\bnao\b/.test(text)) {
    return accountCreated(st, 'conseguiu criar a conta (Passo 1.5.5)');
  }

  // A pagar e diz quando consegue ("so no fim do mes", "amanha", "ainda nao tenho"):
  // resposta do guia e a data vai para a equipa; sem follow-up de pagamento.
  if (st.step === 'paying' && u.intent !== 'ja_pagou' && u.intent !== 'nao_abriu'
      && (u.intent === 'sem_dinheiro' || /\b(amanha|depois de amanha|semana|mes|fim do mes|logo|mais tarde|ainda nao|sexta|segunda|terca|quarta|quinta|sabado|domingo|quando receber|vou pagar)\b/.test(text))) {
    const d = say('payLater', { ...st, payFollow: { at: new Date().toISOString(), sent: true, skip: true } }, 'paying', 'diz quando consegue pagar ("JA DISSE QUANDO CONSIGO PAGAR")');
    d.notify = `diz quando consegue pagar${st.pkg ? ` o ${st.pkg}` : ''}: "${rawText.trim().slice(0, 100)}" (registar a data)`;
    return d;
  }

  const obj = objection(u, st, text);
  if (obj) return obj;

  // "Nao percebi": repete a ultima pergunta (uma vez).
  if (u.intent === 'nao_percebi') {
    const q = lastQuestionText(st);
    if (st.retries >= 1 || !q) return handoff(st, 'nao percebeu a pergunta, mesmo depois de a repetir');
    if (st.lastQuestion === 'askCourse') {
      return { ...say('courseClarify', st, st.step, 'nao percebeu a pergunta do curso: explicar com exemplos'), next: { ...st, lastKey: 'courseClarify', retries: st.retries + 1 } };
    }
    return {
      action: 'send_text',
      parts: [...fill(CUR.clarifyPrefix, st), ...fill(CUR[st.lastQuestion!], st, vars(st)).slice(-1)],
      next: { ...st, lastKey: 'clarifyPrefix', retries: st.retries + 1 },
      reason: 'nao percebeu: repetir a pergunta',
    };
  }

  // Preco / modo Super Nerd. Antes do diagnostico, a primeira vez explica o
  // capitulo 1 gratis (1.2); depois diz o valor para o caso dele (3.1 / 3.1.1).
  if (u.intent === 'pergunta_preco' || u.intent === 'super_nerd') {
    if (st.step === 'diagnosis' && st.lastKey !== 'priceFirst' && u.intent === 'pergunta_preco') {
      return say('priceFirst', st, 'diagnosis', 'pergunta o preco antes do diagnostico (Passo 1.2)');
    }
    return superNerd(st, 'pergunta pelo preco / modo Super Nerd');
  }

  // Conta: pedir ajuda, ou "ja criei" -> 1.5.4 / 1.5.5
  if (u.intent === 'conta_criada' && ['pdf_sent', 'account_help', 'followup', 'paying', 'sn_activate'].includes(st.step)) {
    if (st.step === 'followup') return wait(st, 'confirma que tem conta (ja recebeu o capitulo 1 e os convites)');
    return accountCreated(st, 'conta criada (Passo 1.5.5)');
  }
  if (u.intent === 'criar_conta' && st.step !== 'account_help') {
    return say('accountHelp', st, 'account_help', 'quer criar a conta: passo a passo (Passo 1.5.4)');
  }

  switch (st.step) {
    case 'diagnosis': {
      const progressed = gotData && (st.name !== stIn.name || st.university !== stIn.university || st.course !== stIn.course);
      if (!progressed) return repeatOrHandoff(st, `resposta nao trouxe o que foi perguntado (intencao ${u.intent})`);
      return diagnosisNext(st, 'dados recebidos', !stIn.name && !!st.name);
    }

    case 'connection': {
      // Qualquer resposta serve. Guarda a dificuldade e a disciplina, para o
      // capitulo 1 (1.5.5).
      // So conta uma disciplina que sai no exame dele (editais 2026): um
      // estudante de Medicina que diz "Matematica" nao vai abrir Matematica.
      const exam = examSubjects(st.university, st.course);
      const hard = u.subjects.find((s) => !exam || exam.includes(s)) || null;
      const s2 = { ...st, difficulty: rawText.trim().slice(0, 300) || null, hardSubject: hard || st.hardSubject };
      const d = say('vaccineOnline', s2, 'ask_online', 'vacina do online (Passo 1.5.1)');
      // "Óptimo" so quando diz que nada foi dificil ("nada", "nao tive
      // dificuldades"); "nao consigo concentrar-me" e uma dificuldade.
      if (/^(nada|nenhum|nenhuma|nao|n|nada de especial|nao tive (nenhuma )?dificuldades?|nao tenho (nenhuma )?dificuldades?)\W*$/.test(text)) {
        d.parts[0] = s2.name ? `Óptimo, ${firstName(s2.name)}! 😊` : 'Óptimo! 😊';
      }
      return d;
    }

    case 'ask_online':
      if (u.intent === 'sim') return say('vaccineCommitment', st, 'ask_commitment', 'esta a vontade com o online: vacina do compromisso (Passo 1.5.2)');
      if (u.intent === 'nao') return say('presencial', st, 'ask_online', 'hesita com o online: resposta do Fluxo 5 (presencial)');
      return repeatOrHandoff(st, `resposta vaga a "estas a vontade online?" (intencao ${u.intent})`);

    case 'ask_commitment':
      if (u.intent === 'sim') return sendPackages(st, 'comprometido: envio dos pacotes (Passo 1.5.3)');
      if (u.intent === 'nao') return say('hesitant', withSlot(st), 'pdf_sent', 'resposta hesitante ao compromisso: capitulo 1 sem conta e proximo contacto');
      return repeatOrHandoff(st, `resposta vaga ao compromisso (intencao ${u.intent})`);

    case 'pdf_sent': {
      // "Falamos amanha?" depois de hesitar / "agora nao"
      if (st.lastKey === 'hesitant' || st.lastKey === 'notNow') {
        if (u.intent === 'sim' || isThanks) return wait(st, 'aceitou falar depois: nao e preciso responder', { step: 'followup' });
      }
      // "Posso falar contigo amanha as 18h para me dizeres com qual pacote vais ficar?"
      if (st.lastKey === 'packagesPdf' && st.regua) {
        const tc = parseTimeChoice(rawText, st.offered);
        if (tc.kind === 'slot' && tc.at.toISOString() !== st.regua.startAt) {
          const label = slotLabel(tc.at);
          return wait(st, `combinou outro dia/hora para dizer o pacote (${label}): a regua conta a partir dai`,
            { regua: { startAt: tc.at.toISOString(), sent: 0 }, offered: [{ iso: tc.at.toISOString(), label }] });
        }
        if (u.intent === 'sim' || isThanks || tc.kind === 'slot') return wait(st, 'aceitou o dia combinado: a regua de follow-up conta a partir dai');
      }
      // A meio da regua (ou depois da despedida): "sim, ja decidi" -> qual pacote?
      if (st.lastKey && ['reguaContact1', 'reguaContact1Generic', 'reguaContact1NoCourse', 'reguaContact2', 'reguaFarewell', 'askPackage'].includes(st.lastKey)) {
        if (u.intent === 'sim' && st.lastKey !== 'askPackage') return say('askPackage', st, 'pdf_sent', 'respondeu a regua: com qual dos pacotes vai ficar');
        if (u.intent === 'nao' || u.intent === 'sem_dinheiro') return say('reguaNotNow', st, 'followup', '"agora nao" na regua: agradecer e perguntar quando voltar a falar (Fluxo 6)');
        if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
      }
      if (u.intent === 'sim') return say('accountHelp', st, 'account_help', 'vai criar a conta: passo a passo (Passo 1.5.4)');
      if (u.intent === 'nao' || u.intent === 'sem_dinheiro') return say('notNow', withSlot(st), 'followup', 'agora nao: capitulo 1 gratis e proximo contacto');
      if (u.intent === 'gostou') return say('liked', st, 'pdf_sent', 'gostou: com qual dos pacotes vai ficar (Passo 2.1.1)');
      if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
      return handoff(st, `resposta depois dos pacotes (intencao ${u.intent}): a equipa acompanha`);
    }

    case 'account_help':
      if (isThanks || u.intent === 'sim') return wait(st, 'esta a criar a conta: esperar pelo print');
      return handoff(st, `durante a criacao da conta (intencao ${u.intent}): a equipa ajuda`);

    case 'followup':
      if (st.lastKey === 'reguaNotNow' && !isThanks) {
        return handoff(st, `disse quando pode voltar a falar ("${rawText.trim().slice(0, 80)}"): registar a data e voltar a contactar`);
      }
      if (isThanks || u.intent === 'sim') return wait(st, 'confirmou o proximo contacto: nao e preciso responder');
      if (u.intent === 'gostou') return say('liked', st, 'pdf_sent', 'gostou do capitulo 1: com qual dos pacotes vai ficar (Passo 2.1.1)');
      return handoff(st, `mensagem depois da conta criada (intencao ${u.intent}): a equipa acompanha`);

    case 'sn_activate':
      if (u.intent === 'sim' && st.snCount && st.snMonths) return choosePackage(st, st.snCount, st.snMonths, 'quer activar');
      if (u.intent === 'nao') return wait(st, 'nao quer activar agora: o modo Super Nerd e opcional', { step: st.snReturn && st.snReturn !== 'sn_choice' ? st.snReturn : 'followup', lastQuestion: st.snReturnQ });
      return repeatOrHandoff(st, `resposta vaga a "queres que explique como activar?" (intencao ${u.intent})`);

    case 'paying':
      if (isThanks || u.intent === 'sim') return wait(st, 'confirmou: espera o pagamento');
      if (/@/.test(rawText)) return { ...handoff(st, `mandou o e-mail da conta (${rawText.trim().slice(0, 80)}): validar o pagamento e activar`) };
      return handoff(st, `mensagem durante o pagamento (intencao ${u.intent}): a equipa acompanha`);

    case 'sn_choice':
      return superNerd(st, 'resposta ao modo Super Nerd');

    case 'handoff':
      break;
  }

  return handoff(st, `mensagem fora do guia neste passo (${st.step}, intencao ${u.intent})`);
}

// ---- Estado -----------------------------------------------------------------
const KNOWN_STEPS: Step[] = ['start', 'diagnosis', 'connection', 'ask_online', 'ask_commitment', 'pdf_sent',
  'account_help', 'followup', 'sn_choice', 'sn_activate', 'paying', 'handoff'];

export async function loadState(workspaceId: string, contactId: string): Promise<LeizProState> {
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
  const st = { ...INITIAL_STATE, ...saved } as LeizProState;
  // Passos de versoes antigas do guia (chamada marcada, etc.): seguem como
  // "depois dos pacotes", mantendo o que ja sabiamos do estudante.
  if (!KNOWN_STEPS.includes(st.step)) {
    st.step = ['call_booked', 'by_text', 'sn_paying'].includes(saved.step) ? 'followup' : 'diagnosis';
  }
  if (st.lastKey && !(st.lastKey in T)) st.lastKey = null;
  if (st.lastQuestion && !(st.lastQuestion in T)) st.lastQuestion = null;
  return st;
}

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
    // Imagens/documentos ficam sempre marcados (mesmo com legenda): a Leiz Pro nao os ve.
    .map((m) => (['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO'].includes(m.type)
      ? `[${m.type}] ${m.type === 'AUDIO' ? '' : m.content || ''}`.trim()
      : m.content || m.transcription || (m.type !== 'TEXT' ? `[${m.type}]` : '')))
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
    case 'pdf_sent': return 'com qual dos pacotes fica, ou se pode falar no dia combinado (sim/nao/outra hora)';
    case 'account_help': return 'um print de que chegou as disciplinas, ou uma dificuldade a criar a conta';
    case 'sn_choice': return 'quantas disciplinas e por quanto tempo (1 ou 2 meses) quer o modo Super Nerd';
    case 'sn_activate': return 'se quer que expliquem como activar o modo Super Nerd (sim/nao)';
    case 'paying': return 'o comprovativo do pagamento (quem confirma e a equipa)';
    default: return 'nada';
  }
}

// Uma volta completa (compreensao + decisao + verificacao). Exportada para o
// simulador de testes (scripts/leizProSimulate.ts) usar exactamente o mesmo caminho.
export async function runTurn(state: LeizProState, text: string, workspaceId?: string) {
  const u = await understand(text, expectingFor(state), slotFor(state));
  CUR = workspaceId ? await loadTexts(workspaceId) : T;
  let d = decide(state, u, text);
  if (d.action !== 'handoff' && d.action !== 'wait' && hasPlaceholders(d.parts)) {
    d = handoff(state, 'a resposta ficou com campos por preencher');
  }
  // A regua so continua enquanto ele esta a decidir o pacote (pdf_sent).
  if (d.next.step !== 'pdf_sent') d.next = { ...d.next, regua: null };
  // O follow-up de pagamento so existe enquanto ele esta a pagar.
  if (d.next.step !== 'paying') d.next = { ...d.next, payFollow: null };
  return { u, d };
}

// ---- Regua de follow-up (Fluxo 6) ---------------------------------------------
// 3 mensagens a contar do dia combinado: no proprio dia, 3 dias depois e a
// despedida ao fim de 9 dias (sem chamadas). Se ele responder, a regua para.
export const REGUA_DAYS = [0, 3, 9];
const REGUA_KEYS: TemplateKey[] = ['reguaContact1', 'reguaContact2', 'reguaFarewell'];

export function reguaDue(st: LeizProState): Date | null {
  if (!st.regua || st.step !== 'pdf_sent' || st.regua.sent >= REGUA_DAYS.length) return null;
  return new Date(new Date(st.regua.startAt).getTime() + REGUA_DAYS[st.regua.sent] * 86_400_000);
}

// "Licenciatura em lingua francesa" -> "Lingua francesa"
function courseName(c: string): string {
  const t = c.replace(/^(licenciatura|curso|lic\.?)\s+(em|de)\s+/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Contacto 1 (modelo da Deise): variante e campos conforme o curso dele.
function reguaContact1(st: LeizProState): { key: TemplateKey; vars: Record<string, string> } {
  if (!st.course) return { key: 'reguaContact1NoCourse', vars: {} };
  const opts = examOptions(st.university, st.course);
  if (!opts || !opts[0].length) {
    const n = st.snCount === 1 ? 1 : 2;
    return {
      key: 'reguaContact1Generic',
      vars: { curso: courseName(st.course), pacote: packageLabel(n, 2), disciplinas: n === 1 ? '1 disciplina' : '2 disciplinas', duracao: '2 meses' },
    };
  }
  const subs = opts[0].slice(0, 2);
  const disciplina = st.hardSubject && subs.includes(st.hardSubject) ? st.hardSubject : subs[subs.length - 1];
  return {
    key: 'reguaContact1',
    vars: { curso: courseName(st.course), pacote: packageLabel(subs.length, 2), disciplinas: subs.join(' e '), duracao: '2 meses', disciplina },
  };
}

// Texto e estado do proximo contacto da regua (sem base de dados; o simulador usa-o).
export function reguaTurn(st: LeizProState, texts?: Texts): { parts: string[]; next: LeizProState } {
  if (texts) CUR = texts;
  const n = st.regua?.sent ?? 0;
  let key = REGUA_KEYS[n];
  let extra: Record<string, string> = {};
  if (key === 'reguaContact1') ({ key, vars: extra } = reguaContact1(st));
  const parts = fill(CUR[key], st, { ...vars(st), ...extra });
  const next: LeizProState = { ...st, regua: { startAt: st.regua?.startAt || new Date().toISOString(), sent: n + 1 }, lastKey: key, lastQuestion: key, retries: 0 };
  return { parts, next };
}

// Follow-up de pagamento (1 dia depois dos canais, uma vez). lastOutAt: a
// ultima mensagem nossa, para quem escolheu o pacote antes desta funcao existir.
export async function generateLeizProPayFollowup(opts: { workspaceId: string; contactId: string; leadId?: string | null; lastOutAt: Date }) {
  const st = await loadState(opts.workspaceId, opts.contactId);
  if (st.step !== 'paying' || st.payFollow?.sent) return null;
  const at = st.payFollow?.at ? new Date(st.payFollow.at) : new Date(opts.lastOutAt.getTime() + 86_400_000);
  if (at.getTime() > Date.now()) return null;
  const followupKey = `pay:${st.pkg || ''}:${at.toISOString().slice(0, 10)}`;
  const exists = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId: opts.contactId, actionPayload: { path: ['followupKey'], equals: followupKey } },
    select: { id: true },
  });
  if (exists) return null;
  CUR = await loadTexts(opts.workspaceId);
  const parts = fill(CUR.payFollowup, st, { ...vars(st), pacote: st.pkg || 'pacote' });
  if (hasPlaceholders(parts)) return null;
  const next: LeizProState = { ...st, payFollow: { at: at.toISOString(), sent: true }, lastKey: 'payFollowup', lastQuestion: 'payFollowup', retries: 0 };
  const suggestion = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      parts: parts as any,
      action: 'send_text',
      productFileIds: [] as any,
      actionPayload: { leizpro: next, followupKey } as any,
      reasoning: `Follow-up de pagamento: escolheu o ${st.pkg || 'pacote'} e passou 1 dia sem comprovativo nem resposta.`,
      principlesUsed: [] as any,
      modelUsed: 'leizpro:pagamento',
      status: 'PENDING',
    },
  });
  await syncStage(opts.workspaceId, opts.contactId, next);
  return suggestion;
}

// Gera o proximo contacto da regua para um estudante (chamado pelo agendador).
// Em modo supervisionado fica PENDING (sugestao para aprovar).
export async function generateLeizProFollowup(opts: { workspaceId: string; contactId: string; leadId?: string | null }) {
  const st = await loadState(opts.workspaceId, opts.contactId);
  const due = reguaDue(st);
  if (!due || due.getTime() > Date.now()) return null;
  const n = st.regua!.sent;
  const followupKey = `${st.regua!.startAt}#${n}`;
  // Ja gerado (ex.: descartado pela equipa = parar a regua): nao repetir.
  const exists = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId: opts.contactId, actionPayload: { path: ['followupKey'], equals: followupKey } },
    select: { id: true },
  });
  if (exists) return null;

  CUR = await loadTexts(opts.workspaceId);
  const { parts, next } = reguaTurn(st);
  if (hasPlaceholders(parts)) return null;
  const suggestion = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      parts: parts as any,
      action: 'send_text',
      productFileIds: [] as any,
      actionPayload: { leizpro: next, followupKey } as any,
      reasoning: `Regua de follow-up (Fluxo 6): contacto ${n + 1} de ${REGUA_DAYS.length}, sem resposta desde os pacotes.`,
      principlesUsed: [] as any,
      modelUsed: 'leizpro:regua',
      status: 'PENDING',
    },
  });
  await syncStage(opts.workspaceId, opts.contactId, next);
  return suggestion;
}

// ---- PDF dos pacotes ------------------------------------------------------------
// Produto activo do catalogo cujo nome tem "pacote", com pelo menos um PDF.
async function findPackagesPdf(workspaceId: string): Promise<{ productId: string; fileIds: string[] } | null> {
  const products = await prisma.product.findMany({
    where: { workspaceId, isActive: true, name: { contains: 'pacote', mode: 'insensitive' } },
    select: { id: true, files: { where: { mimeType: 'application/pdf' }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { updatedAt: 'desc' },
  });
  const p = products.find((x) => x.files.length > 0);
  return p ? { productId: p.id, fileIds: p.files.map((f) => f.id) } : null;
}

// ---- Concorrencia ---------------------------------------------------------------
// Espera depois da ultima mensagem antes de responder (30 a 45 s, ao acaso),
// para nao responder enquanto o estudante ainda esta a escrever. Cada mensagem
// nova recomeca a espera (isLatestInbound) e a resposta junta todas.
// LEIZPRO_DEBOUNCE_MS fixa um valor (ex.: para testes).
const DEBOUNCE_FIXED = process.env.LEIZPRO_DEBOUNCE_MS ? Number(process.env.LEIZPRO_DEBOUNCE_MS) : null;
const contactLocks = new Map<string, Promise<void>>();

export function debounceInbound(): Promise<void> {
  const ms = DEBOUNCE_FIXED ?? 30_000 + Math.floor(Math.random() * 15_000);
  return new Promise((r) => setTimeout(r, ms));
}

export async function isLatestInbound(contactId: string, messageId: string): Promise<boolean> {
  const last = await prisma.message.findFirst({
    where: { contactId, direction: 'INBOUND', isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return !last || last.id === messageId;
}

// A equipa assumiu a conversa: a ultima mensagem nossa foi escrita por uma
// pessoa (nao saiu de uma sugestao da Sherone). Nesse caso a Sherone fica
// calada, para nao responder por cima da equipa (conversas reais de 22/11).
export async function teamTookOver(contactId: string): Promise<boolean> {
  const lastOut = await prisma.message.findFirst({
    where: { contactId, direction: 'OUTBOUND', isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!lastOut) return false;
  const fromSherone = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId, sentMessageIds: { array_contains: [lastOut.id] } },
    select: { id: true },
  });
  return !fromSherone;
}

export async function lastIsOutbound(contactId: string): Promise<boolean> {
  const last = await prisma.message.findFirst({
    where: { contactId, isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { direction: true },
  });
  return last?.direction === 'OUTBOUND';
}

export async function withContactLock(contactId: string, fn: () => Promise<void>): Promise<void> {
  const prev = contactLocks.get(contactId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  contactLocks.set(contactId, tail);
  try { await run; } finally {
    if (contactLocks.get(contactId) === tail) contactLocks.delete(contactId);
  }
}

// Avisa donos/admins/gestores (passagem para a equipa, ou pagamento a validar).
export async function notifyHandoff(workspaceId: string, contactId: string, suggestion: { reasoning?: string | null; actionPayload?: any }) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { firstName: true, lastName: true } });
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'um estudante';
  const notify = (suggestion.actionPayload as any)?.notify as string | undefined;
  const reason = notify || String(suggestion.reasoning || '').split(/ Passo |\. Intencao/)[0].slice(0, 200);
  const recipients = await prisma.user.findMany({
    where: { workspaceId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] }, isActive: true },
    select: { id: true },
  });
  if (!recipients.length) return;
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      title: notify ? `Sherone: ${name} precisa da equipa` : `Sherone passou a conversa de ${name}`,
      body: reason || 'A conversa precisa de uma pessoa da equipa.',
      type: 'leizpro_handoff',
      link: '/inbox',
    })),
  });
  // Mensagem no WhatsApp para o contacto humano de handoff (Leizy > configuracao).
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    const phone = (ws as any)?.aiHandoffContactPhone?.trim();
    if (ws && phone) {
      const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { whatsapp: true, phone: true } });
      const num = c?.whatsapp || c?.phone || '';
      const { sendWhatsAppToDestination } = await import('../dailyTaskDigest');
      await sendWhatsAppToDestination(ws, phone,
        `🔔 *Sherone precisa de ti*\n👤 ${name}${num ? ` (${num})` : ''}\n📝 ${reason || 'A conversa precisa de uma pessoa da equipa.'}\n\nAbre o Klaru > Mensagens para responder.`);
    }
  } catch (e: any) {
    console.error('[leizpro] aviso por WhatsApp falhou:', e?.message || e);
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
  if (state.step === 'handoff') return null;

  const text = await pendingInboundText(opts.contactId);
  if (!text.trim()) return null;

  // So comeca conversas que vieram do anuncio: a primeira mensagem do contacto
  // (ou a que chegou agora) tem de ser a de gatilho. Os outros ficam com a equipa.
  if (state.step === 'start' && !isTriggerText(text)) {
    const first = await prisma.message.findFirst({
      where: { contactId: opts.contactId, direction: 'INBOUND', isInternal: false },
      orderBy: { createdAt: 'asc' },
      select: { content: true },
    });
    if (!isTriggerText(first?.content || '')) return null;
  }

  let { u, d } = await runTurn(state, text, opts.workspaceId);

  // PDF dos pacotes: do catalogo; sem ele, os pacotes em texto.
  let productId: string | null = null;
  let productFileIds: string[] = [];
  if (d.action === 'send_pdf') {
    const pdf = await findPackagesPdf(opts.workspaceId);
    if (pdf) {
      productId = pdf.productId;
      productFileIds = pdf.fileIds;
    } else {
      d = { ...d, action: 'send_text', parts: packagesTextParts(d.next), reason: `${d.reason} (sem PDF no catalogo: pacotes em texto)` };
    }
  }
  const action = d.action === 'send_pdf' ? 'send_product' : d.action;

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
      action,
      productId,
      productFileIds: productFileIds as any,
      actionPayload: { leizpro: d.next, understood: { ...u }, ...(d.notify ? { notify: d.notify } : {}) } as any,
      reasoning,
      principlesUsed: [] as any,
      modelUsed: `leizpro:${u.modelUsed || 'regras'}`,
      // "Nao responder" nao precisa de decisao: fica ja resolvida.
      status: d.action === 'wait' ? 'APPROVED' : 'PENDING',
      ...(d.action === 'wait' ? { decidedAt: new Date() } : {}),
    },
  });
  // Pipeline (a passagem a equipa nao muda a etapa) e tarefas da regua.
  await syncStage(opts.workspaceId, opts.contactId, d.next);
  return { suggestion, normalized: { action }, notify: d.notify || null };
}

export { LEIZPRO_MODEL, AVAILABLE_SUBJECTS };
