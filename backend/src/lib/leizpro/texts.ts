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
import { T, type TemplateKey } from './guide';

export type Texts = Record<TemplateKey, readonly string[]>;

type Meta = {
  group: string;
  label: string;
  help: string;
  vars?: string[];        // campos {x} permitidos, alem de [NOME]
  required?: string[];    // campos que nao podem faltar
  minParts?: number;
  questionLast?: boolean; // a ultima parte e repetida quando o estudante nao responde
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
  connection: { group: '2. Diagnóstico', label: 'Conexão (Passo 1.4)', help: `Pergunta para o estudante falar de si. A resposta vai para as notas da chamada. ${NAME_HELP}`, questionLast: true },
  vaccineOnline: { group: '3. Vacinas e chamada', label: 'Vacina do online (Passo 1.5.1)', help: 'Parte 1: reacção ao que ele contou (trocada por "Óptimo" se disser que nada foi difícil). A última parte tem de ser a pergunta do online.', minParts: 2, questionLast: true },
  vaccineCommitment: { group: '3. Vacinas e chamada', label: 'Vacina do compromisso (Passo 1.5.2)', help: 'A última parte tem de ter a pergunta do compromisso (é a que se repete se ele não perceber).', questionLast: true },
  callInvite: { group: '3. Vacinas e chamada', label: 'Convite para a chamada (Passo 1.5.3)', help: '{opcao1} e {opcao2} são as duas horas propostas pelo Klaru (ex.: "hoje às 15h", "amanhã às 15h"), entre as 8h e as 20h.', vars: ['opcao1', 'opcao2'], required: ['opcao1', 'opcao2'], questionLast: true },
  callConfirm: { group: '3. Vacinas e chamada', label: 'Confirmar a hora da chamada', help: '{quando} é a hora escolhida (ex.: "amanhã às 18h"). Ao aprovar, a chamada fica na Agenda do Klaru.', vars: ['quando'], required: ['quando'] },
  callOtherTime: { group: '3. Vacinas e chamada', label: 'Pede outra hora (Passo 1.5.6)', help: NAME_HELP, questionLast: true },
  callAskHour: { group: '3. Vacinas e chamada', label: 'Hora fora do horário ou sem hora', help: 'Quando escolhe uma hora fora das 8h às 20h, ou só o dia.', questionLast: true },
  noCall: { group: '3. Vacinas e chamada', label: 'Não pode falar por chamada (Passo 1.5.6)', help: 'Depois disto a conversa continua com a equipa, por mensagens.' },
  hesitant: { group: '3. Vacinas e chamada', label: 'Hesita no compromisso', help: 'Amostra sem conta e proposta de contacto. {opcao1} e {opcao2} são as duas horas propostas.', vars: ['opcao1', 'opcao2'], required: ['opcao1', 'opcao2'], questionLast: true },
  superNerdAsk: { group: '4. Modo Super Nerd', label: 'Explicar o modo Super Nerd (Passo 3.1)', help: 'Quando pergunta pelo modo Super Nerd ou insiste no preço. A última parte pergunta disciplinas e duração.', questionLast: true },
  snAskCount: { group: '4. Modo Super Nerd', label: 'Perguntar só o número de disciplinas', help: NAME_HELP, questionLast: true },
  snAskMonths: { group: '4. Modo Super Nerd', label: 'Perguntar só a duração', help: NAME_HELP, questionLast: true },
  superNerdPrice: { group: '4. Modo Super Nerd', label: 'Dizer o valor (Passo 3.1.1)', help: '{disciplinas} (ex.: "2 disciplinas"), {duracao} (ex.: "1 mês") e {valor} são calculados pelo Klaru. Só 1 ou 2 disciplinas; com 3 ou mais passa à equipa.', vars: ['disciplinas', 'duracao', 'valor'], required: ['valor'] },
  priceBackToFree: { group: '4. Modo Super Nerd', label: 'Voltar ao grátis depois do valor', help: 'Antes da chamada: a seguir vem a pergunta do passo em que ele estava.' },
  superNerdActivateQ: { group: '4. Modo Super Nerd', label: 'Perguntar se quer activar', help: 'Depois do valor, quando já há chamada marcada.', questionLast: true },
  paymentInApp: { group: '4. Modo Super Nerd', label: 'Pagamento dentro da app (Passo 3.2)', help: NAME_HELP },
  paidInfo: { group: '4. Modo Super Nerd', label: 'Diz que já pagou (Passo 4.1)', help: 'Se voltar a falar do pagamento, passa à equipa.' },
  expensive: { group: '5. Situações comuns', label: 'Está muito caro', help: NAME_HELP },
  paymentSafe: { group: '5. Situações comuns', label: 'O pagamento é seguro?', help: NAME_HELP },
  friendReferral: { group: '5. Situações comuns', label: 'Conheço alguém que quer também', help: NAME_HELP },
  coversExam: { group: '5. Situações comuns', label: 'O conteúdo cobre tudo o que sai no exame?', help: NAME_HELP },
  willIPass: { group: '5. Situações comuns', label: 'Vai dar para eu passar?', help: NAME_HELP },
  noUniversity: { group: '5. Situações comuns', label: 'Não vejo a minha universidade', help: NAME_HELP },
  weakPhone: { group: '5. Situações comuns', label: 'Telemóvel fraco / internet cara', help: NAME_HELP },
  shareAccount: { group: '5. Situações comuns', label: 'Partilhar a conta', help: NAME_HELP },
  payOtherPerson: { group: '5. Situações comuns', label: 'Pagar com M-Pesa de outra pessoa', help: NAME_HELP },
  accessProblem: { group: '5. Situações comuns', label: 'Não consigo entrar / criar conta', help: NAME_HELP },
  linkProblem: { group: '5. Situações comuns', label: 'O link não abre', help: NAME_HELP },
  presencial: { group: '5. Situações comuns', label: 'Queria presencial', help: 'A seguir o Klaru junta a pergunta do passo (ou o convite para a chamada).' },
  schedule: { group: '5. Situações comuns', label: 'Horário das aulas / assistência', help: NAME_HELP },
  tooBasic: { group: '5. Situações comuns', label: 'A amostra é muito básica', help: NAME_HELP },
  noMoney: { group: '5. Situações comuns', label: 'Não tenho condições agora', help: 'A seguir vão as redes e, se ainda não houver chamada, o convite para a chamada.' },
  socials: { group: '5. Situações comuns', label: 'Redes sociais', help: 'Enviado com "Não tenho condições agora".' },
  nonText: { group: '6. Auxiliares', label: 'Mandou áudio ou imagem', help: 'Pede para escrever.' },
  clarifyPrefix: { group: '6. Auxiliares', label: 'Introdução quando "não percebeu"', help: 'Vem antes da pergunta repetida.' },
  repeatPrefix: { group: '6. Auxiliares', label: 'Introdução ao repetir a pergunta', help: 'Quando a resposta não respondeu ao que foi perguntado.' },
  handoffDraft: { group: '6. Auxiliares', label: 'Rascunho ao passar para a equipa', help: 'Não é enviado sozinho: aparece como sugestão para a equipa.' },
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
