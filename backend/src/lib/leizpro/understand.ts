// Compreensao das mensagens do estudante para a Leiz Pro.
//
// 1. Regras fixas (palavras-chave) para os casos obvios: rapidas e previsiveis.
// 2. Modelo local no Ollama (servico interno do Easypanel, nada sai do servidor)
//    para extrair nome/universidade/curso e a intencao quando as regras nao chegam.
// 3. Validacao por codigo: um valor so e aceite se aparecer de facto na
//    mensagem (o modelo pequeno por vezes inventa nomes como "Estudante").
//    Disciplinas, universidades conhecidas e datas sao lidas por codigo.

import { AVAILABLE_SUBJECTS } from './guide';

export type Intent =
  | 'saudacao' | 'da_dados' | 'pergunta_preco' | 'acha_caro' | 'sem_dinheiro'
  | 'prefere_presencial' | 'problema_acesso' | 'problema_link' | 'quer_pagar' | 'ja_pagou'
  | 'pagamento_seguro' | 'vai_passar' | 'muito_basico' | 'horario_apoio' | 'telemovel_fraco'
  | 'partilhar_conta' | 'nao_percebi' | 'desconfianca' | 'nao_sei' | 'sim' | 'nao' | 'duvida' | 'sem_texto'
  // v21
  | 'super_nerd' | 'sem_chamada' | 'outra_hora' | 'vidas' | 'instalar_app' | 'problema_codigo' | 'cobre_exame'
  | 'universidade_fora' | 'pagar_outra_pessoa' | 'indicar_amigo' | 'nao_abriu'
  // vistos nas conversas reais (22/11)
  | 'vazio' | 'gratis' | 'porque_pergunta' | 'e_ia' | 'quer_agora'
  // v26
  | 'escolhe_pacote' | 'criar_conta' | 'conta_criada' | 'gostou' | 'esqueci_senha' | 'trocar_disciplinas'
  | 'acesso_acabou' | 'paguei_errado' | 'como_funciona' | 'outro';

export type Understanding = {
  intent: Intent;
  intentSource: 'rule' | 'model' | 'fallback';
  name: string | null;
  university: string | null;
  course: string | null;
  subjects: string[];          // disciplinas que a Zona Nerd tem
  missingSubjects: string[];   // disciplinas pedidas que a Zona Nerd nao tem
  examMonth: number | null;    // 0-11
  examMonthsAhead: number | null; // "daqui a 3 meses"
  // Modo Super Nerd: "2 disciplinas por 1 mes"
  snCount: number | null;
  snMonths: 1 | 2 | null;
  pkg: 'A' | 'B' | 'C' | 'D' | null; // "quero o pacote D", "o B"
  modelUsed: string | null;
  modelError: string | null;
};

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://sawa_ollama:11434').replace(/\/$/, '');
export const LEIZPRO_MODEL = process.env.LEIZPRO_MODEL || 'qwen2.5:3b';

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---- Regras fixas -----------------------------------------------------------
// Ordem importa: a primeira que casa ganha.
const RULES: Array<[Intent, RegExp]> = [
  ['sem_texto', /^\[(audio|image|video|sticker|document|imagem)[^\]]*\]$/],
  // "Estou a conversar com IA ou com uma pessoa?": a equipa decide a resposta.
  ['e_ia', /\b(ia|inteligencia artificial|robo|robot|bot|chatbot|uma pessoa|pessoa real|humano|maquina)\b.*\?|\b(es|e|sao) (uma )?(ia|robo|bot|maquina)\b/],
  // "Afinal nao e mahala?", "tem taxas?": a resposta do guia e a conta gratis.
  ['gratis', /\b(e gratis|e gratuito|gratuit[oa]|de graca|mahala|nao e gratis|sem pagar nada|tem (taxa|taxas|custos?)|tem que pagar|e preciso pagar|paga-se)\b/],
  // "E necessario?", "para que?": explicar porque perguntamos.
  ['porque_pergunta', /^(e )?(mesmo )?necessario\b|\b(pra|para) que (e|serve|precisas|queres|precisa)\b|\bporque (perguntas|queres saber|precisas de saber)\b/],
  // v26 -------------------------------------------------------------------
  // "Paguei o valor errado" / "quero o dinheiro de volta": regra por confirmar, equipa.
  ['paguei_errado', /\b(valor errado|paguei (a mais|a menos|errado|mal)|dinheiro de volta|devolu|reembols)/],
  ['acesso_acabou', /\b(acesso|modo super nerd|pacote|plano) (ja )?(acabou|terminou|expirou)|\b(acabou|terminou|expirou) o (meu )?(acesso|pacote)\b/],
  ['esqueci_senha', /\b(esqueci|perdi|nao lembro|nao me lembro) (a |da |de )?(minha )?(palavra-passe|palavra passe|senha|password)\b/],
  ['trocar_disciplinas', /\b(trocar|mudar|alterar) (as |de |minhas )*(minhas )?disciplinas?\b/],
  ['conta_criada', /\b(ja (criei|fiz|tenho) (a )?(minha )?conta|conta (ja )?(esta )?criada|ja me registei|ja me cadastrei|ja estou dentro|ja entrei)\b|^(pronto,? )?(ja )?criei\W*$|^(pronto,? )?ja (esta|ta)( feito| criada)?\W*$/],
  ['criar_conta', /\b(quero criar|como (crio|faco|criar) (a )?conta|ajuda(-me)? a criar|vamos criar|criar (a )?conta (agora|ja|hoje))\b/],
  ['gostou', /\b(gostei|adorei|muito bom|e bom|esta bom demais|interessante|top|excelente|percebi bem)\b/],
  ['como_funciona', /\b(como (e|funciona) (estudar |o estudo |as aulas )?online|como (e que )?funciona( a zona nerd| isso| isto| a plataforma| as aulas)?\W*$)/],
  // "Ja paguei mas nao abriu" (Passo 4.3): passa para a equipa verificar.
  ['nao_abriu', /\b(paguei|pagamento|comprovativo)\b.*\b(nao (abriu|activou|ativou|abre|recebi|chegou)|ainda nao|nada)\b/],
  ['ja_pagou', /\b(ja (paguei|transferi|fiz o pagamento|enviei o dinheiro|mandei o dinheiro)|comprovativo)\b/],
  ['pagar_outra_pessoa', /\b(m-?pesa|e-?mola|numero|conta) d[eoa]s? (outra pessoa|outro|meu (pai|irmao|tio)|minha (mae|irma|tia))\b/],
  // "nao percebi" nao e um "nao": e pedir para explicar a pergunta.
  ['nao_percebi', /\b(nao (percebi|entendi|compreendi|percebo|entendo)|como assim|explica( melhor)?|o que (queres|quer) dizer)\b/],
  ['problema_link', /\b(link|site|pagina)\b.*\b(nao (abre|abri|abriu|abrem|carrega|carregou|funciona|funcionou|entra)|indisponivel|sem internet|erro)\b|\b(nao (abre|abri|abriu)|indisponivel)\b/],
  // Codigo do e-mail / e-mail com problema (v26: tem resposta no guia)
  ['problema_codigo', /\b(codigo|e-?mail)\b/],
  ['problema_acesso', /\b(criar (a )?conta|pede conta|nao consigo (entrar|aceder|acessar|criar)|volta ao inicio|nao entra)\b/],
  ['instalar_app', /\b(instal|apk|play ?store|baixar a app|descarregar a app|onde (baixo|tiro) a app)/],
  ['vidas', /\bvidas?\b/],
  ['sem_dinheiro', /\b(nao tenho (dinheiro|condic|esse valor|o valor|como pagar|massa)|sem condic|sem dinheiro|(mes|semana) que vem|proximo mes|fim do mes|meu pai|minha mae|meus pais|nao posso pagar)\b/],
  ['acha_caro', /\b(caro|caros|muito dinheiro|desconto|mais barato)\b/],
  // "Isto e burla?" NAO pode receber a resposta do "pagamento e seguro?" (comecava por "E sim").
  ['desconfianca', /\b(burla|burlador|burladores|burlar|esquema|golpe|golpista|fraude|mentira|enganar|roubo|ladr)/],
  ['pagamento_seguro', /\b(seguro|confiavel|confiar|de confianca)\b/],
  ['sem_chamada', /\b(nao (posso|consigo|quero|da para) (falar|atender|receber chamada|chamada|ligar|em chamada)|prefiro (escrever|mensagem|mensagens|por aqui|texto)|sem saldo|sem privacidade|por mensagem|nao gosto de chamada)/],
  ['prefere_presencial', /\b(presencial|presenciais|nunca estudei online|como (e|funciona) (estudar |o estudo )?online)\b/],
  ['horario_apoio', /\b(horario|que horas (sao|e) as aulas|videochamada|assistencia|explicador)\b/],
  ['telemovel_fraco', /\b(telemovel|celular|smartphone) (fraco|lento|velho)\b|\binternet (cara|fraca)\b|\b(sem|poucos) megas\b/],
  ['partilhar_conta', /\b(partilhar|dividir|usar a mesma) (a )?conta\b/],
  ['cobre_exame', /\b(cobre tudo|sai no exame|cai no exame|vem no exame)\b/],
  ['universidade_fora', /\b(nao (vejo|tem|encontro) (a )?minha universidade|minha universidade nao)/],
  ['indicar_amigo', /\b(conheco alguem|tenho (um|uma) (amigo|amiga|colega)|meu (amigo|colega) (tambem )?quer|minha (amiga|colega) (tambem )?quer)/],
  // ("garantir um 15 valores" nao e perguntar se vai passar)
  ['vai_passar', /\b(vou passar|vou conseguir (passar|entrar|admitir)|vai dar para (eu )?(passar|entrar)|garantem|garante que|garantia de (entrar|admiss|passar))/],
  ['muito_basico', /\b(muito basico|ja sei (tudo|isso)|facil demais)\b/],
  ['quer_pagar', /\b(como (faco para |posso |devo )?(pagar|activar|ativar)|quero (activar|ativar)|vou pagar|onde pago|numero (do|de|para) (m-?pesa|e-?mola)|pagar agora)\b/],
  // "Quero o pacote D", "vou ficar com o B", "fico com o A"
  ['escolhe_pacote', /\bpacote\s*[abcd]\b|^(o|quero o|fico com o|vou ficar com o|escolho o|vou querer o|pode ser o)\s*[abcd]\W*$/],
  ['super_nerd', /\b(super ?nerd|premium|plano pago|pacote|pacotes|mensalidade)\b/],
  // ("garantir um 15 valores" e uma nota, nao o preco: so "os valores"/"o valor")
  ['pergunta_preco', /\b(quanto (custa|e|fica|sai|pago)|preco|precos|(os|quais (sao )?os|saber os|ver os) valores|o valor (e|do|da|de|a pagar)|qual (e )?o valor|a mensalidade)\b/],
  ['nao_sei', /\b(nao sei|nao tenho certeza|ainda nao sei|nao faco ideia|nao lembro)\b/],
  // Perguntas sobre o conteudo ("tem videos de fisica?"): vao para a equipa.
  ['duvida', /^(tem|ha|existe|existem|quantos|quantas|quais|qual|como|o que|e possivel|da para|posso)\b.*\?\s*$/],
];

const YES = /^(sim|s|siim|claro|estou|sim estou|com certeza|ok|okay|pode ser|bora|yes|isso|consigo|posso|pode|manda|quero|aceito|combinado|certo|tou|to|estou pronto|estou pronta|sim sim)\b/;
const NO = /^(nao|n|ainda nao|agora nao|talvez|depende|vou tentar|vou pensar|mais ou menos|nem por isso|acho que nao)\b/;

function ruleIntent(text: string): Intent | null {
  const t = norm(text).trim();
  // ".", "..", "👍" sozinhos: nao e uma resposta (o modelo lia "." como "sim").
  if (!/[a-z0-9]/.test(t)) return /[👍✅🙏👌]/u.test(text) ? 'sim' : 'vazio';
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  // respostas curtas de sim/nao (muito comuns nas vacinas)
  const short = t.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (short && short.split(' ').length <= 6) {
    if (NO.test(short)) return 'nao';
    if (YES.test(short)) return 'sim';
  }
  return null;
}

// ---- Disciplinas --------------------------------------------------------------
const SUBJECT_ALIASES: Array<[string, RegExp]> = [
  ['Matemática', /\b(matematica|matematicas|mat)\b/],
  ['Física', /\b(fisica|fis)\b/],
  ['Biologia', /\b(biologia|bio)\b/],
  ['Química', /\b(quimica|quim)\b/],
  ['Português', /\b(portugues|port|lingua portuguesa)\b/],
  ['História', /\b(historia|hist)\b/],
  ['Filosofia', /\b(filosofia|filo)\b/],
  ['Geografia', /\b(geografia|geo)\b/],
  ['Francês', /\bfrances\b/],
  ['Inglês', /\bingles\b/],
  ['Desenho', /\bdesenho\b/],
  ['Educação Visual', /\beducacao visual\b/],
];

// Distancia de edicao (para erros de escrita: "Quimca", "Biologa", "matematca").
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const SUBJECT_WORDS: Array<[string, string]> = [
  ['Matemática', 'matematica'], ['Física', 'fisica'], ['Biologia', 'biologia'], ['Química', 'quimica'],
  ['Português', 'portugues'], ['História', 'historia'], ['Filosofia', 'filosofia'], ['Geografia', 'geografia'],
  ['Francês', 'frances'], ['Inglês', 'ingles'],
];

function findSubjects(text: string): { subjects: string[]; missing: string[] } {
  const t = norm(text);
  const found = SUBJECT_ALIASES.filter(([, re]) => re.test(t)).map(([name]) => name);
  // Palavras com 1 erro (2 nas compridas): "quimca" -> Quimica.
  for (const w of t.split(/[^a-z]+/).filter((x) => x.length >= 5)) {
    for (const [name, ref] of SUBJECT_WORDS) {
      if (found.includes(name)) continue;
      const max = ref.length >= 8 ? 2 : 1;
      if (Math.abs(w.length - ref.length) <= max && editDistance(w, ref) <= max) found.push(name);
    }
  }
  const available = new Set<string>(AVAILABLE_SUBJECTS);
  return {
    subjects: found.filter((s) => available.has(s)),
    missing: found.filter((s) => !available.has(s)),
  };
}

// ---- Universidades (lista do guia) -----------------------------------------
const UNIVERSITIES: Array<[string, RegExp]> = [
  ['FACED-UEM', /\bfaced\b/],
  ['UEM', /\buem\b|\beduardo mondlane\b/],
  ['UP', /\bup\b|\bpedagogica\b/],
  ['ISCISA', /\biscisa\b/],
  ['UniTiva', /\bunitiva\b/],
  ['UCM', /\bucm\b|\bcatolica\b/],
  ['ISCTEM', /\bisctem\b/],
  ['ISCAM', /\biscam\b/],
  ['USTM', /\bustm\b|\bsao tomas\b/],
  ['ISUTC', /\bisutc\b|\btransportes e comunicacoes\b/],
  ['Universidade Politécnica', /\bpolitecnica\b|\bapolitecnica\b/],
  ['UDM', /\budm\b/],
  ['ISGECOF', /\bisgecof\b/],
  ['ISDB', /\bisdb\b|\bdom bosco\b/],
  ['ISGN', /\bisgn\b/],
  ['ISCIM', /\biscim\b/],
  ['ISEDEF', /\bisedef\b/],
  ['UJC', /\bujc\b|\bjoaquim chissano\b/],
  ['UniLúrio', /\bunilurio\b|\blurio\b/],
  ['UniZambeze', /\bunizambeze\b|\bzambeze\b/],
  ['UniSave', /\bunisave\b/],
  ['UniRovuma', /\bunirovuma\b|\brovuma\b/],
  ['UniPúnguè', /\bunipungue\b|\bpungue\b/],
  ['UniLicungo', /\bunilicungo\b|\blicungo\b/],
  ['ACIPOL', /\bacipol\b/],
  ['ESHTI', /\beshti\b/],
];

function findUniversity(text: string): string | null {
  const t = norm(text);
  for (const [name, re] of UNIVERSITIES) if (re.test(t)) return name;
  return null;
}

// ---- Cursos -------------------------------------------------------------------
const COURSES: Array<[string, RegExp]> = [
  ['Medicina', /\bmedicina( dentaria| veterinaria)?\b/],
  ['Direito', /\bdireito\b/],
  ['Engenharia', /\bengenharia( [a-z]+)?\b/],
  ['Economia', /\beconomia\b/],
  ['Gestão', /\bgestao( de [a-z]+)?\b/],
  ['Contabilidade', /\bcontabilidade( e auditoria)?\b/],
  ['Psicologia', /\bpsicologia\b/],
  ['Arquitectura', /\barquit[e]?[c]?tura\b/],
  ['Enfermagem', /\benfermagem\b/],
  ['Farmácia', /\bfarmacia\b/],
  ['Relações Internacionais', /\brelacoes internacionais\b/],
  ['Informática', /\binformatica\b|\bciencias? da computacao\b/],
  ['Jornalismo', /\bjornalismo\b/],
  ['Administração Pública', /\badministracao publica\b/],
  ['Sociologia', /\bsociologia\b/],
  ['Agronomia', /\bagronomia\b/],
  ['Veterinária', /\bveterinaria\b/],
  ['Nutrição', /\bnutricao\b/],
  ['Línguas', /\blinguas\b/],
  ['Educação', /\beducacao( [a-z]+)?\b/],
];

const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

// Devolve o curso como o estudante escreveu ("engenharia civil" -> "Engenharia Civil").
function findCourse(text: string): string | null {
  const t = norm(text);
  for (const [name, re] of COURSES) {
    const m = t.match(re);
    if (!m) continue;
    const nWords = m[0].trim().split(/\s+/).length;
    if (nWords <= 1) return name;
    // Recuperar as palavras originais (com acentos) na mesma posicao.
    const words = text.normalize('NFC').split(/[^A-Za-zÀ-ÿ]+/).filter(Boolean);
    const idx = words.findIndex((w) => norm(w) === m[0].split(/\s+/)[0]);
    const orig = idx >= 0 ? words.slice(idx, idx + nWords) : m[0].split(/\s+/);
    return orig.map((w, i) => (i > 0 && CONNECTORS.has(norm(w)) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ');
  }
  return null;
}

// ---- Datas ------------------------------------------------------------------
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const NUM_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12 };

function findMonth(text: string): number | null {
  const t = norm(text);
  for (let i = 0; i < MONTHS.length; i++) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(t)) return i;
  }
  const m = t.match(/\b\d{1,2}[\/\-](\d{1,2})([\/\-]\d{2,4})?\b/);
  if (m) {
    const mm = Number(m[1]);
    if (mm >= 1 && mm <= 12) return mm - 1;
  }
  return null;
}

// "daqui a 3 meses", "faltam dois meses", "em 4 meses"
function findMonthsAhead(text: string): number | null {
  const t = norm(text);
  const m = t.match(/\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze) mes(es)?\b/);
  if (!m) return null;
  if (!/\b(daqui|faltam|falta|em|dentro de|proximos?)\b/.test(t)) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
  return n >= 1 && n <= 12 ? n : null;
}

// "para o curso de Zootecnia", "curso de Gestao de Empresas"
function courseAfterCurso(text: string): string | null {
  const m = text.match(/\bcurso\s+(?:de|em)\s+([A-Za-zÀ-ÿ]+(?:\s+(?:de|e|da|do)?\s*[A-Za-zÀ-ÿ]+)?)/i);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/).filter((w, i, a) => !(i === a.length - 1 && /^(de|e|da|do|na|no)$/i.test(w)));
  const v = words.join(' ');
  return v.length >= 3 ? titleCase(v).replace(/\b(De|Da|Do|E)\b/g, (x) => x.toLowerCase()) : null;
}

// ---- Modo Super Nerd: quantas disciplinas e quantos meses ---------------------
function findSnCount(text: string, namedSubjects: number): number | null {
  const t = norm(text);
  const m = t.match(/\b(\d|uma|um|duas|dois|tres|quatro|cinco)\s+(disciplinas?|cadeiras?|materias?)\b/);
  if (m) return /^\d$/.test(m[1]) ? Number(m[1]) : ({ um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 } as any)[m[1]];
  if (/\b(as duas|ambas|as 2)\b/.test(t)) return 2;
  if (/\b(so uma|apenas uma|uma so)\b/.test(t)) return 1;
  return namedSubjects > 0 ? namedSubjects : null;
}

// "Quero o pacote D", "o B", "fico com o pacote a"
function findPkg(text: string): 'A' | 'B' | 'C' | 'D' | null {
  const t = norm(text).trim();
  const m = t.match(/\bpacote\s*([abcd])\b/) || t.match(/^(?:o|quero o|fico com o|vou ficar com o|escolho o|vou querer o|pode ser o)\s*([abcd])\W*$/);
  return m ? (m[1].toUpperCase() as 'A' | 'B' | 'C' | 'D') : null;
}

function findSnMonths(text: string): 1 | 2 | null {
  const t = norm(text);
  if (/\b(2|dois) mes(es)?\b/.test(t)) return 2;
  if (/\b(1|um) mes\b/.test(t)) return 1;
  return null;
}

// ---- Nome -------------------------------------------------------------------
const BAD_NAMES = new Set([
  'estudante', 'mocambicano', 'sherone', 'leiz', 'zona', 'nerd', 'ola', 'oi', 'bom', 'boa', 'dia', 'tarde',
  'noite', 'sim', 'nao', 'obrigado', 'obrigada', 'uem', 'up', 'medicina', 'eu', 'aqui', 'ok', 'tudo', 'bem',
  'quero', 'gostaria', 'vi', 'anuncio', 'estou', 'sou', 'hmm', 'hm', 'hmmm', 'ah', 'eh', 'eish', 'ya', 'yah',
  'kkk', 'kkkk', 'haha', 'hehe', 'oii', 'ola', 'oie', 'certo', 'beleza', 'blz', 'pois', 'entao', 'nada', 'tempo',
]);

function titleCase(v: string): string {
  return v.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function validName(v: string | null | undefined): string | null {
  if (!v) return null;
  const words = v.trim().split(/\s+/).slice(0, 3);
  if (!words.length || words.some((w) => !/^[A-Za-zÀ-ÿ'-]{2,}$/.test(w))) return null;
  if (BAD_NAMES.has(norm(words[0]))) return null;
  return titleCase(words.join(' '));
}

// "chamo-me Elton", "meu nome e Ana Mussa", "sou o Carlos", ou so "Elton" sozinho
function regexName(text: string): string | null {
  const m = text.match(/(?:chamo[- ]me|meu nome (?:e|é)|me chamo|sou (?:o|a)|aqui (?:e|é) (?:o|a)|o meu nome (?:e|é))\s+([A-Za-zÀ-ÿ'-]+(?:\s+[A-Za-zÀ-ÿ'-]+)?)/i);
  if (m) return validName(m[1].replace(/\s+(e|da|de|do|vou|quero|estou)$/i, ''));
  return null;
}

// Aceita um valor so se todas as palavras significativas aparecerem na mensagem.
function presentIn(value: unknown, text: string): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 80) return null;
  const t = norm(text);
  const words = norm(v).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  return words.every((w) => new RegExp(`\\b${w}\\b`).test(t)) ? v : null;
}

// ---- Modelo local -----------------------------------------------------------
const MODEL_INTENTS: Intent[] = [
  'saudacao', 'da_dados', 'pergunta_preco', 'acha_caro', 'sem_dinheiro', 'prefere_presencial',
  'problema_acesso', 'quer_pagar', 'ja_pagou', 'nao_sei', 'sim', 'nao', 'duvida', 'outro',
];

function buildPrompt(text: string, expecting: string): string {
  return [
    'Es a assistente da Zona Nerd. Le a mensagem de um estudante mocambicano e responde SO com JSON:',
    '{"nome","universidade","curso","intencao"}.',
    'Usa null quando a mensagem nao disser. NUNCA inventes: so copia palavras que estao na mensagem.',
    'nome e o nome da pessoa (nao e a universidade nem o curso). curso e o curso superior (ex: Medicina, Direito, Engenharia Civil).',
    'intencao e UMA destas: saudacao (cumprimenta ou quer saber como funciona/fazer parte), da_dados (diz nome, universidade, curso, disciplinas ou data do exame), pergunta_preco (pergunta quanto custa ou os valores), acha_caro (diz que e caro mas nao fala de falta de dinheiro), sem_dinheiro (diz que nao tem dinheiro ou condicoes agora, ou que so paga mais tarde), prefere_presencial (quer aulas presenciais ou pergunta como e estudar online), problema_acesso (nao consegue entrar, link nao abre, site pede conta, email ou codigo), quer_pagar (escolheu pacote ou pergunta como pagar), ja_pagou (diz que ja pagou ou manda comprovativo), nao_sei (diz que nao sabe a resposta), sim (concorda ou confirma), nao (recusa ou hesita), duvida (pergunta sobre conteudo, disciplinas, horarios ou apoio), outro.',
    `Contexto: a equipa acabou de perguntar ${expecting}.`,
    `Mensagem: ${text}`,
  ].join(' ');
}

async function askModel(text: string, expecting: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LEIZPRO_MODEL,
        prompt: buildPrompt(text, expecting),
        format: 'json',
        stream: false,
        // 24h: depois de uma noite parado, recarregar o modelo demorava e a
        // primeira mensagem da manha dava timeout (visto a 22/11 as 07:31).
        keep_alive: '24h',
        options: { temperature: 0, num_predict: 160 },
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data: any = await r.json();
    return JSON.parse(String(data?.response || '{}'));
  } finally {
    clearTimeout(timer);
  }
}

// slot: o que a equipa acabou de perguntar, para ler respostas curtas
// ("Medicina" sozinho e o curso quando perguntamos o curso).
export type Slot = 'name' | 'university' | 'course' | 'subjects' | 'date' | null;

export async function understand(text: string, expecting: string, slot: Slot = null): Promise<Understanding> {
  const { subjects, missing } = findSubjects(text);
  const out: Understanding = {
    intent: 'outro',
    intentSource: 'fallback',
    name: regexName(text),
    university: findUniversity(text),
    course: findCourse(text) || courseAfterCurso(text),
    subjects,
    missingSubjects: missing,
    examMonth: findMonth(text),
    examMonthsAhead: findMonthsAhead(text),
    snCount: findSnCount(text, subjects.length + missing.length),
    snMonths: findSnMonths(text),
    pkg: findPkg(text),
    modelUsed: null,
    modelError: null,
  };

  const byRule = ruleIntent(text);
  // Sem texto (so audio/imagem): nao vale a pena chamar o modelo.
  let modelJson: any = null;
  if (byRule !== 'sem_texto') {
    try {
      modelJson = await askModel(text, expecting);
      out.modelUsed = LEIZPRO_MODEL;
    } catch (e: any) {
      out.modelError = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    }
  }

  if (modelJson) {
    const modelName = validName(presentIn(modelJson.nome, text));
    if (!out.name && modelName && !findCourse(modelName) && !findUniversity(modelName)
        && !findSubjects(modelName).subjects.length && !findSubjects(modelName).missing.length
        && norm(modelName) !== norm(String(modelJson.curso || ''))) {
      out.name = modelName;
    }
    if (!out.university) out.university = presentIn(modelJson.universidade, text);
    const course = presentIn(modelJson.curso, text);
    // O curso nao pode ser a universidade, o nome, nem uma disciplina do exame.
    if (!out.course && course && norm(course) !== norm(out.university || '') && norm(course) !== norm(out.name || '')
        && !findSubjects(course).subjects.length && !findUniversity(course)) {
      out.course = titleCase(course);
    }
  }
  // Instituicao que nao esta na lista ("Centro dos professores", "IFP",
  // "Instituto Industrial e Comercial da Beira"): quando perguntamos a
  // universidade, a resposta curta e a instituicao.
  if (!out.university) {
    const inst = text.match(/\b((?:instituto|escola|centro|faculdade|academia|universidade)\s+[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,6})/i);
    if (inst && /^(instituto|escola|centro|faculdade|academia)/i.test(inst[1])) out.university = inst[1].trim().replace(/[.,;!]+$/, '');
  }
  if (slot === 'university' && !out.university && !byRule && !/\?/.test(text)) {
    const ans = text.trim().replace(/^(na|no|em|e|é|pra|para|a|o)\s+/i, '').replace(/[.!😊🙂]+$/u, '');
    if (ans.split(/\s+/).length <= 8 && /^[A-Za-zÀ-ÿ0-9.' -]+$/.test(ans) && /[A-Za-zÀ-ÿ]{2,}/.test(ans)
        && !BAD_NAMES.has(norm(ans.split(/\s+/)[0]))) {
      out.university = ans;
    }
  }
  // Resposta curta ao pedido do curso ("Medicina", "Matematica", "Eng. Civil"):
  // e o curso, mesmo que a palavra seja tambem uma disciplina.
  const shortAnswer = text.trim().replace(/[.!😊🙂]+$/u, '');
  if (slot === 'course' && !out.course && !byRule && !/\?/.test(shortAnswer)
      && shortAnswer.split(/\s+/).length <= 4 && /^[A-Za-zÀ-ÿ.' -]+$/.test(shortAnswer)
      && !BAD_NAMES.has(norm(shortAnswer.split(/\s+/)[0]))) {
    const uni = findUniversity(shortAnswer);
    const rest = uni ? '' : shortAnswer;
    if (rest) out.course = titleCase(rest);
  }
  if (slot === 'course' && out.course && findSubjects(out.course).subjects.length) {
    // "Matematica" respondido ao curso: e o curso, nao uma disciplina do exame.
    out.subjects = [];
    out.missingSubjects = [];
  }
  // Nome sozinho numa linha ("Absalao\nUem"): uma linha so com um nome.
  if (!out.name && slot === 'name' && /\n/.test(text.trim())) {
    for (const line of text.split('\n').map((l) => l.trim().replace(/[.!😊🙂]+$/u, '')).filter(Boolean)) {
      if (/^[A-Za-zÀ-ÿ'-]+(\s+[A-Za-zÀ-ÿ'-]+)?$/.test(line) && !findUniversity(line) && !findCourse(line)
          && !findSubjects(line).subjects.length) {
        const nm = validName(line);
        if (nm) { out.name = nm; break; }
      }
    }
  }
  // Nome sozinho numa resposta ao pedido de nome ("Elton", "Ana Mussa").
  if (!out.name && slot === 'name') {
    const bare = text.trim().replace(/[.!😊🙂]+$/u, '');
    if (/^[A-Za-zÀ-ÿ'-]+(\s+[A-Za-zÀ-ÿ'-]+)?$/.test(bare) && !findUniversity(bare) && !findSubjects(bare).subjects.length) {
      out.name = validName(bare);
    }
  }

  if (byRule) {
    out.intent = byRule;
    out.intentSource = 'rule';
  } else if (modelJson && MODEL_INTENTS.includes(modelJson.intencao)) {
    out.intent = modelJson.intencao;
    out.intentSource = 'model';
    // O modelo pequeno marca respostas normais ("Biologia e Quimica", "Sou o Luis")
    // como duvida/pagamento. Intencoes que passam a conversa para a equipa so
    // valem quando as regras as confirmam; a duvida do modelo so com "?".
    if (['ja_pagou', 'quer_pagar', 'sem_dinheiro'].includes(out.intent)) out.intent = 'outro';
    // O modelo confundia "o mais dificil e resolver exames" com problema de
    // acesso, e "porque a conta e nova?" com pergunta de preco.
    const tn = norm(text);
    if (out.intent === 'problema_acesso' && !/\b(entrar|conta|site|app|aplicativo|link|login|abrir|abre|aceder|acessar)\b/.test(tn)) out.intent = 'outro';
    if (out.intent === 'pergunta_preco' && !/\b(preco|precos|custa|valor|valores|pagar|pago|mzn|meticais|dinheiro|caro)\b/.test(tn)) out.intent = 'outro';
    if (out.intent === 'acha_caro' && !/\b(caro|caros|dinheiro|preco|valor)\b/.test(tn)) out.intent = 'outro';
    if (out.intent === 'duvida' && !text.includes('?')) out.intent = 'outro';
    if (out.intent === 'problema_acesso' && /(link|site|pagina)/.test(norm(text)) && !/(codigo|conta|email|e-mail|senha)/.test(norm(text))) {
      out.intent = 'problema_link';
    }
  }
  // Se trouxe dados concretos e a intencao ficou vaga, e uma resposta com dados.
  const hasData = !!(out.name || out.university || out.course || out.subjects.length || out.missingSubjects.length
    || out.examMonth !== null || out.examMonthsAhead !== null);
  if (hasData && (['outro', 'saudacao', 'sim', 'nao'].includes(out.intent) || (out.intentSource === 'model' && out.intent !== 'pergunta_preco'))) {
    out.intent = 'da_dados';
  }
  // O modelo diz "da_dados" mas nao aproveitamos nada: tratar como vago.
  if (out.intent === 'da_dados' && !hasData) out.intent = 'outro';
  return out;
}

// ---- Pacotes (calculo por codigo, nunca pelo modelo) --------------------------
// Meses ate ao exame, arredondado para cima (sugestao do guia). Sem dia exacto,
// contamos o mes do exame inteiro: Novembro -> Fevereiro = 3 meses.
export function monthsUntil(examMonth: number, now = new Date()): number {
  const diff = (examMonth - now.getMonth() + 12) % 12;
  return diff === 0 ? 12 : diff;
}

export function recommendPackage(nSubjects: number, months: number | null): { pkg: 'A' | 'B' | 'C' | 'D'; text: string; total: number } {
  const two = nSubjects >= 2;
  if (months === null || months <= 2) {
    return two
      ? { pkg: 'B', total: 670, text: '📚 Para o teu caso, recomendo o *Pacote B*: as 2 disciplinas, com 2 meses de acesso.\n\n*670 MZN*, uma só vez.' }
      : { pkg: 'A', total: 390, text: '📘 Para o teu caso, recomendo o *Pacote A*: 1 disciplina, com 2 meses de acesso.\n\n*390 MZN*, uma só vez.' };
  }
  const perMonth = two ? 360 : 180;
  const total = perMonth * months;
  const fmt = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // 1080 -> "1 080", como no guia
  return two
    ? { pkg: 'D', total, text: `🏆 Para o teu caso, recomendo o *Pacote D*: as 2 disciplinas com acesso até ao exame.\n\nFaltam ${months} meses: *${months} meses = ${fmt} MZN*.` }
    : { pkg: 'C', total, text: `🎯 Para o teu caso, recomendo o *Pacote C*: 1 disciplina com acesso até ao exame.\n\nFaltam ${months} meses: *${months} meses = ${fmt} MZN*.` };
}
