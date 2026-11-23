// Textos da Sherone editaveis no painel da Leiz.
//
// Os textos por defeito estao em guide.ts (o guia). O workspace pode
// sobrepor qualquer mensagem; as edicoes ficam em Workspace.leizProTexts
// como { chave: string[] }. O motor le os textos a cada volta (cache curta),
// por isso uma edicao vale a partir da mensagem seguinte, sem deploy.
//
// So se edita o TEXTO. A logica (que mensagem vem a seguir, quando passa a
// equipa) continua no motor; por isso cada mensagem tem regras de estrutura
// (campos obrigatorios/permitidos e numero minimo de partes).

import prisma from '../prisma';
import { T, PDF_MARK, type TemplateKey } from './guide';

export type Texts = Record<TemplateKey, readonly string[]>;

type Meta = {
  group: string;
  label: string;
  help: string;
  vars?: string[];        // campos {x} permitidos, alem de [NOME]
  required?: string[];    // campos que nao podem faltar
  minParts?: number;
  questionLast?: boolean; // a ultima parte e repetida quando o estudante nao responde
  needsPdf?: boolean;     // uma parte tem de ser exactamente <<PDF>>
};

const NAME_HELP = 'Usa [NOME] para o primeiro nome do estudante.';

export const TEXT_META: Record<TemplateKey, Meta> = {
  greeting: { group: '1. Primeiro contacto', label: 'Saudação (Passo 1.1)', help: 'Primeira resposta ao estudante.', questionLast: true },
  priceFirst: { group: '1. Primeiro contacto', label: 'Pergunta o preço logo à partida (Passo 1.2)', help: 'Quando o estudante pergunta o preço antes de dar os dados.', questionLast: true },
  askNameAgain: { group: '1. Primeiro contacto', label: 'Pedir de novo nome e universidade', help: 'Quando a resposta não trouxe nem nome nem universidade.', questionLast: true },
  askNameOnly: { group: '1. Primeiro contacto', label: 'Pedir só o nome', help: 'Quando deu a universidade mas não o nome.', questionLast: true },
  askUniOnly: { group: '2. Diagnóstico', label: 'Pedir só a universidade', help: `Quando deu o nome e o curso mas não a universidade. ${NAME_HELP}`, questionLast: true },
  askUniCourse: { group: '2. Diagnóstico', label: 'Pedir universidade e curso', help: `Quando deu só o nome. ${NAME_HELP}`, questionLast: true },
  askCourse: { group: '2. Diagnóstico', label: 'Pedir o curso (Passo 1.3)', help: `{universidade} é a universidade que o estudante disse. ${NAME_HELP}`, vars: ['universidade'], questionLast: true },
  courseClarify: { group: '2. Diagnóstico', label: 'Não percebeu a pergunta do curso', help: 'Muitos estudantes vão para institutos. Vem no lugar da pergunta do curso quando dizem "como assim?".', questionLast: true },
  connection: { group: '2. Diagnóstico', label: 'Conexão (Passo 1.4)', help: `Pergunta para o estudante falar de si. A disciplina que disser serve para o capítulo 1 (Passo 1.5.5). ${NAME_HELP}`, questionLast: true },
  vaccineOnline: { group: '3. Vacinas e pacotes', label: 'Vacina do online (Passo 1.5.1)', help: 'Parte 1: reacção ao que ele contou (trocada por "Óptimo" se disser que nada foi difícil). A última parte tem de ser a pergunta do online.', minParts: 2, questionLast: true },
  vaccineCommitment: { group: '3. Vacinas e pacotes', label: 'Vacina do compromisso (Passo 1.5.2)', help: 'A última parte tem de ter a pergunta do compromisso (é a que se repete se ele não perceber).', questionLast: true },
  packagesPdf: { group: '3. Vacinas e pacotes', label: 'Envio dos pacotes em PDF (Passo 1.5.3)', help: 'Uma parte tem de ser exactamente <<PDF>>: é onde vai o PDF (Produto do catálogo com "pacote" no nome). {capitulo1} (ex.: "o capítulo 1 de Química") e {opcao1} (o dia combinado, ex.: "amanhã às 18h") são do Klaru; a régua de follow-up conta a partir de {opcao1}.', vars: ['capitulo1', 'opcao1'], required: ['opcao1'], minParts: 2, questionLast: true, needsPdf: true },
  packagesText: { group: '3. Vacinas e pacotes', label: 'Pacotes em texto (sem PDF no catálogo)', help: 'Usada só quando não há Produto "Pacotes" com PDF no catálogo do Klaru. Mesmos campos do envio em PDF.', vars: ['capitulo1', 'opcao1'], required: ['opcao1'], questionLast: true },
  askPackage: { group: '3. Vacinas e pacotes', label: 'Com qual dos pacotes vais ficar?', help: 'Quando responde durante a régua de follow-up (ex.: "sim, já decidi").', questionLast: true },
  reguaContact1: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 1, no dia combinado', help: 'Campos preenchidos pelo Klaru a partir dos editais 2026: {curso} (ex.: Medicina), {pacote} (Pacote D, ou C se o exame tiver 1 disciplina), {disciplinas} (ex.: Biologia e Química), {duracao} (2 meses) e {disciplina} (a disciplina em que ele tem mais dificuldade, ou uma do exame). O número do capítulo escreve-se à mão. Em modo supervisionado aparece como sugestão para aprovar.', vars: ['curso', 'pacote', 'disciplinas', 'duracao', 'disciplina'], required: ['pacote'], questionLast: true },
  reguaContact1Generic: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 1 (curso fora dos editais)', help: 'Quando o curso não está nos editais: {curso}, {pacote} (Pacote D, ou C se ele disse 1 disciplina), {disciplinas} (ex.: 2 disciplinas) e {duracao} (2 meses).', vars: ['curso', 'pacote', 'disciplinas', 'duracao'], required: ['pacote'], questionLast: true },
  reguaContact1NoCourse: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 1 (sem curso conhecido)', help: 'Quando o estudante nunca disse o curso.', questionLast: true },
  reguaContact2: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 2, 3 dias depois (espaço para um "não")', help: NAME_HELP, questionLast: true },
  reguaNotNow: { group: '3b. Régua de follow-up (Fluxo 6)', label: '"Agora não" durante a régua', help: 'Agradece e pergunta quando voltar a falar. A resposta (a data) passa à equipa para registar.', questionLast: true },
  reguaFarewell: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 3, despedida (9 dias depois)', help: 'Última mensagem da régua. Se ele responder, volta à pergunta do pacote.' },
  hesitant: { group: '3. Vacinas e pacotes', label: 'Hesita no compromisso', help: 'Capítulo 1 sem conta e próximo contacto. {opcao1} é a hora proposta pelo Klaru (ex.: "hoje às 15h").', vars: ['opcao1'], required: ['opcao1'], questionLast: true },
  notNow: { group: '3. Vacinas e pacotes', label: 'Agora não (depois dos pacotes)', help: '{opcao1} é a hora proposta pelo Klaru para o próximo contacto.', vars: ['opcao1'], required: ['opcao1'], questionLast: true },
  accountHelp: { group: '4. Conta', label: 'Ajudar a criar a conta (Passo 1.5.4)', help: NAME_HELP, questionLast: true },
  accountCreated: { group: '4. Conta', label: 'Conta criada (Passo 1.5.5)', help: '{comeca_por} é a frase do capítulo 1 (com a disciplina difícil, se ele a disse). {opcao1} é a hora do próximo contacto.', vars: ['comeca_por', 'opcao1'], required: ['comeca_por'], questionLast: true },
  liked: { group: '4. Conta', label: 'Experimentou e gostou (Passo 2.1.1)', help: NAME_HELP, questionLast: true },
  superNerdAsk: { group: '5. Modo Super Nerd e pagamento', label: 'Explicar o modo Super Nerd (Passo 3.1)', help: 'Quando pergunta pelo modo Super Nerd ou insiste no preço. A última parte pergunta disciplinas e duração.', questionLast: true },
  snAskCount: { group: '5. Modo Super Nerd e pagamento', label: 'Perguntar só o número de disciplinas', help: NAME_HELP, questionLast: true },
  snAskMonths: { group: '5. Modo Super Nerd e pagamento', label: 'Perguntar só a duração', help: NAME_HELP, questionLast: true },
  superNerdPrice: { group: '5. Modo Super Nerd e pagamento', label: 'Dizer o valor (Passo 3.1.1)', help: '{disciplinas} (ex.: "2 disciplinas"), {duracao} (ex.: "1 mês"), {pacote} (ex.: "Pacote D") e {valor} são calculados pelo Klaru.', vars: ['disciplinas', 'duracao', 'pacote', 'valor'], required: ['valor'] },
  superNerdActivateQ: { group: '5. Modo Super Nerd e pagamento', label: 'Perguntar se quer activar', help: 'Depois do valor. Se disser que sim, seguem os canais de pagamento.', questionLast: true },
  paymentChannels: { group: '5. Modo Super Nerd e pagamento', label: 'Canais de pagamento (Passo 3.2)', help: 'Depois de escolher o pacote. A equipa recebe um aviso. O comprovativo passa sempre à equipa: a Sherone não confirma pagamentos.' },
  expensive: { group: '6. Situações comuns', label: 'Está muito caro', help: NAME_HELP },
  paymentSafe: { group: '6. Situações comuns', label: 'O pagamento é seguro?', help: NAME_HELP },
  friendReferral: { group: '6. Situações comuns', label: 'Conheço alguém que quer também', help: NAME_HELP },
  coversExam: { group: '6. Situações comuns', label: 'O conteúdo cobre tudo o que sai no exame?', help: NAME_HELP },
  willIPass: { group: '6. Situações comuns', label: 'Vai dar para eu passar?', help: NAME_HELP },
  noUniversity: { group: '6. Situações comuns', label: 'Não vejo a minha universidade', help: NAME_HELP },
  weakPhone: { group: '6. Situações comuns', label: 'Telemóvel fraco / internet cara', help: NAME_HELP },
  shareAccount: { group: '6. Situações comuns', label: 'Partilhar a conta', help: NAME_HELP },
  payOtherPerson: { group: '6. Situações comuns', label: 'Pagar com M-Pesa de outra pessoa', help: NAME_HELP },
  lives: { group: '6. Situações comuns', label: 'Como funcionam as vidas?', help: NAME_HELP },
  accessProblem: { group: '6. Situações comuns', label: 'Não consigo entrar / criar conta', help: NAME_HELP },
  emailCode: { group: '6. Situações comuns', label: 'Código do e-mail / e-mail com problema', help: NAME_HELP },
  forgotPassword: { group: '6. Situações comuns', label: 'Esqueci a palavra-passe', help: NAME_HELP },
  changeSubjects: { group: '6. Situações comuns', label: 'Quero trocar as disciplinas', help: NAME_HELP },
  accessEnded: { group: '6. Situações comuns', label: 'O acesso acabou, quero continuar', help: 'A seguir o estudante diz o pacote e o Klaru calcula o valor.', questionLast: true },
  linkProblem: { group: '6. Situações comuns', label: 'O link não abre', help: NAME_HELP },
  presencial: { group: '6. Situações comuns', label: 'Queria presencial', help: 'Pergunta o motivo. A seguir vem "Como é estudar online".', questionLast: true },
  howOnline: { group: '6. Situações comuns', label: 'Como é estudar online / como funciona', help: 'Depois do motivo do presencial, ou quando pergunta como funciona.' },
  schedule: { group: '6. Situações comuns', label: 'Horário das aulas / assistência', help: NAME_HELP },
  tooBasic: { group: '6. Situações comuns', label: 'O capítulo 1 é muito básico', help: NAME_HELP },
  noMoney: { group: '6. Situações comuns', label: 'Não tenho condições agora', help: 'A seguir vão as redes e a proposta do próximo contacto.' },
  socials: { group: '6. Situações comuns', label: 'Redes sociais', help: 'Enviado com "Não tenho condições agora".' },
  isFree: { group: '6. Situações comuns', label: 'É grátis? / Tem taxas?', help: 'A seguir o Klaru junta a pergunta do passo em que ele estava.' },
  nonText: { group: '7. Auxiliares', label: 'Mandou áudio ou imagem', help: 'Pede para escrever.' },
  whyAsk: { group: '7. Auxiliares', label: '"É necessário?" (porque perguntamos)', help: 'A seguir o Klaru repete a pergunta.' },
  clarifyPrefix: { group: '7. Auxiliares', label: 'Introdução quando "não percebeu"', help: 'Vem antes da pergunta repetida.' },
  repeatPrefix: { group: '7. Auxiliares', label: 'Introdução ao repetir a pergunta', help: 'Quando a resposta não respondeu ao que foi perguntado.' },
  handoffDraft: { group: '7. Auxiliares', label: 'Rascunho ao passar para a equipa', help: 'Não é enviado sozinho: aparece como sugestão para a equipa.' },
};

export const TEXT_KEYS = Object.keys(TEXT_META) as TemplateKey[];

// Valida uma mensagem editada. Devolve o erro (texto para o utilizador) ou null.
export function validateText(key: TemplateKey, parts: unknown): string | null {
  const meta = TEXT_META[key];
  const label = meta.label;
  if (!Array.isArray(parts) || parts.some((p) => typeof p !== 'string')) return `${label}: formato inválido`;
  const clean = (parts as string[]).map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return `${label}: tem de ter pelo menos uma parte`;
  if (clean.length > 6) return `${label}: no máximo 6 partes (cada parte é uma mensagem de WhatsApp)`;
  if (meta.minParts && clean.length < meta.minParts) return `${label}: tem de ter pelo menos ${meta.minParts} partes`;
  if (clean.some((p) => p.length > 1200)) return `${label}: cada parte pode ter no máximo 1200 caracteres`;
  const all = clean.join('\n');
  const allowed = new Set(meta.vars || []);
  for (const m of all.matchAll(/\{([^{}\s]*)\}/g)) {
    if (!allowed.has(m[1])) {
      return allowed.size
        ? `${label}: o campo {${m[1]}} não existe aqui. Campos possíveis: ${[...allowed].map((v) => `{${v}}`).join(', ')}`
        : `${label}: esta mensagem não aceita campos entre chavetas ({${m[1]}})`;
    }
  }
  if (meta.needsPdf && !clean.includes(PDF_MARK)) return `${label}: falta uma parte só com ${PDF_MARK} (é onde vai o PDF)`;
  for (const r of meta.required || []) {
    if (!all.includes(`{${r}}`)) return `${label}: falta o campo {${r}}`;
  }
  // [NOME] e o unico campo entre parenteses rectos; qualquer outro ficaria por preencher.
  for (const m of all.matchAll(/\[([^\[\]]+)\]/g)) {
    if (m[1] !== 'NOME') return `${label}: [${m[1]}] não é preenchido automaticamente. Usa só [NOME]`;
  }
  return null;
}

// ---- Leitura (com cache curta) ----------------------------------------------
const cache = new Map<string, { at: number; texts: Texts }>();

export function clearTextsCache(workspaceId: string) {
  cache.delete(workspaceId);
}

export function mergeTexts(overrides: unknown): Texts {
  const out: Record<string, readonly string[]> = { ...T };
  if (overrides && typeof overrides === 'object') {
    for (const key of TEXT_KEYS) {
      const v = (overrides as any)[key];
      // Uma edicao invalida (ex.: guia mudou) nunca parte a conversa: usa o texto do guia.
      if (v !== undefined && validateText(key, v) === null) {
        out[key] = (v as string[]).map((p) => p.trim()).filter(Boolean);
      }
    }
  }
  return out as Texts;
}

export async function loadTexts(workspaceId: string): Promise<Texts> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < 30_000) return hit.texts;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { leizProTexts: true } });
  const texts = mergeTexts(ws?.leizProTexts);
  cache.set(workspaceId, { at: Date.now(), texts });
  return texts;
}
