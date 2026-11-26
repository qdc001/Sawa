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
const FU_HELP = 'Enviado pelo Klaru quando o estudante deixa de responder, conforme os tiques do WhatsApp (✓✓ azul: 3 a 4 horas depois, no dia seguinte e dois dias depois; ✓✓ cinzento: 24 horas depois e uma última tentativa; ✓: nada), só das 12h às 13h ou das 18h às 20h. Em modo supervisionado aparece como sugestão para aprovar. "Bom dia" no início passa a "Boa tarde"/"Boa noite" conforme a hora.';

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
  reguaContact1: { group: '3b. Régua de follow-up (Fluxo 6)', label: 'Contacto 1, no dia combinado', help: 'Campos preenchidos pelo Klaru a partir dos editais 2026: {curso} (ex.: Medicina), {pacote} (Pacote D, ou C se o exame tiver 1 disciplina), {disciplinas} (ex.: Biologia e Química), {duracao} (2 meses) e {disciplina} (a disciplina em que ele tem mais dificuldade, ou uma do exame). Se o curso não estiver nos editais, usa as disciplinas que o estudante disse. Sem curso nem disciplinas, a régua não é enviada e recebes um aviso. O número do capítulo escreve-se à mão. Em modo supervisionado aparece como sugestão para aprovar.', vars: ['curso', 'pacote', 'disciplinas', 'duracao', 'disciplina'], required: ['pacote'], questionLast: true },
  payFollowup: { group: '3c. Follow-ups por etapa', label: 'Etapa 3.2 (canais de pagamento sem comprovativo): 1.º follow-up (no dia seguinte ao que disse que pagava, às 12h; sem dia, 1 dia depois de ver)', help: `${FU_HELP} {pacote} é o pacote escolhido (ex.: Pacote B (390 MZN)).`, vars: ['pacote'], questionLast: true },
  fuPay2: { group: '3c. Follow-ups por etapa', label: 'Etapa 3.2: 2.º follow-up (3 dias depois do 1.º)', help: `${FU_HELP} {pacote} é o pacote escolhido.`, vars: ['pacote'], questionLast: true },
  fuPay3: { group: '3c. Follow-ups por etapa', label: 'Etapa 3.2: 3.º follow-up (5 dias depois do 2.º, fecho)', help: FU_HELP, vars: ['pacote'] },
  payLater: { group: '5. Modo Super Nerd e pagamento', label: 'Diz quando consegue pagar', help: 'Quando o estudante diz que paga mais tarde ("só no fim do mês"). A data vai para a equipa registar.' },
  fuCourse1: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.3 (não disse o curso): 1.º follow-up', help: `${FU_HELP} {universidade} é a universidade que ele disse.`, vars: ['universidade'], questionLast: true },
  fuCourse2: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.3: 2.º follow-up', help: `${FU_HELP} {universidade} é a universidade que ele disse.`, vars: ['universidade'], questionLast: true },
  fuCourse3: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.3: 3.º follow-up (fecho)', help: FU_HELP, vars: ['universidade'] },
  fuConn1: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.4 (não respondeu sobre a dificuldade): 1.º follow-up', help: FU_HELP, vars: ['curso'], questionLast: true },
  fuConn2: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.4: 2.º follow-up', help: `${FU_HELP} {curso} é o curso que ele disse.`, vars: ['curso'], questionLast: true },
  fuConn3: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.4: 3.º follow-up (fecho)', help: FU_HELP, vars: ['curso'] },
  fuOnline1: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.1 (vacina do online): 1.º follow-up', help: FU_HELP, questionLast: true },
  fuOnline2: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.1: 2.º follow-up', help: `${FU_HELP} "Telemóvel" ou "computador" contam como estar à vontade com o online.`, questionLast: true },
  fuOnline3: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.1: 3.º follow-up (fecho)', help: FU_HELP },
  fuCommit1: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.2 (compromisso): 1.º follow-up', help: FU_HELP, questionLast: true },
  fuCommit2: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.2: 2.º follow-up', help: FU_HELP, questionLast: true },
  fuCommit3: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.2: 3.º follow-up (fecho)', help: FU_HELP },
  fuAccount1: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.4 (não criou a conta): 1.º follow-up', help: FU_HELP, questionLast: true },
  fuAccount2: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.4: 2.º follow-up', help: FU_HELP, questionLast: true },
  fuAccount3: { group: '3c. Follow-ups por etapa', label: 'Etapa 1.5.4: 3.º follow-up (fecho)', help: FU_HELP },
  fuPkg1: { group: '3c. Follow-ups por etapa', label: 'Etapa 2.1.1 (experimentou e não escolheu o pacote): 1.º follow-up', help: `${FU_HELP} {n_disciplinas} é calculado pelo Klaru (ex.: "2 disciplinas").`, vars: ['n_disciplinas'], questionLast: true },
  fuPkg2: { group: '3c. Follow-ups por etapa', label: 'Etapa 2.1.1: 2.º follow-up', help: FU_HELP, vars: ['n_disciplinas'], questionLast: true },
  fuPkg3: { group: '3c. Follow-ups por etapa', label: 'Etapa 2.1.1: 3.º follow-up (fecho)', help: FU_HELP, vars: ['n_disciplinas'] },
  reactivation: { group: '3c. Follow-ups por etapa', label: 'Reactivação (2 a 3 semanas depois do 3.º follow-up)', help: 'Uma mensagem, 16 dias depois do último follow-up sem resposta. Se ele responder, a conversa passa à equipa (sugestão de rotina).', questionLast: true },
  accessMid: { group: '5b. Acesso activo (Fluxo 7)', label: 'A meio do acesso (15.º dia no pacote de 1 mês, 30.º no de 2 meses)', help: 'A equipa manda as boas-vindas ("O teu acesso já está activo: tens todos os capítulos de … até …"); o Klaru lê dela as disciplinas e a data de fim. Sai às 12h. Se ele estiver atrasado ou com dificuldade num tema, passa à equipa.', vars: ['disciplinas'], questionLast: true },
  accessGood: { group: '5b. Acesso activo (Fluxo 7)', label: 'A meio do acesso: está bem encaminhado', help: 'Resposta quando ele diz que está a correr bem.' },
  renew1: { group: '5b. Acesso activo (Fluxo 7)', label: 'Renovação: 3 dias antes do fim', help: 'Sai às 12h, 3 dias antes da data de fim. Se ele quiser continuar: "mesmo pacote ou mudar?" (ou os pacotes, se não soubermos qual tinha). Nunca usar o exame como argumento.', vars: ['disciplinas', 'data_fim'], questionLast: true },
  renew2: { group: '5b. Acesso activo (Fluxo 7)', label: 'Renovação: no último dia (se não respondeu)', help: 'Só se ele não respondeu à de 3 dias antes. Se não responder, entra na Reactivação.' },
  renewSame: { group: '5b. Acesso activo (Fluxo 7)', label: 'Quer renovar: mesmo pacote ou mudar?', help: 'Texto do Klaru (o guia diz "perguntar se fica com o mesmo pacote ou se quer mudar"). Mesmo pacote: canais de pagamento (Passo 3.2). Mudar: os pacotes.', vars: ['pacote'], questionLast: true },
  fuAmb1: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "Consegues fazer isso?": 1.º follow-up', help: `${FU_HELP} Prova social: usar só se for verdade.`, questionLast: true },
  fuAmb2: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "Consegues fazer isso?": 2.º follow-up', help: FU_HELP },
  fuAmb3: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "Consegues fazer isso?": 3.º follow-up (despedida)', help: FU_HELP },
  ambYes: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Diz que consegue partilhar', help: 'Onde fica o botão e próximo contacto. {opcao1} é a hora proposta pelo Klaru.', vars: ['opcao1'], required: ['opcao1'], questionLast: true },
  ambNo: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Diz que não consegue', help: 'Pergunta o que o impede. A resposta ao motivo vem a seguir.', questionLast: true },
  fuAmbNo1: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "O que te impede?": 1.º follow-up', help: `${FU_HELP} Se disser que sim, segue a mensagem pronta.`, questionLast: true },
  fuAmbNo2: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "O que te impede?": 2.º follow-up', help: FU_HELP },
  fuAmbNo3: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Sem resposta a "O que te impede?": 3.º follow-up (despedida)', help: FU_HELP },
  ambNoOne: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Motivo: não conhece ninguém', help: NAME_HELP, questionLast: true },
  ambShy: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Motivo: vergonha / não gosta de pedir', help: 'Oferece a mensagem pronta.', questionLast: true },
  ambReady: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Mensagem pronta para enviar aos colegas', help: 'A equipa não tem o link de cada estudante: ele cola o link dele no fim (ou envia pelo botão de partilhar).', minParts: 2 },
  ambNoData: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Motivo: não tem dados / saldo', help: '{dia} é o dia proposto pelo Klaru (ex.: "amanhã").', vars: ['dia'], required: ['dia'], questionLast: true },
  ambSlow: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Motivo: acha que não vão entrar / vai demorar', help: '{opcao1} é a hora proposta pelo Klaru.', vars: ['opcao1'], required: ['opcao1'], questionLast: true },
  ambGiveUp: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Mesmo assim não consegue (despedida calorosa)', help: '{dia} é o dia proposto pelo Klaru. Se voltar a dizer que não tem dinheiro, passa à equipa.', vars: ['dia'], required: ['dia'], questionLast: true },
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
  noMoney: { group: '6b. Sem dinheiro: Prémio Embaixador', label: 'Não tenho condições agora (Prémio Embaixador)', help: 'Apresenta o Prémio Embaixador como alternativa e pergunta se consegue. A última parte tem de ser a pergunta.', minParts: 2, questionLast: true },
  isFree: { group: '6. Situações comuns', label: 'É grátis? / Tem taxas?', help: 'A seguir o Klaru junta a pergunta do passo em que ele estava.' },
  nonText: { group: '7. Auxiliares', label: 'Mandou áudio ou imagem', help: 'Pede para escrever.' },
  whyAsk: { group: '7. Auxiliares', label: '"É necessário?" (porque perguntamos)', help: 'A seguir o Klaru repete a pergunta.' },
  clarifyPrefix: { group: '7. Auxiliares', label: 'Introdução quando "não percebeu"', help: 'Vem antes da pergunta repetida.' },
  repeatPrefix: { group: '7. Auxiliares', label: 'Introdução ao repetir a pergunta', help: 'Quando a resposta não respondeu ao que foi perguntado.' },
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
