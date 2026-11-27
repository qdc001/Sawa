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
import { subjectListOnly, findSubjects, NOT_YES } from './understand';
import { understand, norm, LEIZPRO_MODEL, presentIn, validName, titleCase, findUniversity as findUniversityIn, type Understanding, type Intent, type Slot as AskSlot } from './understand';
import { askVertex, vertexEnabled, vertexModel } from './vertex';
import { examSubjects, examOptions, findCourseIn } from './courses';
import { syncStage } from './pipeline';
import { proposeSlots, decisionSlot, parseTimeChoice, slotLabel, type Slot } from './schedule';
import { payDayAt } from './fuTiming';
import { type Access, type AccessKey, daysLeft } from './access';

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
  | 'ambassador'      // sem dinheiro: Premio Embaixador ("consegues fazer isso?")
  | 'active'          // acesso activo (boas-vindas da equipa): meio do acesso e renovacao
  | 'handoff';

export type LeizProState = {
  step: Step;
  name: string | null;
  university: string | null;
  course: string | null;
  difficulty: string | null;     // o que contou no Passo 1.4
  hardSubject: string | null;
  examSubjects: string[] | null; // disciplinas do exame que o estudante disse    // disciplina em que tem mais dificuldade (para o capitulo 1)
  offered: Slot[] | null;        // hora proposta para o proximo contacto
  snCount: number | null;
  snMonths: 1 | 2 | null;
  snReturn: Step | null;
  snReturnQ: TemplateKey | null;
  pkg: string | null;            // pacote escolhido (ex.: "Pacote D")
  // Regua de follow-up (Fluxo 6): dia combinado e quantos contactos ja foram.
  regua: { startAt: string; sent: number } | null;
  // Follow-up de pagamento: quando sai (1 dia depois dos canais) e se ja saiu.
  payFollow: { at: string; sent: boolean; skip?: boolean; day?: string } | null; // day: dia que disse que paga (1.o follow-up nesse dia, guia v32)
  paidOnce: boolean;
  // Follow-ups por etapa (guia v31): etapa e quantos ja foram (4 = reactivacao feita).
  fu: { stage: FuStage; n: number } | null;
  // Acesso activo (guia v34): datas lidas das boas-vindas da equipa.
  access: Access | null;
  lastKey: TemplateKey | null;
  lastQuestion: TemplateKey | null;
  retries: number;
};

export const INITIAL_STATE: LeizProState = {
  step: 'start', name: null, university: null, course: null, difficulty: null, hardSubject: null, examSubjects: null, offered: null,
  snCount: null, snMonths: null, snReturn: null, snReturnQ: null, pkg: null, regua: null, payFollow: null, paidOnce: false, fu: null, access: null,
  lastKey: null, lastQuestion: null, retries: 0,
};

// Mensagens que respondem a algo e nao avancam o fluxo.
const OBJECTION_KEYS: TemplateKey[] = [
  'isFree', 'whyAsk', 'expensive', 'paymentSafe', 'friendReferral', 'coversExam', 'willIPass', 'noUniversity',
  'weakPhone', 'shareAccount', 'payOtherPerson', 'lives', 'accessProblem', 'emailCode', 'forgotPassword',
  'changeSubjects', 'linkProblem', 'presencial', 'howOnline', 'schedule', 'tooBasic', 'nonText',
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
    // "[NOME], muitos estudantes..." sem nome -> "Muitos estudantes..."
    else s = s.replace(/^\[NOME\],\s*(\S)/, (_m, c: string) => c.toUpperCase()).replace(/,\s*\[NOME\]/g, '').replace(/\s*\[NOME\]/g, '');
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
  improvised?: boolean; // texto escrito pelo Gemini (nao e do guia)
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
    // So uma nota interna: o estudante nao recebe nada (sem "vou confirmar com a equipa").
    parts: [`Nota interna (não é enviada ao estudante): a Sherone passou a conversa para a equipa porque ${reason}.`],
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

// "Hoje nao": o proximo contacto fica para amanha.
function withSlot(st: LeizProState, notToday = false): LeizProState {
  return { ...st, offered: proposeSlots(new Date(), notToday) };
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
  const exam = (examSubjects(st.university, st.course) || (st.examSubjects?.length ? st.examSubjects : null));
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
  const exam = (examSubjects(s2.university, s2.course) || (s2.examSubjects?.length ? s2.examSubjects : null));
  const comeca = s2.hardSubject
    ? `Começa pelo capítulo 1 de ${s2.hardSubject}, que é onde disseste que te custa mais.`
    : exam
      ? `Começa pelo capítulo 1 de ${joinOr(exam)}, que ${exam.length > 1 ? 'são as disciplinas' : 'é a disciplina'} do teu exame.`
      : 'Começa pelo capítulo 1 da disciplina em que tens mais dificuldade.';
  return say('accountCreated', s2, 'followup', reason, { comeca_por: comeca });
}

// ---- Sem dinheiro: Premio Embaixador (Fluxo 5, v31) -----------------------------
// "Nao tenho dinheiro" -> o convite e a alternativa para nao ficar sem estudar:
// "Consegues fazer isso?" -> sim: onde fica o botao + proximo contacto; nao:
// "o que te impede?" -> resposta ao motivo (uma vez por motivo) -> se mesmo
// assim nao conseguir, despedida calorosa com proximo contacto.
const AMB_REASON_KEYS: TemplateKey[] = ['ambNoOne', 'ambShy', 'ambNoData', 'ambSlow'];
const AMB_KEYS: TemplateKey[] = ['noMoney', 'fuAmb1', 'fuAmb2', 'fuAmb3', 'ambNo', 'fuAmbNo1', 'fuAmbNo2', 'fuAmbNo3', 'ambReady', ...AMB_REASON_KEYS];

function dayOnly(st: LeizProState): string {
  return (st.offered?.[0]?.label || 'amanhã').split(' às ')[0];
}

function noMoney(st: LeizProState, text: string): Decision {
  // Ja recebeu a despedida do Premio Embaixador e volta a dizer que nao tem: a equipa.
  if (st.step === 'ambassador') return ambassador(st, { intent: 'nao' } as Understanding, text, false);
  if (st.lastKey === 'ambGiveUp') return handoff(st, 'volta a dizer que nao tem condicoes depois do Premio Embaixador: a equipa decide');
  return say('noMoney', { ...st, snReturn: null }, 'ambassador', 'nao tem condicoes agora: Premio Embaixador como alternativa (Fluxo 5, v31)');
}

function ambReason(text: string): TemplateKey | null {
  if (/\b(nao conheco ninguem|ninguem que conheco|nao conheco (nenhum|nenhuma)|ninguem (que )?(vai|vao|esta|estao) (fazer|a fazer)|nao tenho (amigos|colegas|ninguem)|sem (amigos|colegas)|(meus|os) (amigos|colegas) (ja )?(nao|entraram|passaram))\b/.test(text)) return 'ambNoOne';
  if (/\b(vergonha|envergonhad\w*|timid\w*|nao gosto de (pedir|incomodar|mandar)|e chato (pedir|mandar)|tenho medo de (pedir|mandar))\b/.test(text)) return 'ambShy';
  if (/\b(nao tenho (dados|saldo|megas|credito|internet|net)|sem (dados|saldo|megas|credito|internet|net)|(dados|saldo|megas|credito) (acabaram|acabou|esgotou))\b/.test(text)) return 'ambNoData';
  if (/\b(nao (vao|vai) (entrar|criar|aceitar|querer)|ninguem vai (entrar|criar|aceitar|querer)|vai demorar|demora muito|leva muito tempo|nao acredito|e dificil (juntar|arranjar|conseguir) (5|cinco))\b/.test(text)) return 'ambSlow';
  return null;
}

function ambassador(st: LeizProState, u: Understanding, text: string, isThanks: boolean): Decision {
  // Motivos serios (saude, familia nao deixa, luto): uma pessoa da equipa responde.
  if (/\b(hospital|internad\w*|doente|luto|faleceu|morreu|(pai|mae|pais|familia) nao (me )?deix\w*|nao me deix\w*|proibid\w*)\b/.test(text)) {
    return handoff(st, `Premio Embaixador: motivo serio ("${text.slice(0, 80)}"): uma pessoa da equipa responde`);
  }
  // "Estou bem obrigada, e voce?" e cumprimento, nao um "sim" (conversa real de 26/11).
  if (/^(estou|tou|to)? ?(bem|optima|otimo|optimo)( obrigad\w*)?( e (voce|tu)( esta| estas)?)?\W*$|^(e )?(voce|tu) (esta|estas)( bem)?\W*$|^(tudo bem|bom dia|boa tarde|boa noite|ola|oi)\W*$/.test(text)) {
    return handoff(st, `respondeu com um cumprimento ("${text.slice(0, 60)}"): a equipa continua a conversa`);
  }
  const reason = ambReason(text);
  const k = st.lastKey;
  // "Nunca insistir mais do que uma vez no mesmo motivo": o mesmo motivo outra vez -> despedida.
  if (reason && reason === k) return ambGiveUp(st, `repete o mesmo motivo (${reason})`);
  if (reason) {
    if (reason === 'ambNoData') return say('ambNoData', withSlot(st, true), 'ambassador', 'motivo: nao tem dados/saldo', { dia: dayOnly(withSlot(st, true)) });
    if (reason === 'ambSlow') return say('ambSlow', withSlot(st), 'ambassador', 'motivo: acha que nao vao entrar / vai demorar');
    return say(reason, st, 'ambassador', `motivo: ${reason === 'ambNoOne' ? 'nao conhece ninguem' : 'vergonha / nao gosta de pedir'}`);
  }
  const yes = (u.intent === 'sim' || /^(vou tentar|vou fazer|posso tentar|consigo sim|da para|claro|vou partilhar|ja partilhei|ja mandei|ya|yah|yes|bora|siga)\b/.test(text)) && !NOT_YES.test(text.replace(/^vou tentar/, ''));
  const no = !yes && (u.intent === 'nao' || u.intent === 'sem_dinheiro' || u.intent === 'nao_sei' || /\b(nao (consigo|da|posso|vou|sei)|impossivel|dificil)\b/.test(text));
  // Ofereceu a mensagem pronta ("Queres que te mande...?")
  if ((k === 'ambShy' || k === 'fuAmbNo1') && yes) return say('ambReady', st, 'ambassador', 'quer a mensagem pronta para os colegas');
  if (k === 'ambReady') {
    if (no) return ambGiveUp(st, 'mesmo com a mensagem pronta nao consegue');
    if (yes || isThanks) return wait({ ...st, step: 'followup' }, 'recebeu a mensagem pronta: vai partilhar');
  }
  if (isThanks && !yes) return wait(st, 'agradeceu: nao e preciso responder');
  if (yes) {
    if (k && AMB_REASON_KEYS.includes(k) && st.offered?.length && k !== 'ambNoOne' && k !== 'ambShy') {
      return wait({ ...st, step: 'followup' }, 'vai partilhar o link (ja tem o proximo contacto marcado)');
    }
    return say('ambYes', withSlot(st), 'followup', 'consegue partilhar o link: onde fica o botao e proximo contacto');
  }
  if (no) {
    if (k === 'noMoney' || k === 'fuAmb1') return say('ambNo', st, 'ambassador', 'diz que nao consegue: perguntar o que o impede');
    return ambGiveUp(st, 'mesmo assim nao consegue');
  }
  if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
  // Depois de "O que te impede?": um motivo que o guia nao tem -> a equipa responde.
  return handoff(st, `Premio Embaixador: resposta que o guia nao cobre ("${text.slice(0, 80)}")`);
}

function ambGiveUp(st: LeizProState, why: string): Decision {
  const s2 = withSlot(st, true);
  return say('ambGiveUp', s2, 'followup', `${why}: despedida calorosa e proximo contacto (Premio Embaixador)`, { dia: dayOnly(s2) });
}

// ---- Situacoes comuns (Fluxo 5) -------------------------------------------------
function objection(u: Understanding, st: LeizProState, text = ''): Decision | null {
  switch (u.intent) {
    case 'desconfianca': return handoff(st, 'o estudante desconfia (burla/golpe): resposta tem de ser de uma pessoa da equipa');
    case 'e_ia': return handoff(st, 'pergunta se esta a falar com uma IA ou com uma pessoa: a equipa responde');
    case 'duvida': return handoff(st, 'pergunta sobre o conteudo/funcionamento que o guia nao cobre');
    case 'instalar_app': return handoff(st, 'quer instalar a app (link do APK ainda por confirmar no guia)');
    case 'paguei_errado': return handoff(st, /numero|conta/.test(text)
      ? 'diz que enviou o dinheiro para o numero errado: NAO activar sem confirmar onde caiu o pagamento'
      : 'pagou o valor errado ou pede devolucao (regra por confirmar no guia)');
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
  if (u.intent === 'sem_dinheiro') return noMoney(st, text);
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
    // Disciplinas do exame: ditas no diagnostico, ou numa mensagem que e so a lista.
    examSubjects: (() => {
      const list = u.subjects.length && ['start', 'diagnosis'].includes(stIn.step) ? u.subjects : [];
      return list.length ? [...new Set([...(stIn.examSubjects || []), ...list])] : stIn.examSubjects;
    })(),
    snCount: snTalk ? (u.snCount ?? stIn.snCount) : stIn.snCount,
    snMonths: snTalk ? (u.snMonths ?? stIn.snMonths) : stIn.snMonths,
  };
}

export function decide(stIn: LeizProState, u0: Understanding, rawText = ''): Decision {
  const text = norm(rawText).trim();
  // Nas vacinas e nas perguntas de sim/nao, "Sim, estou! Tudo o que quero e
  // entrar" ou "Yeah claro" sao um sim (o modelo lia-os como dados ou vago).
  const yesNoSteps: Step[] = ['ask_online', 'ask_commitment', 'sn_activate', 'pdf_sent', 'ambassador'];
  let u = u0;
  // So corrige leituras vagas do modelo; "quero o modo super nerd" continua Super Nerd.
  if (yesNoSteps.includes(stIn.step) && (u0.intentSource !== 'rule' || ['sim', 'da_dados', 'outro'].includes(u0.intent))
      && /^(si+m+|xim|claro|com certeza|estou|tou|yes|yeah|yah|pos sim|pois sim|quero|sem duvida|exacto|exato|obvio|consigo)\b/.test(text.replace(/^(eu|ah|oh|bom|ok)\s+/, ''))
      // "Estou falido", "tou ocupado", "estou sem dinheiro": nao e um sim.
      && !NOT_YES.test(text)) {
    u = { ...u0, intent: 'sim' };
  }
  // O modelo le "Hahahaha", "Responde!!!", "Se tiver tempo" como sim. Nas vacinas
  // um sim faz avancar, por isso so vale sem sinais contrarios.
  if (['ask_online', 'ask_commitment'].includes(stIn.step) && u.intent === 'sim'
      && (NOT_YES.test(text) || /^(k|h|a|e|ha|he|hi|ka|rs|lol|kk)+$/.test(text.replace(/[^a-z]/g, '')))) {
    u = { ...u, intent: /\b(nao|duvida|duvidas|se (tiver|der|calhar|puder)|indecis\w*|talvez)\b/.test(text) ? 'nao' : 'outro' };
  }
  const st = merge(stIn, u);
  { const only = subjectListOnly(rawText); if (only.length) st.examSubjects = [...new Set([...(st.examSubjects || []), ...only])]; }
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
    'e', 'aguardo', 'pronto', 'pronta', 'vou', 'ver', 'abrir', 'tentar', 'sem', 'problema', 'problemas', 'ficarei', 'fico', 'ligada', 'ligado', 'atenta', 'atento', 'aguardando', 'recebido', 'recebida', 'recebi', 'notado', 'anotado', 'stress', 'stresse']);
  const words = text.replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const isThanks = (words.length > 0 && words.length <= 9 && words.every((w) => THANKS.has(w)))
    || (words.length === 0 && /[👍🙏✅]/u.test(rawText));

  // Conversa social ("Estou bem obrigada, e voce?", "Tudo bem e contigo?") a
  // meio do guia: nao e um "sim" nem uma resposta a pergunta. Uma pessoa
  // responde (26/11: lido como "sim" ao Premio Embaixador).
  if (st.step !== 'start' && words.length <= 8
      && /\b(e (voce|tu|contigo|consigo)|como (esta|estas|vai|vais))( esta| estas)?( bem)?\W*$/.test(text)) {
    return handoff(st, `respondeu com um cumprimento ("${rawText.trim().slice(0, 60)}"): a equipa continua a conversa`);
  }

  // Na conexao ("o que foi mais dificil?") um emoji tambem e uma resposta ("😔").
  const emojiAnswer = st.step === 'connection' && u.intent === 'vazio' && /\p{Extended_Pictographic}/u.test(rawText);
  if (u.intent === 'vazio' && st.step !== 'start' && !emojiAnswer) return wait(st, 'mensagem sem texto (so pontuacao): nao responder');

  // Pede uma chamada: a Sherone nao liga, a equipa decide.
  if (st.step !== 'start' && /\b(me (liga|ligue|ligar)|(pode|podes|podem) (me )?ligar|liga(-| )me|ligue(-| )me|fazer uma chamada|uma ligacao|por chamada)\b/.test(text)) {
    return handoff(st, `pede uma chamada ("${rawText.trim().slice(0, 80)}")`);
  }

  // Audios: a Sherone nao responde (a equipa ouve). Imagens logo no inicio tambem.
  // Sofrimento / risco de vida: uma pessoa da equipa responde JA (em qualquer passo).
  if (/\b(suicid\w*|matar-me|me matar|vou me matar|tirar a (minha )?(propria )?vida|nao quero (mais )?viver|quero morrer|acabar com (a minha vida|tudo))\b/.test(text)) {
    return handoff(stIn, `URGENTE: o estudante fala em suicidio/risco de vida ("${rawText.trim().slice(0, 80)}"): uma pessoa da equipa responde ja`);
  }
  if (/\[(audio|ptt)\]/i.test(rawText)) return handoff(st, 'mandou um audio: a Sherone nao responde a audios');
  if (st.step !== 'start' && /^\s*\[sticker\]\s*$/i.test(rawText)) return wait(st, 'mandou um sticker: nao responder');
  if (st.step !== 'start' && /\b(burr[oa]s?|estupid\w*|idiota\w*|merda|ladr(ao|oes|ona)|vigarist\w*|golpist\w*|otari\w*|palhac\w*|fod\w*|caralh\w*|cabr(ao|oes)|denunciar|policia)\b/.test(text)) {
    return handoff(stIn, `mensagem agressiva/queixa ("${rawText.trim().slice(0, 80)}"): uma pessoa da equipa responde`);
  }
  if (st.step !== 'start' && /(ignor\w* (todas |as |os )*(instruc|regras|ordens)|esquece (o guia|as instruc|tudo o que)|\bsystem\s*:|\bprompt\b|chat ?gpt|openai|\bmodo (admin|desenvolvedor|dev)\b)/.test(text)) {
    return handoff(stIn, `tentou manipular a IA ("${rawText.trim().slice(0, 80)}"): uma pessoa da equipa responde`);
  }
  if (st.step !== 'start' && /(https?:\/\/|www\.|bit\.ly)/.test(text)) {
    return handoff(stIn, `mandou um link ("${rawText.trim().slice(0, 80)}"): a equipa ve`);
  }
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
  if (/\[(image|imagem|video|document)\]/i.test(rawText)) {
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
  if (st.step === 'account_help' && (/\b(criei|ja esta|feito|consegui)\b/.test(text) || /^pronto\W*$/.test(text)) && !/\bnao\b/.test(text)) {
    return accountCreated(st, 'conseguiu criar a conta (Passo 1.5.5)');
  }
  // "Ja vou criar", "vou fazer agora": espera o print.
  if (st.step === 'account_help' && /\b(vou (criar|fazer|tentar|abrir|ver)|ja vou|vou ja|daqui a pouco|agora mesmo|ja (crio|faco))\b/.test(text) && !/\bnao\b/.test(text)) {
    return wait(st, 'vai criar a conta agora: esperar pelo print');
  }

  // A pagar e diz que vai pagar ja ("vou fazer agora", "ja vou mandar"): espera o comprovativo.
  if (st.step === 'paying' && u.intent !== 'ja_pagou' && u.intent !== 'sem_dinheiro'
      && /\b(vou (fazer|pagar|transferir|mandar|enviar)|ja (vou|faco|mando|transfiro|pago)|vou ja|daqui a pouco|ja ja|num instante|em breve)\b/.test(text)
      && !/\b(nao|amanha|semana|mes|depois|mais tarde|sexta|segunda|terca|quarta|quinta|sabado|domingo|quando receber|paguei|mandei|enviei|transferi|fiz)\b/.test(text)) {
    return wait(st, 'vai pagar agora: espera o comprovativo');
  }

  // Acesso activo (Fluxo 7): a meio do acesso e renovacao.
  if (st.step === 'active') return accessReply(st, u, text, rawText, isThanks);

  // Reactivacao ("Queres que te envie uma sugestao de rotina?"): a equipa responde.
  if (st.lastKey === 'reactivation') {
    if (isThanks && !/\bsim\b/.test(text)) return wait(st, 'agradeceu a reactivacao: nao e preciso responder');
    if (u.intent === 'nao' && !NOT_YES.test(text.replace(/^nao\b/, ''))) return wait(st, 'nao quer a sugestao de rotina (reactivacao)');
    return handoff(st, `respondeu a reactivacao ("${rawText.trim().slice(0, 80)}"): enviar a sugestao de rotina / retomar a conversa`);
  }

  // A pagar e diz quando consegue ("so no fim do mes", "amanha", "ainda nao tenho"):
  // resposta do guia e a data vai para a equipa; sem follow-up de pagamento.
  // Sem dinheiro e sem data ("nao tenho dinheiro"): Premio Embaixador.
  const payDate = /\b(amanha|depois de amanha|semana|mes|fim do mes|logo|mais tarde|sexta|segunda|terca|quarta|quinta|sabado|domingo|quando receber|vou pagar|meu pai|minha mae|meus pais|dia \d{1,2})\b/.test(text);
  // "Quando e que consegues fazer o pagamento?" -> "Hoje" / "Ainda hoje": sem
  // resposta; o 1.o follow-up vai na janela seguinte de hoje (guia v32).
  if (st.step === 'paying' && u.intent !== 'ja_pagou' && u.intent !== 'nao_abriu' && u.intent !== 'sem_dinheiro'
      && /^(so |ainda |e |vou pagar |pago |consigo )?(hoje|agora|ja ja|daqui a pouco|logo mais)( mesmo| ainda| a tarde| a noite| sim)?\W*$/.test(text)) {
    const at = payDayAt('hoje', new Date());
    return wait({ ...st, payFollow: { at: at!.toISOString(), sent: false, day: at!.toISOString() } }, 'diz que paga hoje: 1.o follow-up de pagamento amanha as 12h');
  }
  if (st.step === 'paying' && u.intent === 'sem_dinheiro' && !payDate) return noMoney(st, text);
  if (st.step === 'paying' && u.intent !== 'ja_pagou' && u.intent !== 'nao_abriu'
      && (u.intent === 'sem_dinheiro' || payDate || /\bainda nao\b/.test(text))) {
    // Guia v32: 1.o follow-up no dia que ele disse, a tarde; sem dia concreto, regras dos tiques.
    const day = payDayAt(text, new Date());
    const pf = day ? { at: day.toISOString(), sent: false, day: day.toISOString() } : { at: new Date().toISOString(), sent: false };
    const d = say('payLater', { ...st, payFollow: pf }, 'paying', 'diz quando consegue pagar ("JA DISSE QUANDO CONSIGO PAGAR")');
    d.notify = `diz quando consegue pagar${st.pkg ? ` o ${st.pkg}` : ''}: "${rawText.trim().slice(0, 100)}"`
      + (day ? ` (1.o follow-up ${day.toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', weekday: 'long', day: 'numeric', month: 'long' })}, as 12h)` : ' (sem dia concreto: follow-ups pelas regras dos tiques)');
    return d;
  }

  // "Quando podemos voltar a falar?" -> qualquer data/resposta vai para a equipa.
  if (st.step === 'followup' && st.lastKey === 'reguaNotNow' && !isThanks) {
    return handoff(st, `disse quando pode voltar a falar ("${rawText.trim().slice(0, 80)}"): registar a data e voltar a contactar`);
  }
  if (st.step === 'paying' && /@/.test(rawText)) {
    return handoff(st, `mandou o e-mail da conta (${rawText.trim().slice(0, 80)}): validar o pagamento e activar`);
  }
  // "Conseguiste fazer o pagamento?" -> "Sim" / "Ja": a equipa confirma.
  if (st.step === 'paying' && st.lastKey === 'payFollowup' && (u.intent === 'sim' || /^(ja|sim ja|ja sim|consegui|sim consegui)\b/.test(text)) && !NOT_YES.test(text)) {
    return handoff({ ...st, paidOnce: true }, `diz que ja pagou${st.pkg ? ` o ${st.pkg}` : ''} (resposta ao follow-up): confirmar o pagamento e activar o acesso`);
  }
  // Na conexao qualquer resposta serve ("falta de explicador", "nao percebo nada de quimica").
  const connAnswer = st.step === 'connection' && !/\?/.test(rawText)
    && ['horario_apoio', 'duvida', 'outro', 'nao_sei', 'muito_basico', 'telemovel_fraco'].includes(u.intent);
  // "Explica" a "queres que explique como activar?" e um sim.
  if (st.step === 'sn_activate' && /^(sim,? )?(explica|explique|podes explicar|pode explicar)\b/.test(text) && st.snCount && st.snMonths) {
    return choosePackage(st, st.snCount, st.snMonths, 'quer activar ("explica")');
  }

  // Premio Embaixador: "consegues fazer isso?" / "o que te impede?"
  if (st.step === 'ambassador' && (ambReason(text) || isThanks
      || ['sim', 'nao', 'sem_dinheiro', 'outro', 'nao_sei', 'telemovel_fraco', 'da_dados', 'saudacao', 'acha_caro', 'indicar_amigo', 'partilhar_conta'].includes(u.intent))) {
    return ambassador(st, u, text, isThanks);
  }

  // Respostas aos follow-ups por etapa (guia v31).
  // "Preferes estudar pelo telemovel ou pelo computador?" -> qualquer um e um sim ao online.
  if (st.step === 'ask_online' && st.lastKey === 'fuOnline2' && /\b(telem\w*|telefone|celular|cel|smartphone|computador|pc|portatil|laptop|tablet|os dois|ambos)\b/.test(text) && !/\bnao tenho\b/.test(text)) {
    return say('vaccineCommitment', st, 'ask_commitment', 'respondeu ao follow-up do online (telemovel/computador): vacina do compromisso (Passo 1.5.2)');
  }
  // "Em que passo ficaste: no site, no codigo do e-mail ou na escolha das disciplinas?"
  if (st.step === 'account_help' && st.lastKey === 'fuAccount1' && !/\?/.test(rawText)) {
    if (/\bcodigo|e-?mail|gmail|senha|palavra/.test(text)) return say('emailCode', st, 'account_help', 'ficou no codigo do e-mail (follow-up da conta)');
    if (/\b(site|link|pagina|abrir|abre|entrar)\b/.test(text)) return say('linkProblem', st, 'account_help', 'ficou no site (follow-up da conta)');
    if (/\bdisciplina/.test(text)) return handoff(st, 'ficou na escolha das disciplinas (follow-up da conta): a equipa ajuda');
  }
  // "Ainda estas a preparar o exame? Diz-me so o curso" -> "Ainda sim": pede o curso.
  if (st.step === 'diagnosis' && st.lastKey && /^fuCourse/.test(st.lastKey) && /^(ainda )?(sim|estou|claro|ok)( ainda| sim)?\W*$/.test(text)) {
    return diagnosisQuestion({ ...st, course: stIn.course }, 'respondeu ao follow-up do curso sem dizer o curso');
  }
  // "Queres fazer agora, comigo aqui?" -> passo a passo outra vez.
  if (st.step === 'account_help' && (st.lastKey === 'fuAccount2' || st.lastKey === 'fuAccount3') && (u.intent === 'sim' || u.intent === 'criar_conta')) {
    return say('accountHelp', st, 'account_help', 'quer criar a conta agora (follow-up da conta): passo a passo (Passo 1.5.4)');
  }
  // Follow-ups do pacote (2.1.1): "1 mes ou 2 meses?" / "com qual dos pacotes?"
  if (st.step === 'pdf_sent' && st.lastKey && ['fuPkg1', 'fuPkg2', 'fuPkg3'].includes(st.lastKey)) {
    if (u.snMonths && !u.pkg) {
      const count = st.snCount || examCount(st);
      if (count) return choosePackage(st, count, u.snMonths, `respondeu ao follow-up do pacote (${u.snMonths} ${u.snMonths === 1 ? 'mes' : 'meses'})`);
      return superNerd(st, 'respondeu ao follow-up do pacote com a duracao');
    }
    if (u.intent === 'sim' && !u.pkg) return say('askPackage', st, 'pdf_sent', 'respondeu ao follow-up do pacote: com qual vai ficar');
  }

  const obj = connAnswer ? null : objection(u, st, text);
  if (obj) return obj;

  // "Nao percebi": repete a ultima pergunta (uma vez).
  if (u.intent === 'nao_percebi' && !connAnswer) {
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
      // "O meu nome e Felizberto, ainda nao sei a universidade": o nome conta (intencao nao_sei).
      const progressed = (gotData || u.intent === 'nao_sei') && (st.name !== stIn.name || st.university !== stIn.university || st.course !== stIn.course);
      // "Claro" / "sim" / "ok" a "posso saber o teu nome?": pede so o que falta (uma vez).
      if (!progressed && (u.intent === 'sim' || isThanks) && !st.retries) {
        return diagnosisQuestion({ ...st, retries: 1 }, `respondeu "${rawText.trim().slice(0, 30)}" sem os dados: pede o que falta`);
      }
      if (!progressed) return repeatOrHandoff(st, `resposta nao trouxe o que foi perguntado (intencao ${u.intent})`);
      return diagnosisNext({ ...st, retries: 0 }, 'dados recebidos', !stIn.name && !!st.name);
    }

    case 'connection': {
      // Qualquer resposta serve. Guarda a dificuldade e a disciplina, para o
      // capitulo 1 (1.5.5).
      // So conta uma disciplina que sai no exame dele (editais 2026): um
      // estudante de Medicina que diz "Matematica" nao vai abrir Matematica.
      const exam = (examSubjects(st.university, st.course) || (st.examSubjects?.length ? st.examSubjects : null));
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
      if (u.intent === 'nao') return say('hesitant', withSlot(st, /\bhoje\b/.test(text)), 'pdf_sent', 'resposta hesitante ao compromisso: capitulo 1 sem conta e proximo contacto');
      return repeatOrHandoff(st, `resposta vaga ao compromisso (intencao ${u.intent})`);

    case 'pdf_sent': {
      // "Falamos amanha?" depois de hesitar / "agora nao"
      if (st.lastKey === 'hesitant' || st.lastKey === 'notNow') {
        if (u.intent === 'sim' || isThanks) return wait(st, 'aceitou falar depois: nao e preciso responder', { step: 'followup' });
      }
      // "Posso falar contigo amanha as 18h para me dizeres com qual pacote vais ficar?"
      if (st.lastKey === 'packagesPdf' && st.regua) {
        let tc = parseTimeChoice(rawText, st.offered);
        if (tc.kind === 'day_only' && !/\bnao\b/.test(text)) {
          const h = new Date(new Date(st.regua.startAt).getTime() + 2 * 3600_000).getUTCHours(); // hora de Maputo
          const t2 = parseTimeChoice(`${rawText} as ${h}h`, st.offered);
          if (t2.kind === 'slot' || t2.kind === 'out_of_hours') tc = { kind: 'slot', at: t2.at };
        }
        if (tc.kind === 'slot' && tc.at.toISOString() !== st.regua.startAt) {
          const label = slotLabel(tc.at);
          return wait(st, `combinou outro dia/hora para dizer o pacote (${label}): a regua conta a partir dai`,
            { regua: { startAt: tc.at.toISOString(), sent: 0 }, offered: [{ iso: tc.at.toISOString(), label }] });
        }
        if (u.intent === 'sim' || isThanks || tc.kind === 'slot') return wait(st, 'aceitou o dia combinado: a regua de follow-up conta a partir dai');
      }
      // A meio da regua (ou depois da despedida): "sim, ja decidi" -> qual pacote?
      if (st.lastKey && ['reguaContact1', 'reguaContact2', 'reguaFarewell', 'askPackage'].includes(st.lastKey)) {
        if (u.intent === 'sim' && st.lastKey !== 'askPackage') return say('askPackage', st, 'pdf_sent', 'respondeu a regua: com qual dos pacotes vai ficar');
        if (u.intent === 'sem_dinheiro') return noMoney(st, text);
        if (u.intent === 'nao') return say('reguaNotNow', st, 'followup', '"agora nao" na regua: agradecer e perguntar quando voltar a falar (Fluxo 6)');
        if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
      }
      if (u.intent === 'sim') return say('accountHelp', st, 'account_help', 'vai criar a conta: passo a passo (Passo 1.5.4)');
      if (u.intent === 'sem_dinheiro') return noMoney(st, text);
      if (u.intent === 'nao') return say('notNow', withSlot(st, /\bhoje\b/.test(text)), 'followup', 'agora nao: capitulo 1 gratis e proximo contacto');
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

    case 'ambassador':
      return ambassador(st, u, text, isThanks);

    case 'handoff':
      break;
  }

  return handoff(st, `mensagem fora do guia neste passo (${st.step}, intencao ${u.intent})`);
}

// ---- Estado -----------------------------------------------------------------
const KNOWN_STEPS: Step[] = ['active', 'start', 'diagnosis', 'connection', 'ask_online', 'ask_commitment', 'pdf_sent',
  'account_help', 'followup', 'sn_choice', 'sn_activate', 'paying', 'ambassador', 'handoff'];

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
      status: { notIn: ['DISCARDED', 'FAILED'] },
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

// Ultimas 8 mensagens antes das que estao por responder (dos dois lados,
// incluindo as da equipa), para o modelo perceber o contexto da conversa.
async function recentHistory(contactId: string): Promise<string[]> {
  const lastOut = await prisma.message.findFirst({
    where: { contactId, direction: 'OUTBOUND', isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!lastOut) return [];
  const rows = await prisma.message.findMany({
    where: { contactId, isInternal: false, createdAt: { lte: lastOut.createdAt } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { direction: true, content: true, type: true },
  });
  return rows.reverse().map((m) => {
    const body = (m.content || (m.type !== 'TEXT' ? `[${m.type}]` : '')).replace(/\s+/g, ' ').trim().slice(0, 220);
    return `${m.direction === 'INBOUND' ? 'Estudante' : 'Zona Nerd'}: ${body}`;
  }).filter((l) => !l.endsWith(': '));
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
    case 'ambassador': return 'se consegue partilhar o link de convite com 5 colegas (sim/nao) ou o motivo de nao conseguir';
    case 'active': return st.lastKey === 'accessMid' ? 'como esta a correr o estudo e em que capitulo esta'
      : st.lastKey === 'renewSame' ? 'se fica com o mesmo pacote ou se quer mudar'
      : 'se quer renovar o acesso (sim/nao/continuar)';
    default: return 'nada';
  }
}

// ---- Segunda opiniao (Gemini no Vertex) -----------------------------------------
// A Leiz responde sozinha quando uma regra testada reconheceu a mensagem. Quando
// o modelo local teve de adivinhar (intencao ou dados lidos so por ele), ou a
// conversa ia para a equipa sem uma regra, o motor calcula todas as respostas do
// guia possiveis nesta etapa e o Gemini escolhe a certa, ou passa a equipa.
const CANDIDATE_INTENTS: Intent[] = [
  'saudacao', 'da_dados', 'pergunta_preco', 'acha_caro', 'sem_dinheiro', 'prefere_presencial', 'problema_acesso',
  'problema_link', 'quer_pagar', 'ja_pagou', 'pagamento_seguro', 'vai_passar', 'muito_basico', 'horario_apoio',
  'telemovel_fraco', 'partilhar_conta', 'nao_percebi', 'desconfianca', 'nao_sei', 'sim', 'nao', 'duvida',
  'super_nerd', 'sem_chamada', 'outra_hora', 'vidas', 'instalar_app', 'problema_codigo', 'cobre_exame',
  'universidade_fora', 'pagar_outra_pessoa', 'indicar_amigo', 'nao_abriu', 'gratis', 'porque_pergunta', 'e_ia',
  'quer_agora', 'escolhe_pacote', 'criar_conta', 'conta_criada', 'gostou', 'esqueci_senha', 'trocar_disciplinas',
  'acesso_acabou', 'paguei_errado', 'como_funciona', 'outro',
];

export type SecondOpinion = {
  used: boolean;
  why: string;              // porque foi pedida
  choice?: number;          // opcao escolhida (0 = equipa, -1 = escreveu)
  options?: number;
  confidence?: string;
  motive?: string;
  usd?: number;
  ms?: number;
  error?: string;
  improvised?: string[];   // resposta escrita pelo Gemini
  rejected?: string;       // resposta escrita recusada pela verificacao
};

// Perguntas que a propria regra ja responde ("quanto custa?", "e seguro pagar?").
const QUESTION_INTENTS: Intent[] = [
  'pergunta_preco', 'duvida', 'como_funciona', 'pagamento_seguro', 'horario_apoio', 'cobre_exame', 'instalar_app',
  'gratis', 'porque_pergunta', 'e_ia', 'partilhar_conta', 'telemovel_fraco', 'vidas', 'problema_acesso', 'problema_link',
  'problema_codigo', 'esqueci_senha', 'super_nerd', 'universidade_fora', 'pagar_outra_pessoa', 'nao_percebi',
  'criar_conta', 'trocar_disciplinas', 'quer_pagar', 'escolhe_pacote', 'prefere_presencial', 'nao_abriu',
];

// A Leiz so responde sozinha quando tem a certeza: uma regra testada reconheceu
// uma mensagem curta e simples. Tudo o resto (devolve o motivo) vai ao Gemini.
export function needsSecondOpinion(st: LeizProState, u: Understanding, d: Decision, rawText: string): string | null {
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(rawText.replace(/\[(IMAGE|VIDEO|DOCUMENT|AUDIO)\]/g, ''))) return null; // so media/emoji
  if (d.action === 'wait') return null;
  if (['start', 'handoff'].includes(st.step)) return null;
  const modelFields = u.modelFields || [];
  if (modelFields.length) return `dados lidos so pelo modelo local (${modelFields.join(', ')})`;
  const words = rawText.trim().split(/\s+/).length;
  const question = rawText.includes('?');
  // Diagnostico: dados que as regras leram (nome, universidade, curso, disciplinas).
  if (st.step === 'diagnosis' && u.intent === 'da_dados' && !question && words <= 25) {
    const slot = slotFor(st);
    const missing = (slot === 'name' && !u.name) || (slot === 'university' && !u.university) || (slot === 'course' && !u.course);
    if (!missing) return null;
    return `o ${slot === 'name' ? 'nome' : slot === 'university' ? 'nome da universidade' : 'curso'} pedido nao foi lido pelas regras`;
  }
  // Uma regra mandou para a equipa (ja pagou, desconfianca...): a equipa ja trata.
  if (u.intentSource === 'rule' && d.action === 'handoff') return null;
  if (u.intentSource !== 'rule') {
    return d.action === 'handoff'
      ? `ia passar a equipa sem regra (${d.reason.slice(0, 80)})`
      : `intencao "${u.intent}" sem regra (leitura do modelo local)`;
  }
  // Regra, mas a mensagem pode ter mais do que a regra leu.
  if (words > 12) return `mensagem longa (${words} palavras) para a regra "${u.intent}"`;
  if (question && !QUESTION_INTENTS.includes(u.intent)) return `pergunta junto com "${u.intent}"`;
  if (/\b(mas|porem|so que|e se|tambem)\b/.test(norm(rawText)) && words > 4) return `resposta com condicao ("mas", "e se"...) para "${u.intent}"`;
  return null;
}

function optionText(d: Decision): string {
  if (d.action === 'handoff') return 'PASSAR A CONVERSA A EQUIPA (nao responder nada)';
  return d.parts.map((p) => (p.trim() === PDF_MARK ? '[envia o PDF dos pacotes]' : p)).join(' || ').replace(/\s+/g, ' ').slice(0, 900);
}

// Resposta escrita pelo Gemini quando nenhum texto do guia serve:
//   off      nunca escreve (so escolhe ou passa a equipa)
//   approve  escreve, mas fica a espera de aprovacao da equipa (por omissao)
//   auto     escreve e sai sozinha
export function improviseMode(): 'off' | 'approve' | 'auto' {
  const v = (process.env.LEIZPRO_IMPROVISE || '').trim().toLowerCase();
  return v === 'off' || v === 'auto' ? v : 'approve';
}

// Textos do guia que trazem factos (precos, pacotes, pagamento, plataforma, objecoes).
const FACT_KEYS: TemplateKey[] = [
  'priceFirst', 'connection', 'accountHelp', 'superNerdAsk', 'superNerdPrice', 'paymentChannels', 'expensive', 'paymentSafe',
  'friendReferral', 'coversExam', 'willIPass', 'noUniversity', 'weakPhone', 'shareAccount', 'payOtherPerson', 'lives',
  'accessProblem', 'emailCode', 'forgotPassword', 'changeSubjects', 'accessEnded', 'linkProblem', 'presencial', 'howOnline',
  'schedule', 'tooBasic', 'noMoney', 'ambYes', 'isFree', 'whyAsk',
];

// Sem dados do estudante: o texto fica igual em todas as chamadas e o Gemini
// guarda-o em cache (cobra so cerca de 10% dessa parte).
const factsCache = new WeakMap<object, string>();
function guideFacts(): string {
  const hit = factsCache.get(CUR);
  if (hit) return hit;
  const st: LeizProState = { ...INITIAL_STATE };
  const lines: string[] = [packagesTextParts(st).filter((p) => p.trim() !== PDF_MARK && !hasPlaceholders([p])).join(' ')];
  for (const k of FACT_KEYS) {
    if (!CUR[k]) continue;
    const parts = fill(CUR[k], st, vars(st)).filter((p) => p.trim() !== PDF_MARK && !hasPlaceholders([p]));
    if (parts.length) lines.push(parts.join(' '));
  }
  const out = lines.map((l) => `- ${l.replace(/\s+/g, ' ').trim()}`).join('\n');
  factsCache.set(CUR, out);
  return out;
}

// Verificacao da resposta escrita: so factos do guia, curta e a voltar a etapa.
const PROMISES = ['prestac', 'parcel', 'desconto', 'promoc', 'reembols', 'garanti', 'devolv', 'oferta', 'mukuru', 'transferencia internacional'];
export function checkImprovised(parts: string[], facts: string): string | null {
  if (!parts.length || parts.length > 3) return 'tem de ter 1 a 3 mensagens';
  if (parts.some((p) => p.length > 450) || parts.join(' ').length > 900) return 'texto demasiado longo';
  if (hasPlaceholders(parts) || /[[\]{}<>]/.test(parts.join(' '))) return 'campos por preencher';
  const all = parts.join(' ');
  const factDigits = facts.replace(/(\d)[\s.](?=\d)/g, '$1');
  for (const m of all.replace(/(\d)[\s.](?=\d)/g, '$1').matchAll(/\d{2,}/g)) {
    if (!factDigits.includes(m[0])) return `numero que nao esta no guia (${m[0]})`;
  }
  for (const m of all.matchAll(/\b[\w-]+\.(com|co\.mz|net|org|io|app)\b\S*/gi)) {
    if (!facts.toLowerCase().includes(m[0].toLowerCase().replace(/[.,;!?)]+$/, ''))) return `link que nao esta no guia (${m[0]})`;
  }
  const nAll = norm(all);
  const nFacts = norm(facts);
  for (const w of PROMISES) if (nAll.includes(w) && !nFacts.includes(w)) return `promessa fora do guia ("${w}")`;
  if (/(?<!\d)8[2-7]\d{6}(?!\d)/.test(all)) return 'numero de 8 digitos';
  if (!parts[parts.length - 1].includes('?')) return 'nao termina com a pergunta da etapa';
  return null;
}

const SO_SYSTEM = [
  'Es a supervisora da Sherone, assistente de vendas da Zona Nerd (explicacoes online para exames de admissao em Mocambique).',
  'Recebes a conversa, a mensagem nova do estudante e uma lista numerada de respostas possiveis, todas tiradas do guia oficial.',
  'Escolhe a resposta que responde de forma certa e natural a mensagem nova, no ponto em que a conversa esta.',
  'Prefere respostas que seguem a etapa actual; nao saltes para vender o Super Nerd ou outro pacote se o estudante nao pediu.',
  'Escolhe 0 (passar a equipa) quando ha comprovativo ou problema de pagamento que so a equipa confirma, pagamento para o numero errado,',
  'reclamacao, desconfianca (burla, golpe), pedido para falar com uma pessoa, ou assunto que os factos do guia nao respondem.',
  'Indica tambem os dados do estudante que a mensagem nova disser (so palavras que estao la; senao null).',
].join(' ');

const SO_PICK_ONLY = 'Nunca inventes texto. Responde SO com JSON: {"opcao": numero, "confianca": "alta"|"media"|"baixa", "nome": texto|null, "universidade": texto|null, "curso": texto|null, "motivo": "uma frase curta"}.';

const SO_WRITE = [
  'Se nenhuma resposta da lista serve, mas a duvida tem resposta nos FACTOS DO GUIA, usa a opcao "E" e escreve a resposta em "resposta":',
  'uma lista de 1 a 3 mensagens curtas de WhatsApp, em portugues de Mocambique, tratando por tu, no tom da Sherone (simpatica, directa, um emoji no maximo).',
  'Primeiro responde a duvida usando SO os factos do guia; depois volta a conversa ao ponto em que estava, terminando com a pergunta da etapa.',
  'Nunca prometas prestacoes, descontos, outros meios de pagamento, prazos, garantias ou qualquer coisa que nao esteja nos factos: nesse caso escolhe 0.',
  'Nao escrevas numeros, precos ou links que nao estejam nos factos. Nao acrescentes opinioes nem detalhes que nao estejam nos factos.',
  'Usa "E" SO quando NENHUMA resposta da lista responde ao que o estudante disse: uma resposta da lista aceitavel e sempre melhor do que escrever.',
  'No diagnostico (quando pedimos nome, universidade ou curso) nunca escrevas: escolhe da lista e indica os dados lidos.',
  'Responde SO com JSON: {"opcao": numero ou "E", "resposta": [texto, ...] (so com "E"), "confianca": "alta"|"media"|"baixa", "nome": texto|null, "universidade": texto|null, "curso": texto|null, "motivo": "uma frase curta"}.',
].join(' ');

export async function secondOpinion(st: LeizProState, u: Understanding, d: Decision, rawText: string, history: string[], why: string):
  Promise<{ d: Decision; so: SecondOpinion }> {
  const so: SecondOpinion = { used: false, why };
  const write = improviseMode() !== 'off';
  // Todas as respostas possiveis nesta etapa (o motor e deterministico).
  const options: { d: Decision; intent: Intent | null }[] = [];
  const seen = new Set<string>();
  const cands: { d: Decision | null; intent: Intent | null }[] = [{ d, intent: null }, ...CANDIDATE_INTENTS.map((i) => {
    try { return { d: decide(st, { ...u, intent: i, intentSource: 'model' }, rawText), intent: i }; } catch { return { d: null, intent: i }; }
  })];
  for (const c of cands) {
    if (!c.d || c.d.action === 'handoff' || c.d.action === 'wait' || hasPlaceholders(c.d.parts)) continue;
    const key = optionText(c.d);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ d: c.d, intent: c.intent ?? (u.intent as Intent) });
  }
  so.options = options.length;
  if (!options.length && !write) return { d, so };
  const facts = write ? guideFacts() : '';
  const stepQuestion = lastQuestionText(st);
  const prompt = [
    `Etapa: a equipa acabou de perguntar ${expectingFor(st)}.`,
    stepQuestion ? `Pergunta da etapa (para voltar a ela): ${stepQuestion}` : '',
    `Dados que ja temos: nome=${st.name || '?'}, universidade=${st.university || '?'}, curso=${st.course || '?'}, pacote=${st.pkg || '?'}.`,
    history.length ? `Conversa (da mais antiga para a mais recente):\n${history.join('\n')}` : 'Sem conversa anterior.',
    `Mensagem nova do estudante:\n${rawText.slice(0, 1200)}`,
    'Respostas possiveis:',
    '0. PASSAR A CONVERSA A EQUIPA (nao responder nada)',
    ...options.map((o, i) => `${i + 1}. ${optionText(o.d)}`),
    write ? 'E. ESCREVER uma resposta curta com os factos do guia e voltar a etapa' : '',
  ].filter(Boolean).join('\n');
  try {
    // Instrucoes e factos primeiro e sempre iguais (cache implicita do Gemini).
    const system = write ? `${SO_SYSTEM} ${SO_WRITE}\n\nFACTOS DO GUIA (unica fonte para escrever):\n${facts}` : `${SO_SYSTEM} ${SO_PICK_ONLY}`;
    const r = await askVertex(system, prompt);
    so.used = true;
    so.usd = r.usd;
    so.ms = r.ms;
    so.confidence = String(r.json?.confianca || '');
    so.motive = String(r.json?.motivo || '').slice(0, 200);
    const raw = r.json?.opcao;
    // Diagnostico: o guia conduz. Os dados que o Gemini leu (e as regras nao)
    // entram no motor, que faz a pergunta seguinte do guia.
    if (st.step === 'diagnosis' && String(raw) !== '0' && so.confidence !== 'baixa') {
      const name = u.name || validName(presentIn(r.json?.nome, rawText));
      const uni = u.university || presentIn(r.json?.universidade, rawText);
      const course = u.course || (presentIn(r.json?.curso, rawText) ? titleCase(presentIn(r.json?.curso, rawText)!) : null);
      if (name !== u.name || uni !== u.university || course !== u.course) {
        const re = decide(st, { ...u, name, university: uni, course, intent: 'da_dados', intentSource: 'model' }, rawText);
        if (re.action !== 'wait' && (re.action === 'handoff' || !hasPlaceholders(re.parts))) {
          so.choice = Number(raw) || 0;
          return { d: { ...re, reason: `${re.reason} [Gemini leu os dados: ${so.motive}]` }, so };
        }
      }
    }
    if (write && String(raw).trim().toUpperCase() === 'E') {
      so.choice = -1;
      const parts = (Array.isArray(r.json?.resposta) ? r.json.resposta : [r.json?.resposta])
        .map((p: unknown) => String(p ?? '').trim()).filter(Boolean);
      const bad = so.confidence === 'baixa' ? 'confianca baixa' : checkImprovised(parts, facts);
      if (bad) {
        so.rejected = bad;
        return { d: handoff(st, `a supervisora (Gemini) escreveu uma resposta que nao passou na verificacao (${bad}): ${so.motive || 'sem motivo'}`), so };
      }
      so.improvised = parts;
      return {
        d: {
          action: 'send_text',
          parts,
          next: { ...st },   // fica na mesma etapa: a resposta volta a pergunta dela
          reason: `resposta escrita pelo Gemini com os factos do guia [${so.confidence}: ${so.motive}]`,
          improvised: true,
        },
        so,
      };
    }
    const n = Number(raw);
    so.choice = Number.isInteger(n) && n >= 0 && n <= options.length ? n : 0;
    if (so.choice === 0 || so.confidence === 'baixa') {
      return { d: handoff(st, `a supervisora (Gemini) achou melhor a equipa responder: ${so.motive || 'sem motivo'}`), so };
    }
    const pick = options[so.choice - 1];
    let chosen = pick.d;
    // Dados que so o modelo local leu: valem os do Gemini (se estiverem na mensagem).
    // Dados que so o modelo local leu valem os do Gemini; os que faltam, o Gemini preenche
    // (se estiverem na mensagem).
    const mf = u.modelFields || [];
    {
      const name = validName(presentIn(r.json?.nome, rawText));
      const uni = presentIn(r.json?.universidade, rawText);
      const course = presentIn(r.json?.curso, rawText);
      const pickField = (k: string, mine: string | null, g: string | null) => (mf.includes(k) ? g : mine || g);
      const fixed: Understanding = {
        ...u,
        name: pickField('name', u.name, name),
        university: pickField('university', u.university, uni),
        course: pickField('course', u.course, course ? titleCase(course) : null),
      };
      if (fixed.name !== u.name || fixed.university !== u.university || fixed.course !== u.course) {
        const re = decide(st, { ...fixed, intent: pick.intent || u.intent, intentSource: 'model' }, rawText);
        if (re.action === 'handoff' || re.action === 'wait' || !hasPlaceholders(re.parts)) chosen = re;
      }
    }
    return { d: { ...chosen, reason: `${chosen.reason} [Gemini: opcao ${so.choice}/${options.length}, ${so.confidence}: ${so.motive}]` }, so };
  } catch (e: any) {
    so.error = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 200);
    return { d, so };
  }
}

// Uma volta completa (compreensao + decisao + verificacao). Exportada para o
// simulador de testes (scripts/leizProSimulate.ts) usar exactamente o mesmo caminho.
export async function runTurn(state: LeizProState, text: string, workspaceId?: string, history: string[] = []) {
  CUR = workspaceId ? await loadTexts(workspaceId) : T;
  const decideChecked = (uu: Understanding): Decision => {
    const dd = decide(state, uu, text);
    return dd.action !== 'handoff' && dd.action !== 'wait' && hasPlaceholders(dd.parts)
      ? handoff(state, 'a resposta ficou com campos por preencher') : dd;
  };
  // Com o Gemini ligado, as regras leem primeiro: se tiverem a certeza a Leiz
  // responde logo; senao vai directo ao Gemini. O modelo local (qwen) so e
  // chamado se o Gemini falhar. Sem Gemini, tudo como antes.
  const gemini = vertexEnabled();
  let u = await understand(text, expectingFor(state), slotFor(state), history, { skipModel: gemini });
  let d = decideChecked(u);
  let so: SecondOpinion | null = null;
  const why = needsSecondOpinion(state, u, d, text);
  if (why) {
    if (gemini) {
      ({ d, so } = await secondOpinion(state, u, d, text, history, why));
      if (!so.used) {
        // Gemini indisponivel (ou sem opcoes): le com o modelo local, como antes.
        u = await understand(text, expectingFor(state), slotFor(state), history);
        d = decideChecked(u);
      }
    } else so = { used: false, why };   // so registado (para medir quantas iriam)
  }
  // A regua so continua enquanto ele esta a decidir o pacote (pdf_sent).
  if (d.next.step !== 'pdf_sent') d.next = { ...d.next, regua: null };
  // O follow-up de pagamento so existe enquanto ele esta a pagar.
  if (d.next.step !== 'paying') d.next = { ...d.next, payFollow: null };
  // Respondeu: os follow-ups da etapa recomecam do zero (na etapa onde ficar).
  d.next = { ...d.next, fu: null };
  return { u, d, so };
}

// ---- Acesso activo (guia v34, Fluxo 7) -----------------------------------------
// Textos do workspace (editados no painel) para o agendador.
export async function loadTextsFor(workspaceId: string): Promise<void> {
  CUR = await loadTexts(workspaceId);
}

function accessVars(st: LeizProState): Record<string, string> {
  const a = st.access;
  const subj = a?.subjects || (st.examSubjects?.length ? st.examSubjects.join(' e ') : '');
  const fim = a ? new Date(a.end).toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', day: 'numeric', month: 'long' }) : '';
  return { disciplinas: subj, data_fim: fim, pacote: st.pkg ? st.pkg.replace(/\s*\(.*\)$/, '') : '' };
}

// Mensagem do acompanhamento (a meio / renovacao), para o agendador.
export function accessTurn(st: LeizProState, key: AccessKey): { parts: string[]; next: LeizProState } {
  const a = st.access!;
  const parts = fill(CUR[key], st, { ...vars(st), ...accessVars(st) });
  const access: Access = key === 'accessMid' ? { ...a, mid: true }
    : key === 'renew1' ? { ...a, mid: true, renew: 1, renewAt: new Date().toISOString() }
    : { ...a, mid: true, renew: 2 };
  return { parts, next: { ...st, step: 'active', access, lastKey: key, lastQuestion: key, retries: 0, fu: null, regua: null, payFollow: null } };
}

function accessReply(st: LeizProState, u: Understanding, text: string, rawText: string, isThanks: boolean): Decision {
  const k = st.lastKey;
  const quote = rawText.trim().slice(0, 80);
  const left = st.access ? daysLeft(st.access) : null;
  if (k === 'accessMid') {
    // Dificuldade num tema: acompanhamento pelo WhatsApp (equipa).
    if (/\b(dificuldade|dificil|custa|nao (percebo|entendo|consigo perceber)|ajuda|duvida|duvidas)\b/.test(text)) {
      return handoff(st, `a meio do acesso, diz que tem dificuldade ("${quote}"): encaminhar para o acompanhamento pelo WhatsApp`);
    }
    // Atrasado: a resposta precisa de N capitulos em falta (a equipa calcula).
    if (/\b(atrasad\w*|ainda nao comecei|nao comecei|nem comecei|parad\w*|pouco|devagar|nao (tenho|estou a) (estudado|estudar|conseguir)|sem tempo|mal)\b/.test(text) || NOT_YES.test(text) && !/\bbem\b/.test(text)) {
      return handoff(st, `a meio do acesso, esta atrasado ("${quote}")${left !== null ? `; faltam ${left} dias` : ''}: responder com "Se ele estiver atrasado" do Fluxo 7 (N capitulos em falta, N/X por dia)`);
    }
    if (/\b(bem|bom|boa|otimo|optimo|excelente|tranquilo|no ritmo|a correr bem|tudo certo|quase|terminei|acabei|ja vou no|adiantad\w*)\b/.test(text)) {
      return say('accessGood', st, 'active', 'a meio do acesso: esta bem encaminhado');
    }
    if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
    // So o capitulo ("estou no capitulo 4"): sem o total de capitulos nao se sabe o ritmo.
    return handoff(st, `a meio do acesso respondeu "${quote}"${left !== null ? ` (faltam ${left} dias)` : ''}: ver se esta no ritmo e responder com a mensagem do Fluxo 7`);
  }
  if (k === 'accessGood') {
    if (isThanks || u.intent === 'sim') return wait(st, 'agradeceu: nao e preciso responder');
    return handoff(st, `depois do contacto a meio do acesso: "${quote}"`);
  }
  if (k === 'renew1' || k === 'renew2') {
    // "Nao quero", "agora nao": nao renova (antes do "quero").
    if (/^(nao|agora nao|ainda nao|por agora nao)\b/.test(text) && u.intent !== 'sem_dinheiro') {
      return isThanks || u.intent === 'nao' || /^nao\W*$|\bnao (quero|vou|obrigad\w*)\b/.test(text)
        ? wait(st, 'nao quer renovar agora: entra na Reactivacao') : handoff(st, `respondeu a renovacao ("${quote}")`);
    }
    if (/\b(continuar|continua|renovar|renovo|quero|manda|mande|envia|opcoes|bora|siga)\b/.test(text) || (u.intent === 'sim' && !NOT_YES.test(text))) {
      if (st.pkg && st.snCount && st.snMonths) return say('renewSame', st, 'active', 'quer renovar: mesmo pacote ou mudar?', accessVars(st));
      return sendPackages({ ...st, step: 'active' }, 'quer renovar (pacote anterior desconhecido): envia os pacotes');
    }
    if (u.intent === 'sem_dinheiro') return noMoney(st, text);
    if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
    if (u.intent === 'nao') return wait(st, 'nao quer renovar agora: entra na Reactivacao');
    return handoff(st, `respondeu a renovacao ("${quote}")`);
  }
  if (k === 'renewSame') {
    if (/\b(mudar|muda|outro|outra|trocar|troca|diferente|mais disciplinas|menos)\b/.test(text)) {
      return sendPackages({ ...st, step: 'active' }, 'quer renovar com outro pacote: envia os pacotes');
    }
    if (/\b(mesmo|igual|esse|este|manter|mantenho|o mesmo)\b/.test(text) || (u.intent === 'sim' && !NOT_YES.test(text))) {
      return choosePackage(st, st.snCount!, st.snMonths!, 'renova com o mesmo pacote');
    }
    if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
    return handoff(st, `respondeu a "mesmo pacote ou mudar?" ("${quote}")`);
  }
  // Fora das mensagens do acompanhamento (ex.: escreveu depois das boas-vindas): a equipa responde.
  if (isThanks) return wait(st, 'agradeceu: nao e preciso responder');
  return handoff(st, `tem o acesso activo e escreveu "${quote}"`);
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

// ---- Follow-ups por etapa (guia v31) --------------------------------------------
// Cada etapa tem 3 follow-ups quando o estudante deixa de responder; a hora sai
// dos tiques do WhatsApp (fuTiming.ts). Depois do 3.o, a Reactivacao. Se ele
// responder, runTurn limpa `fu` e a conversa continua na etapa onde parou.
export type FuStage = 'course' | 'connection' | 'online' | 'commit' | 'account' | 'package' | 'pay' | 'amb' | 'ambNo';
export const FU_KEYS: Record<FuStage, [TemplateKey, TemplateKey, TemplateKey]> = {
  course: ['fuCourse1', 'fuCourse2', 'fuCourse3'],
  connection: ['fuConn1', 'fuConn2', 'fuConn3'],
  online: ['fuOnline1', 'fuOnline2', 'fuOnline3'],
  commit: ['fuCommit1', 'fuCommit2', 'fuCommit3'],
  account: ['fuAccount1', 'fuAccount2', 'fuAccount3'],
  package: ['fuPkg1', 'fuPkg2', 'fuPkg3'],
  pay: ['payFollowup', 'fuPay2', 'fuPay3'],
  amb: ['fuAmb1', 'fuAmb2', 'fuAmb3'],
  ambNo: ['fuAmbNo1', 'fuAmbNo2', 'fuAmbNo3'],
};
const FU_LABEL: Record<FuStage, string> = {
  course: 'Etapa 1.3 (curso)', connection: 'Etapa 1.4 (dificuldade)', online: 'Etapa 1.5.1 (online)',
  commit: 'Etapa 1.5.2 (compromisso)', account: 'Etapa 1.5.4 (criar a conta)', package: 'Etapa 2.1.1 (escolher o pacote)',
  pay: 'Etapa 3.2 (pagamento)', amb: 'Premio Embaixador ("consegues fazer isso?")', ambNo: 'Premio Embaixador ("o que te impede?")',
};

function examCount(st: LeizProState): number | null {
  const exam = examSubjects(st.university, st.course) || (st.examSubjects?.length ? st.examSubjects : null);
  return exam?.length || null;
}

// Etapa de follow-up em que o estudante esta (null = sem follow-up por etapa).
export function fuStageOf(st: LeizProState): FuStage | null {
  if (st.fu?.stage) return st.fu.stage;
  switch (st.step) {
    case 'diagnosis': return st.name && st.university && !st.course ? 'course' : null;
    case 'connection': return 'connection';
    case 'ask_online': return 'online';
    case 'ask_commitment': return 'commit';
    case 'account_help': return 'account';
    // Depois dos pacotes e a regua (Fluxo 6); "com qual dos pacotes?" fora da regua e a etapa 2.1.1.
    case 'pdf_sent': return st.lastQuestion && ['liked', 'askPackage'].includes(st.lastQuestion) && !(st.regua && st.regua.sent < REGUA_DAYS.length) ? 'package' : null;
    case 'paying': return st.payFollow?.skip ? null : 'pay';
    case 'ambassador': return st.lastQuestion === 'noMoney' ? 'amb' : st.lastQuestion === 'ambNo' ? 'ambNo' : null;
    default: return null;
  }
}

// "Bom dia" do guia conforme a hora de envio (os envios sao das 12h as 20h).
function greetingFor(parts: string[], at: Date): string[] {
  const h = new Date(at.getTime() + 2 * 3600_000).getUTCHours();
  const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  return parts.map((p, i) => (i === 0 ? p.replace(/^Bom dia\b/, g) : p));
}

function fuVars(st: LeizProState): Record<string, string> {
  const n = st.snCount || examCount(st);
  return {
    ...vars(st),
    universidade: st.university || 'universidade',
    curso: st.course ? courseName(st.course) : 'o teu curso',
    n_disciplinas: n ? (n === 1 ? '1 disciplina' : `${n} disciplinas`) : 'as tuas disciplinas',
    pacote: st.pkg || 'pacote',
  };
}

// Texto e estado do proximo follow-up da etapa (sem base de dados; os testes usam-no).
export function fuTurn(st: LeizProState, kind: 'fu' | 'last' | 'reactivation', at = new Date(), texts?: Texts):
  { key: TemplateKey; parts: string[]; next: LeizProState; fuVars: Record<string, string> } | null {
  if (texts) CUR = texts;
  const stage = fuStageOf(st);
  if (!stage) return null;
  const n = st.fu?.n ?? 0;
  if (n >= 4) return null;
  const key: TemplateKey = kind === 'reactivation' ? 'reactivation' : kind === 'last' ? FU_KEYS[stage][2] : FU_KEYS[stage][Math.min(n, 2)];
  const sent = kind === 'reactivation' ? 4 : kind === 'last' ? 3 : n + 1;
  const v = fuVars(st);
  const parts = greetingFor(fill(CUR[key], st, v), at);
  const next: LeizProState = {
    ...st, fu: { stage, n: sent }, lastKey: key, lastQuestion: key, retries: 0,
    ...(stage === 'pay' && st.payFollow ? { payFollow: { ...st.payFollow, sent: true } } : {}),
  };
  return { key, parts, next, fuVars: v };
}

// So se usa quando os tiques chegam ao Klaru: sem eles (webhook sem estados)
// tratamos "enviado" como entregue e "visto" ao fim de 24 horas.
let ticksCache: { at: number; ws: Map<string, boolean> } = { at: 0, ws: new Map() };
async function ticksWork(workspaceId: string): Promise<boolean> {
  if (Date.now() - ticksCache.at > 10 * 60_000) ticksCache = { at: Date.now(), ws: new Map() };
  if (ticksCache.ws.has(workspaceId)) return ticksCache.ws.get(workspaceId)!;
  const hit = await prisma.message.findFirst({
    where: { direction: 'OUTBOUND', status: { in: ['DELIVERED', 'READ'] }, createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) }, contact: { workspaceId } },
    select: { id: true },
  });
  ticksCache.ws.set(workspaceId, !!hit);
  return !!hit;
}

// Gera o follow-up da etapa quando chega a hora (chamado pelo agendador).
// Em modo supervisionado fica PENDING (sugestao para aprovar).
export async function generateLeizProStageFollowup(opts: { workspaceId: string; contactId: string; leadId?: string | null }) {
  const st = await loadState(opts.workspaceId, opts.contactId);
  if (st.step === 'handoff' || !fuStageOf(st)) return null;
  const lastOut = await prisma.message.findFirst({
    where: { contactId: opts.contactId, direction: 'OUTBOUND', isInternal: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, createdAt: true, deliveredAt: true, readAt: true },
  });
  if (!lastOut) return null;
  // A ultima mensagem foi escrita pela equipa: ela e que acompanha.
  if (await teamTookOver(opts.contactId)) return null;
  const followupKey = `etapa:${lastOut.id}`;
  const exists = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId: opts.contactId, actionPayload: { path: ['followupKey'], equals: followupKey } }, select: { id: true },
  });
  if (exists) return null; // ja gerado (ou descartado pela equipa: parar)

  const works = await ticksWork(opts.workspaceId);
  const anyRead = works ? await prisma.message.findFirst({ where: { contactId: opts.contactId, direction: 'OUTBOUND', status: 'READ' }, select: { id: true } }) : null;
  const inbound = await prisma.message.count({ where: { contactId: opts.contactId, direction: 'INBOUND', isInternal: false } });
  const { fuDue } = await import('./fuTiming');
  const stage0 = fuStageOf(st);
  const payDay = stage0 === 'pay' && (st.fu?.n ?? 0) === 0 && st.payFollow?.day ? new Date(st.payFollow.day) : null;
  const due = payDay ? { at: payDay, kind: 'fu' as const, why: 'dia que disse que pagava (guia v32)' } : fuDue({
    sent: st.fu?.n ?? 0,
    last: {
      status: (works ? lastOut.status : (lastOut.status === 'SENT' ? 'DELIVERED' : lastOut.status)) as any,
      createdAt: lastOut.createdAt, deliveredAt: lastOut.deliveredAt, readAt: lastOut.readAt,
    },
    receiptsOff: !works || (!anyRead && inbound >= 2),
    ...(stage0 === 'pay' ? { pace: 'pay' as const } : {}),
  });
  if (!due || due.at.getTime() > Date.now()) return null;

  CUR = await loadTexts(opts.workspaceId);
  const t = fuTurn(st, due.kind, new Date());
  if (!t || hasPlaceholders(t.parts)) return null;
  const stage = fuStageOf(st)!;
  const suggestion = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      parts: t.parts as any,
      action: 'send_text',
      productFileIds: [] as any,
      actionPayload: { leizpro: t.next, followupKey, fuKey: t.key, fuVars: t.fuVars, fuAt: new Date().toISOString() } as any,
      reasoning: due.kind === 'reactivation'
        ? `Reactivacao: 3 follow-ups sem resposta na ${FU_LABEL[stage]}; ${due.why}.`
        : `Follow-up por etapa, ${FU_LABEL[stage]}: ${t.next.fu!.n} de 3 (${due.why}).`,
      principlesUsed: [] as any,
      modelUsed: stage === 'pay' ? 'leizpro:pagamento' : 'leizpro:etapa',
      status: 'PENDING',
    },
  });
  await syncStage(opts.workspaceId, opts.contactId, t.next);
  return suggestion;
}

// "Licenciatura em lingua francesa" -> "Lingua francesa"
function courseName(c: string): string {
  const t = c.replace(/^(licenciatura|curso|lic\.?)\s+(em|de)\s+/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Contacto 1 (modelo da Deise): variante e campos conforme o curso dele.
// Contexto para a regua: curso e disciplinas do exame (editais ou o que ele
// disse). Sem isto a regua nao e enviada (a equipa recebe um aviso).
export function reguaContext(st: LeizProState): { course: string; subjects: string[] } | null {
  if (!st.course) return null;
  const opts = examOptions(st.university, st.course);
  const subjects = opts && opts[0].length ? opts[0].slice(0, 2) : (st.examSubjects || []);
  return subjects.length ? { course: st.course, subjects } : null;
}

function joinE(list: string[]): string {
  return list.length <= 1 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

function reguaContact1(st: LeizProState): { key: TemplateKey; vars: Record<string, string> } {
  const ctx = reguaContext(st)!;
  const subs = ctx.subjects;
  const disciplina = st.hardSubject && subs.includes(st.hardSubject) ? st.hardSubject : subs[subs.length - 1];
  return {
    key: 'reguaContact1',
    vars: { curso: courseName(ctx.course), pacote: packageLabel(subs.length, 2), disciplinas: joinE(subs), duracao: '2 meses', disciplina },
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

// Depois de editar os textos no painel: reescreve com o texto novo os
// follow-ups (regua e pagamento) que ainda estao por aprovar no Inbox.
export async function refreshPendingFollowups(workspaceId: string): Promise<number> {
  const rows = await prisma.aiSalesSuggestion.findMany({
    where: { workspaceId, status: 'PENDING', modelUsed: { in: ['leizpro:regua', 'leizpro:pagamento', 'leizpro:etapa'] } },
    select: { id: true, modelUsed: true, actionPayload: true },
    take: 500,
  });
  if (!rows.length) return 0;
  CUR = await loadTexts(workspaceId);
  let n = 0;
  for (const r of rows) {
    const next = (r.actionPayload as any)?.leizpro as LeizProState | undefined;
    if (!next) continue;
    let parts: string[];
    if (r.modelUsed === 'leizpro:regua') {
      if (!next.regua || next.regua.sent < 1) continue;
      const prev: LeizProState = { ...INITIAL_STATE, ...next, regua: { ...next.regua, sent: next.regua.sent - 1 } };
      parts = reguaTurn(prev).parts;
    } else {
      const p = r.actionPayload as any;
      const key = (p?.fuKey && p.fuKey in T ? p.fuKey : 'payFollowup') as TemplateKey;
      parts = greetingFor(fill(CUR[key], next, p?.fuVars || { ...vars(next), pacote: next.pkg || 'pacote' }), p?.fuAt ? new Date(p.fuAt) : new Date());
    }
    if (hasPlaceholders(parts)) continue;
    await prisma.aiSalesSuggestion.update({ where: { id: r.id }, data: { parts: parts as any } });
    n += 1;
  }
  return n;
}

// Aviso (uma vez por regua): nao fez o follow-up por falta de curso/disciplinas.
async function warnNoReguaContext(workspaceId: string, contactId: string, leadId: string | null, st: LeizProState, ctxState: LeizProState) {
  if (!st.regua) return;
  const skipKey = `${st.regua.startAt}#sem-contexto`;
  const warned = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId, actionPayload: { path: ['followupKey'], equals: skipKey } }, select: { id: true },
  });
  if (warned) return;
  const why = !ctxState.course
    ? 'nao sei o curso do estudante'
    : `o curso "${ctxState.course}" nao esta nos editais e o estudante nao disse as disciplinas do exame`;
  const notify = `nao fiz o follow-up da regua porque ${why}. Diz-me o curso e as disciplinas, ou faz o follow-up a mao.`;
  const rec = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId, contactId, leadId,
      parts: [] as any, action: 'wait', productFileIds: [] as any,
      actionPayload: { leizpro: { ...st, regua: null }, followupKey: skipKey, notify } as any,
      reasoning: `Regua de follow-up nao enviada: ${why}.`,
      principlesUsed: [] as any, modelUsed: 'leizpro:regua-sem-contexto', status: 'APPROVED', decidedAt: new Date(),
    },
  });
  await notifyHandoff(workspaceId, contactId, rec).catch(() => {});
  await syncStage(workspaceId, contactId, { ...st, regua: null });
}

// Limpeza (agendador): follow-ups da regua por aprovar, feitos antes desta
// regra, sem curso/disciplinas -> descartados e aviso a equipa; com contexto
// encontrado nas mensagens -> reescritos com o texto completo.
export async function cleanupPendingReguaWithoutContext(): Promise<number> {
  const rows = await prisma.aiSalesSuggestion.findMany({
    where: { status: 'PENDING', modelUsed: 'leizpro:regua' },
    select: { id: true, workspaceId: true, contactId: true, leadId: true, actionPayload: true },
    take: 500,
  });
  let n = 0;
  for (const r of rows) {
    const next = (r.actionPayload as any)?.leizpro as LeizProState | undefined;
    if (!next?.regua) continue;
    const prev: LeizProState = { ...INITIAL_STATE, ...next, regua: { ...next.regua, sent: Math.max(0, next.regua.sent - 1) } };
    if (reguaContext(prev)) continue;
    const ctx = await contextFromMessages(r.contactId, prev);
    if (reguaContext(ctx)) {
      CUR = await loadTexts(r.workspaceId);
      const { parts, next: n2 } = reguaTurn(ctx);
      if (!hasPlaceholders(parts)) {
        await prisma.aiSalesSuggestion.update({
          where: { id: r.id },
          data: { parts: parts as any, actionPayload: { ...(r.actionPayload as any), leizpro: { ...n2, course: ctx.course, examSubjects: ctx.examSubjects } } as any },
        });
      }
      continue;
    }
    await prisma.aiSalesSuggestion.update({
      where: { id: r.id },
      data: { status: 'DISCARDED', decidedAt: new Date(), reasoning: 'Descartada: follow-up da regua sem curso/disciplinas conhecidos (regra nova).' },
    });
    await warnNoReguaContext(r.workspaceId, r.contactId, r.leadId, prev, ctx);
    n += 1;
  }
  return n;
}

async function contextFromMessages(contactId: string, st: LeizProState): Promise<LeizProState> {
  const all = await prisma.message.findMany({
    where: { contactId, isInternal: false, type: 'TEXT' },
    orderBy: { createdAt: 'asc' }, take: 80, select: { content: true, direction: true },
  });
  const msgs = all.filter((m) => m.direction === 'INBOUND');
  const texts = msgs.map((m) => m.content || '').filter(Boolean);
  // Nome e universidade: a resposta curta logo a seguir a nossa pergunta
  // ("Posso saber o seu nome e para que universidade..." -> "Rosa" / "UEM").
  let name = st.name;
  let university = st.university;
  let askedName = false;
  for (const m of all) {
    const c = (m.content || '').trim();
    if (m.direction === 'OUTBOUND') { askedName = /\bnome\b/.test(norm(c)); continue; }
    if (!university) university = findUniversityIn(c);
    if (!name && askedName && c.split(/\s+/).length <= 3) {
      const first = c.split(/[\n,]/)[0].trim();
      if (!findUniversityIn(first)) name = validName(first);
    }
  }
  st = { ...st, name, university };
  const course = st.course || findCourseIn(st.university, texts.join(' \n '));
  const subs = new Set(st.examSubjects || []);
  for (const t of texts) {
    const n = norm(t);
    const only = subjectListOnly(t);
    const said = /\b(exame|exames|disciplinas)\b/.test(n) ? findSubjects(t).subjects : [];
    for (const x of [...only, ...said]) subs.add(x);
  }
  return { ...st, course, examSubjects: subs.size ? [...subs] : null };
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
  // A equipa escreveu ao estudante depois de a regua arrancar (ex.: respondeu
  // a mao com a Leiz desligada): a regua para, para nao repetir o que disse.
  if (await teamWroteAfterState(opts.workspaceId, opts.contactId)) return null;

  // Sem curso nem disciplinas (atendido a mao, ou curso fora dos editais sem as
  // disciplinas): procura nas mensagens dele; se nao houver, nao envia e avisa.
  let ctxState = st;
  if (!reguaContext(st)) ctxState = await contextFromMessages(opts.contactId, st);
  if (!reguaContext(ctxState)) {
    await warnNoReguaContext(opts.workspaceId, opts.contactId, opts.leadId || null, st, ctxState);
    return null;
  }

  CUR = await loadTexts(opts.workspaceId);
  const { parts, next: next0 } = reguaTurn(ctxState);
  const next = { ...next0, course: ctxState.course, examSubjects: ctxState.examSubjects };
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
// Espera depois da ultima mensagem antes de responder (80 a 100 s, ao acaso;
// eram 30 a 45 s ate a restricao do WhatsApp de 25/11),
// para nao responder enquanto o estudante ainda esta a escrever. Cada mensagem
// nova recomeca a espera (isLatestInbound) e a resposta junta todas.
// LEIZPRO_DEBOUNCE_MS fixa um valor (ex.: para testes).
const DEBOUNCE_FIXED = process.env.LEIZPRO_DEBOUNCE_MS ? Number(process.env.LEIZPRO_DEBOUNCE_MS) : null;
const contactLocks = new Map<string, Promise<void>>();

export function debounceInbound(): Promise<void> {
  const ms = DEBOUNCE_FIXED ?? 80_000 + Math.floor(Math.random() * 20_000);
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
    select: { id: true, createdAt: true },
  });
  if (!lastOut) return false;
  // "Devolver a Leiz" depois da ultima mensagem da equipa: a Sherone volta.
  const back = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId, modelUsed: 'leizpro:devolvida', createdAt: { gt: lastOut.createdAt } }, select: { id: true },
  });
  if (back) return false;
  const fromSherone = await prisma.aiSalesSuggestion.findFirst({
    where: { contactId, sentMessageIds: { array_contains: [lastOut.id] } },
    select: { id: true },
  });
  return !fromSherone;
}

// A equipa escreveu ao estudante depois do ultimo passo da Sherone (mensagens
// que nao sairam de nenhuma sugestao). Os 20 minutos a seguir a uns pacotes
// enviados a mao nao contam ("amanha as 18h" da equipa faz parte do envio).
export async function teamWroteAfterState(workspaceId: string, contactId: string): Promise<boolean> {
  const last = await prisma.aiSalesSuggestion.findFirst({
    where: { workspaceId, contactId, modelUsed: { startsWith: 'leizpro' }, status: { notIn: ['DISCARDED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, modelUsed: true },
  });
  if (!last) return false;
  const since = new Date(last.createdAt.getTime() + (last.modelUsed === 'leizpro:regua-manual' ? 20 * 60_000 : 0));
  const outs = await prisma.message.findMany({
    where: { contactId, direction: 'OUTBOUND', isInternal: false, createdAt: { gt: since } },
    select: { id: true }, take: 20,
  });
  for (const m of outs) {
    const fromSherone = await prisma.aiSalesSuggestion.findFirst({ where: { contactId, sentMessageIds: { array_contains: [m.id] } }, select: { id: true } });
    if (!fromSherone) return true;
  }
  return false;
}

// "Devolver a Leiz": a equipa atendeu a mao (Leiz desligada, passou a equipa)
// e devolve a conversa. A Sherone le a conversa para saber em que passo esta:
// boas-vindas do acesso -> acesso activo; numeros de pagamento -> a pagar;
// PDF dos pacotes -> pacotes enviados; senao, o ultimo passo que ela conhecia.
// Nao manda nada por iniciativa propria; responde a proxima mensagem dele.
export async function handBackToLeiz(workspaceId: string, contactId: string, leadId: string | null, userId: string | null): Promise<{ step: Step; summary: string }> {
  let st = await loadState(workspaceId, contactId);
  if (st.step === 'handoff') {
    // O passo antes de passar a equipa.
    const hist = await prisma.aiSalesSuggestion.findMany({
      where: { workspaceId, contactId, modelUsed: { startsWith: 'leizpro' }, status: { notIn: ['DISCARDED', 'FAILED'] } },
      orderBy: { createdAt: 'desc' }, take: 40, select: { actionPayload: true },
    });
    const prev = hist.map((h) => (h.actionPayload as any)?.leizpro).find((s: any) => s && s.step && s.step !== 'handoff' && KNOWN_STEPS.includes(s.step));
    st = { ...st, step: prev ? prev.step : (st.name && st.university ? 'diagnosis' : 'start') };
  }
  st = await contextFromMessages(contactId, st);
  // O que a equipa (ou a Sherone) mandou nos ultimos 45 dias.
  const outs = await prisma.message.findMany({
    where: { contactId, direction: 'OUTBOUND', isInternal: false, createdAt: { gte: new Date(Date.now() - 45 * 86_400_000) } },
    orderBy: { createdAt: 'desc' }, take: 80,
    select: { content: true, type: true, fileName: true, createdAt: true },
  });
  const { WELCOME_RE, parseWelcome } = await import('./access');
  const welcome = outs.find((m) => WELCOME_RE.test(m.content || ''));
  const payIdx = outs.findIndex((m) => /871443442|858395481|canais de pagamento/i.test(m.content || ''));
  const pdfIdx = outs.findIndex((m) => m.type === 'DOCUMENT' && /pacote/i.test(m.fileName || ''));
  let summary: string;
  if (welcome) {
    const access = parseWelcome(welcome.content || '', welcome.createdAt, st.snMonths, st.examSubjects?.length ? st.examSubjects.join(' e ') : null);
    st = { ...st, step: access ? 'active' : 'followup', access: access || st.access };
    summary = access ? 'acesso activo (boas-vindas encontradas)' : 'boas-vindas sem data de fim: segue como conta criada';
  } else if (payIdx >= 0 && (pdfIdx < 0 || payIdx < pdfIdx)) {
    // Ja estava a pagar com um dia marcado (ex.: sincronizacao "paga 2026-11-30"): mantem o dia.
    const keep = st.step === 'paying' && st.payFollow && !st.payFollow.sent ? st.payFollow : null;
    st = { ...st, step: 'paying', payFollow: keep || { at: new Date(Date.now() + 86_400_000).toISOString(), sent: false } };
    summary = `a pagar${st.pkg ? ` (${st.pkg})` : ''}: recebeu os canais de pagamento`;
  } else if (pdfIdx >= 0) {
    st = { ...st, step: 'pdf_sent', lastKey: 'packagesPdf', lastQuestion: 'packagesPdf' };
    summary = 'recebeu os pacotes';
  } else {
    summary = `continua no passo "${st.step}"`;
  }
  const next: LeizProState = {
    ...st, retries: 0, fu: null, regua: null,
    ...(st.step === 'pdf_sent' ? {} : { lastKey: null, lastQuestion: null }),
    ...(st.step === 'paying' ? {} : { payFollow: null }),
  };
  await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId, contactId, leadId,
      parts: [] as any, action: 'wait', productFileIds: [] as any,
      actionPayload: { leizpro: next, handBackBy: userId } as any,
      reasoning: `Conversa devolvida à Leiz pela equipa: ${summary}. A Sherone responde à próxima mensagem do estudante.`,
      principlesUsed: [] as any, modelUsed: 'leizpro:devolvida', status: 'APPROVED', decidedAt: new Date(),
    },
  });
  return { step: next.step, summary };
}

// Sincronizacao em lote ("Aplicar etapas" com opcoes): a equipa diz em que
// etapa esta cada estudante (lido das conversas) e, se quiser, devolve-o a Leiz
// com o pacote e o dia em que disse que pagava. Nada e enviado agora.
export async function syncLeizFromTeam(workspaceId: string, contactId: string, leadId: string | null, o: {
  stageKey: string; pkg?: string | null; payDay?: Date | null; leiz: boolean; reactivate?: boolean;
}): Promise<string> {
  let st = await loadState(workspaceId, contactId);
  st = await contextFromMessages(contactId, st);
  let what = '';
  if (o.stageKey === 'paid') {
    st = { ...st, step: 'handoff', paidOnce: true, payFollow: null, regua: null };
    what = 'pago: a equipa acompanha (boas-vindas activam o acompanhamento do acesso)';
  } else if (o.stageKey === 'chosen' || o.stageKey === 'payFollowup') {
    const day = o.payDay ? nextSendTimeFor(o.payDay) : null;
    st = {
      ...st, step: 'paying', pkg: o.pkg || st.pkg, regua: null,
      payFollow: day ? { at: day.toISOString(), sent: false, day: day.toISOString() } : { at: new Date(Date.now() + 86_400_000).toISOString(), sent: false },
      lastKey: 'paymentChannels', lastQuestion: 'paymentChannels',
    };
    what = `a pagar${st.pkg ? ` (${st.pkg})` : ''}${day ? `: 1.o follow-up a ${day.toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo' })} as ${day.toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' })}` : ': follow-ups pelo compasso da Etapa 3.2'}`;
  } else if (['packages', 'regua1', 'regua2', 'regua3'].includes(o.stageKey)) {
    st = { ...st, step: 'pdf_sent', lastKey: 'packagesPdf', lastQuestion: 'packagesPdf', payFollow: null,
      regua: { startAt: decisionSlot().iso, sent: o.stageKey === 'regua1' ? 1 : o.stageKey === 'regua2' ? 2 : o.stageKey === 'regua3' ? 3 : 0 } };
    what = 'pacotes enviados: a regua continua';
  } else if (o.stageKey === 'presentation') {
    st = { ...st, step: st.step === 'ask_commitment' ? 'ask_commitment' : 'ask_online', lastKey: null, lastQuestion: null, payFollow: null, regua: null };
    what = 'apresentacao';
  } else {
    st = { ...st, step: st.name && st.university ? 'diagnosis' : 'start', payFollow: null, regua: null };
    what = 'diagnostico';
  }
  // Parado ha semanas: a proxima mensagem e a Reactivacao (os 3 follow-ups da etapa
  // contam como feitos), e nao um follow-up normal fora de tempo.
  const fuStage: FuStage = st.step === 'paying' ? 'pay' : st.step === 'pdf_sent' ? 'package' : st.step === 'ask_online' || st.step === 'ask_commitment' ? 'online' : 'course';
  if (o.reactivate) { st = { ...st, regua: null, payFollow: st.step === 'paying' ? { at: new Date().toISOString(), sent: true } : null }; what += ' · Reactivacao'; }
  let next: LeizProState = { ...st, retries: 0, fu: o.reactivate ? { stage: fuStage, n: 3 } : null };
  // Fica com a equipa: a Leiz nao manda regua nem follow-ups (27/11: contactos com
  // tarefa ficavam com a regua agendada e a Sherone ia escrever-lhes).
  if (!o.leiz && next.step !== 'handoff') {
    next = { ...next, step: 'handoff', regua: null, payFollow: null, fu: null };
    what += ' · fica com a equipa';
  }
  await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId, contactId, leadId,
      parts: [] as any, action: 'wait', productFileIds: [] as any,
      actionPayload: { leizpro: next, syncedByTeam: true } as any,
      reasoning: `Sincronizado pela equipa (conversas lidas): ${what}.${o.leiz ? ' Devolvido à Leiz.' : ' Fica com a equipa.'}`,
      principlesUsed: [] as any,
      // "leizpro:devolvida" faz a Sherone voltar a falar nesta conversa.
      modelUsed: o.leiz ? 'leizpro:devolvida' : 'leizpro:sincronizada',
      status: 'APPROVED', decidedAt: new Date(),
    },
  });
  // Tarefas da regua e do pagamento conforme o novo estado (apaga as que ja nao valem).
  const { syncReguaTasks, syncPayTask } = await import('./reguaTasks');
  await syncReguaTasks(workspaceId, contactId, next);
  await syncPayTask(workspaceId, contactId, next);
  return what;
}

// Dia que disse que paga -> 12h desse dia (ou ja, se o dia passou: o
// agendador manda na proxima janela, respeitando o ritmo).
function nextSendTimeFor(day: Date): Date {
  // Dia seguinte ao prometido, as 12h de Maputo.
  const noon = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 10));
  return noon.getTime() < Date.now() ? new Date() : noon;
}

// Passo pela ultima pergunta nossa que corresponde a um texto do guia.
const INFER_KEYS: Array<[TemplateKey, Step]> = [
  ['paymentChannels', 'paying'], ['askPackage', 'pdf_sent'], ['packagesPdf', 'pdf_sent'], ['liked', 'pdf_sent'],
  ['vaccineCommitment', 'ask_commitment'], ['vaccineOnline', 'ask_online'], ['presencial', 'ask_online'],
  ['connection', 'connection'], ['askCourse', 'diagnosis'], ['askUniCourse', 'diagnosis'], ['askUniOnly', 'diagnosis'],
  ['greeting', 'diagnosis'], ['accountHelp', 'account_help'],
];
// Pedaco caracteristico da pergunta final de um texto do guia. Procura nos textos
// do painel e nos originais (a equipa copia muitas vezes o original).
function templateProbes(key: TemplateKey): string[] {
  const out = new Set<string>();
  for (const src of [CUR, T]) {
    const parts = src[key] as readonly string[] | undefined;
    if (!parts?.length) continue;
    const last = norm(parts[parts.length - 1]).replace(/\[[^\]]*\]|\{[^}]*\}/g, '|');
    // Frases da pergunta final, sem pontuacao (o "(a)" e os emojis variam).
    for (const seg of last.split(/[|.!?\n]/).map((x) => x.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim())) {
      if (seg.length >= 18) out.add(seg);
    }
  }
  return [...out];
}
const flat = (t: string) => norm(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
export async function inferStepFromHistory(contactId: string): Promise<Partial<LeizProState> | null> {
  const outs = await prisma.message.findMany({
    where: { contactId, direction: 'OUTBOUND', isInternal: false, type: 'TEXT' },
    orderBy: { createdAt: 'desc' }, take: 12, select: { content: true },
  });
  // So as nossas 2 ultimas mensagens: reconhecer uma pergunta antiga e retomar
  // dai repetia passos ja feitos (27/11, Rosa: compromisso feito a mao, a Leiz
  // voltou a pedir o nome). Sem reconhecer, a equipa decide.
  // A segunda so conta se a ultima for curta ("😊", "Ok").
  const look = outs.length > 1 && (outs[0].content || '').trim().length < 40 ? outs.slice(0, 2) : outs.slice(0, 1);
  for (const m of look) {
    const hit = matchInferKey(m.content || '');
    if (hit) return hit;
  }
  return null;
}

// Que pergunta do guia esta mensagem nossa fez (exportada para os testes).
export function matchInferKey(content: string): Partial<LeizProState> | null {
  const t = flat(content);
  for (const [key, step] of INFER_KEYS) {
    if (templateProbes(key).some((probe) => t.includes(probe))) return { step, lastKey: key, lastQuestion: key, retries: 0 };
  }
  return null;
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
  let state = await loadState(opts.workspaceId, opts.contactId);
  if (state.step === 'handoff') return null;
  // Sem passo guardado mas a conversa ja vai a meio (contacto LID juntado,
  // atendido a mao, historico sincronizado): nunca recomecar com a saudacao.
  // Le as nossas ultimas mensagens e retoma na pergunta que fizemos; se nao
  // reconhecer nenhuma, passa a equipa (26/11: "Sim" ao compromisso recebeu
  // a apresentacao inicial).
  if (state.step === 'start') {
    const outs = await prisma.message.count({ where: { contactId: opts.contactId, direction: 'OUTBOUND', isInternal: false } });
    if (outs > 0) {
      CUR = await loadTexts(opts.workspaceId);
      const inferred = await inferStepFromHistory(opts.contactId);
      if (!inferred) {
        const d = handoff(state, 'a conversa ja tinha comecado mas a Sherone nao sabe em que passo esta (use "Devolver a Leiz" depois de responder)');
        const suggestion = await prisma.aiSalesSuggestion.create({
          data: {
            workspaceId: opts.workspaceId, contactId: opts.contactId, leadId: opts.leadId || null, triggerMessageId: opts.triggerMessageId || null,
            parts: d.parts as any, action: 'handoff', productFileIds: [] as any,
            actionPayload: { leizpro: d.next } as any, reasoning: d.reason, principlesUsed: [] as any,
            modelUsed: 'leizpro:regras', status: 'PENDING',
          },
        });
        return { suggestion, normalized: { action: 'handoff' }, notify: null };
      }
      state = await contextFromMessages(opts.contactId, { ...state, ...inferred });
    }
  }

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

  let { u, d, so } = await runTurn(state, text, opts.workspaceId, await recentHistory(opts.contactId));

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
  // Resposta escrita pelo Gemini: nos primeiros dias fica a espera de aprovacao
  // (LEIZPRO_IMPROVISE=approve). A equipa recebe o aviso para aprovar ou editar.
  const needsApproval = !!d.improvised && improviseMode() === 'approve';
  if (needsApproval) {
    d = { ...d, notify: `resposta escrita pelo Gemini à espera da tua aprovação: "${d.parts.join(' ').slice(0, 140)}"` };
  }

  const reasoning = [
    d.reason,
    `Passo ${state.step} -> ${d.next.step}.`,
    `Intencao: ${u.intent} (${u.intentSource}).`,
    u.modelError ? `Modelo local indisponivel: ${u.modelError}.` : '',
    so?.used ? `Segunda opiniao (${vertexModel()}): ${so.why}.` : '',
    so?.error ? `Gemini indisponivel (${so.error}): ficou a leitura do modelo local.` : '',
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
      actionPayload: { leizpro: d.next, understood: { ...u }, ...(so ? { secondOpinion: so } : {}), ...(d.improvised ? { improvised: true } : {}), ...(d.notify ? { notify: d.notify } : {}) } as any,
      reasoning,
      principlesUsed: [] as any,
      modelUsed: `leizpro:${so?.used ? vertexModel() : (u.modelUsed || 'regras')}`,
      // "Nao responder" nao precisa de decisao: fica ja resolvida.
      status: d.action === 'wait' ? 'APPROVED' : 'PENDING',
      ...(d.action === 'wait' ? { decidedAt: new Date() } : {}),
    },
  });
  // Pipeline (a passagem a equipa nao muda a etapa) e tarefas da regua.
  await syncStage(opts.workspaceId, opts.contactId, d.next);
  return { suggestion, normalized: { action }, notify: d.notify || null, needsApproval };
}

export { LEIZPRO_MODEL, AVAILABLE_SUBJECTS };
