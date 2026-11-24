// Teste de stress da Leiz Pro: poe a Sherone directamente em cada passo do guia
// e testa muitas respostas (certas, recusas, vagas, falta de dinheiro, girias,
// erros de escrita, emojis, perguntas fora do guia). Cada caso tem o resultado
// esperado; no fim lista os que falharam.
//
// Uso: OLLAMA_URL=http://127.0.0.1:11434 node dist/scripts/leizProStress.js [filtro]

import { runTurn, INITIAL_STATE, type LeizProState, type Decision } from '../lib/leizpro/engine';

type Exp = string; // ver check()

const BASE: LeizProState = { ...INITIAL_STATE, name: 'Elton Macamo', university: 'UEM', course: 'Medicina' };
const startAt = new Date(Date.now() + 86_400_000).toISOString();

const STATES: Record<string, { st: LeizProState; hist: string[] }> = {
  start: { st: { ...INITIAL_STATE }, hist: [] },
  name: {
    st: { ...INITIAL_STATE, step: 'diagnosis', lastKey: 'greeting', lastQuestion: 'greeting' },
    hist: ['Estudante: Olá! Vi o anúncio da Zona Nerd e gostaria de saber como fazer parte.', 'Zona Nerd: Olá! 😊 O meu nome é Sherone... Posso saber o teu nome e para que universidade estás a preparar o exame de admissão?'],
  },
  course: {
    st: { ...INITIAL_STATE, step: 'diagnosis', name: 'Elton', university: 'UEM', lastKey: 'askCourse', lastQuestion: 'askCourse' },
    hist: ['Estudante: Elton, UEM', 'Zona Nerd: Prazer, Elton! 😊 E para que curso te vais candidatar na UEM?'],
  },
  conn: {
    st: { ...BASE, step: 'connection', lastKey: 'connection', lastQuestion: 'connection' },
    hist: ['Estudante: Medicina', 'Zona Nerd: Boa, Elton! 😊 Já tentaste estudar para o exame antes? O que foi mais difícil?'],
  },
  online: {
    st: { ...BASE, step: 'ask_online', lastKey: 'vaccineOnline', lastQuestion: 'vaccineOnline', hardSubject: 'Química' },
    hist: ['Estudante: tenho dificuldade em química', 'Zona Nerd: Percebo... Tudo isto é online, ao teu ritmo. Estás à vontade para estudar online, pelo telemóvel?'],
  },
  commit: {
    st: { ...BASE, step: 'ask_commitment', lastKey: 'vaccineCommitment', lastQuestion: 'vaccineCommitment', hardSubject: 'Química' },
    hist: ['Estudante: sim', 'Zona Nerd: Certo, Elton... Por isso, a minha pergunta é: estás mesmo comprometido(a) a dar o teu melhor? 💪'],
  },
  pdf: {
    st: { ...BASE, step: 'pdf_sent', lastKey: 'packagesPdf', lastQuestion: 'packagesPdf', hardSubject: 'Química', regua: { startAt, sent: 0 }, offered: [{ iso: startAt, label: 'amanhã às 18h' }] },
    hist: ['Estudante: sim estou', 'Zona Nerd: Óptimo! 😊 Vou enviar-te os pacotes... [PDF] ... Vê com calma e abre o capítulo 1 de Química. Posso falar contigo amanhã às 18h para me dizeres com qual pacote vais ficar?'],
  },
  regua1: {
    st: { ...BASE, step: 'pdf_sent', lastKey: 'reguaContact1', lastQuestion: 'reguaContact1', hardSubject: 'Química', regua: { startAt, sent: 1 } },
    hist: ['Estudante: pode ser', 'Zona Nerd: Olá, Elton! 😊 Para quem vai fazer Medicina, uma das opções de preparação é o Pacote D... Lembrei-me de ti. Já decidiste com qual pacote vais ficar?'],
  },
  regua2: {
    st: { ...BASE, step: 'pdf_sent', lastKey: 'reguaContact2', lastQuestion: 'reguaContact2', regua: { startAt, sent: 2 } },
    hist: ['Zona Nerd: Olá, Elton. 😊 Sei que às vezes não é o momento certo. Se agora não quiseres avançar, diz-me só "agora não"... Se quiseres, continuo aqui para te ajudar a escolher.'],
  },
  paying: {
    st: { ...BASE, step: 'paying', lastKey: 'paymentChannels', lastQuestion: 'paymentChannels', pkg: 'Pacote D (570 MZN)', snCount: 2, snMonths: 2, payFollow: { at: startAt, sent: false } },
    hist: ['Estudante: quero o pacote D', 'Zona Nerd: Estes são os canais de pagamento 😊 ... Após o pagamento, peço que mandes o comprovativo por aqui, no WhatsApp.'],
  },
  payfu: {
    st: { ...BASE, step: 'paying', lastKey: 'payFollowup', lastQuestion: 'payFollowup', pkg: 'Pacote D (570 MZN)', snCount: 2, snMonths: 2, payFollow: { at: startAt, sent: true } },
    hist: ['Zona Nerd: Olá, Elton! 😊 Ontem escolheste o Pacote D (570 MZN). Conseguiste fazer o pagamento? Se já pagaste, manda-me aqui a foto do comprovativo...'],
  },
  account: {
    st: { ...BASE, step: 'account_help', lastKey: 'accountHelp', lastQuestion: 'accountHelp' },
    hist: ['Estudante: quero criar a conta', 'Zona Nerd: Boa, Elton! Vamos fazer juntos, passo a passo... Manda-me um print quando chegares às disciplinas.'],
  },
};

// Respostas por passo, com o esperado.
//  step:X        -> proximo passo X
//  key:A|B       -> a resposta usada foi uma destas mensagens
//  action:X      -> accao (send_text, send_pdf, wait, handoff)
//  safe          -> qualquer coisa MENOS avancar como se fosse "sim" (handoff, objeccao, repetir...)
//  money         -> resposta de falta de dinheiro (noMoney, reguaNotNow, payLater, notNow) ou equipa
const CASES: Array<[string, string, Exp]> = [];
const add = (state: string, exp: Exp, replies: string[]) => { for (const r of replies) CASES.push([state, r, exp]); };

// ---- Primeira mensagem ------------------------------------------------------
add('start', 'key:greeting', ['Olá! Vi o anúncio da Zona Nerd e gostaria de saber como fazer parte.', 'Ola vi o anuncio da zona nerd', 'Boa tarde, vi o anúncio e quero fazer parte da Zona Nerd']);
add('start', 'key:priceFirst|greeting', ['Vi o anúncio da Zona Nerd. Quanto custa?']);

// ---- Nome e universidade ----------------------------------------------------
add('name', 'step:diagnosis', ['Chamo-me Ana, UEM', 'Sou o Carlos, vou fazer UP', 'Meu nome é Fátima e quero a Unilúrio', 'Joana', 'UEM', 'eu sou Hélder da UniZambeze', 'Nome: Rui. Universidade: ISCTEM', 'Kátia, Instituto Industrial e Comercial de Maputo', 'Edson / UP Maputo']);
add('name', 'safe', ['Para que querem saber o meu nome?', 'Isto é burla?', 'Quanto custa?', 'És um robô?', 'ok', 'Claro', 'Sim', '😂😂', 'Bom dia', 'Sou estudante', 'Não sei ainda qual universidade', 'Ainda estou na 11ª classe', 'Quero só informações']);

// ---- Curso ------------------------------------------------------------------
add('course', 'step:connection', ['Medicina', 'Direito', 'Engenharia Civil', 'quero fazer economia', 'Curso de Contabilidade e Finanças', 'medecina', 'Eng. Informática', 'Psicologia', 'Biologia Marinha', 'Arquitectura']);
add('course', 'safe', ['Como assim?', 'Ainda não decidi', 'Qualquer um', 'Porquê?', 'Biologia e Química', 'tenho dúvida entre medicina e farmácia', 'Sim', 'ok', 'Não sei']);

// ---- Conexao (qualquer resposta segue) ----------------------------------------
add('conn', 'step:ask_online', ['Química', 'tenho dificuldade em matemática', 'Ainda não comecei', 'nada', 'Não consigo me concentrar', 'O tempo, trabalho de dia', 'Já tentei mas é muita matéria', 'memorizar', 'física é o meu problema', 'Tudo']);
add('conn', 'safe', ['Quanto custa?', 'Isto é pago?', 'É burla?']);

// ---- Vacina do online -------------------------------------------------------
add('online', 'step:ask_commitment', ['Sim', 'sim estou', 'Estou à vontade', 'Claro que sim', 'Yah', 'Yes', 'Pode ser', 'Sim, tenho smartphone', 'Estou sim', 'Com certeza', '👍', 'Sim estou tudo o que quero é entrar', 'Sem dúvida', 'Tou sim']);
add('online', 'safe', ['Não', 'Prefiro presencial', 'Estou falido', 'Estou ocupado agora', 'Não tenho telemóvel bom', 'A internet aqui é cara', 'Quanto custa?', 'Nunca estudei online', 'Depende', 'mais ou menos', 'Tenho medo de não conseguir', 'Estou sem dinheiro', 'Não tenho dados']);

// ---- Vacina do compromisso --------------------------------------------------
add('commit', 'action:send_pdf', ['Sim', 'Estou comprometido', 'Sim estou mesmo', 'Claro, quero entrar na UEM', 'Estou sim comprometida', 'Yeah claro', 'Tou sim chefe', 'Sim, darei o meu melhor', 'Com certeza 💪']);
add('commit', 'safe', ['Vou tentar', 'Depende', 'Não sei', 'Não percebi', 'Estou falido', 'Quanto custa?', 'Estou cansado', 'Talvez', 'Mais ou menos', 'Não tenho tempo', 'Primeiro quero ver como é']);

// ---- Depois dos pacotes ("posso falar contigo amanha as 18h?") --------------------
add('pdf', 'action:wait', ['Pode ser', 'Sim', 'Ok', 'Está bem', 'Combinado', 'Tudo bem... sem problemas', 'Amanhã às 18h', 'Ok obrigado', 'Pode', '👍', 'Sim, até amanhã']);
add('pdf', 'key:paymentChannels', ['Quero o pacote D', 'o B', 'Fico com o pacote A', 'Pacote C', 'vou querer o pacote D']);
add('pdf', 'money', ['Estou falido', 'Não tenho dinheiro agora', 'Só no fim do mês', 'Estou sem dinheiro', 'Agora não', 'Ainda não tenho condições']);
add('pdf', 'safe', ['Qual é a garantia que tenho?', 'Não abriu o PDF', 'Isto é burla?', 'Posso pagar depois de estudar?', 'O pagamento é antes ou depois?', 'Quantos dias são?', 'Tem desconto?']);

// ---- Regua 1 ("ja decidiste com qual pacote?") ---------------------------------
add('regua1', 'key:askPackage|paymentChannels', ['Sim', 'Sim, já decidi', 'Já']);
add('regua1', 'key:paymentChannels', ['O pacote D', 'Quero o B', 'Pacote A por favor']);
add('regua1', 'money', ['Estou falido', 'Agora não', 'Ainda não tenho dinheiro', 'Só no mês que vem', 'Estou sem condições', 'Tou liso']);
add('regua1', 'safe', ['Qual é o melhor para mim?', 'Ainda estou a pensar', 'Não sei qual escolher', 'Quanto é o C?', 'Isto é burla?', 'Não', 'Desisti']);

// ---- Regua 2 ("diz-me so agora nao") ----------------------------------------
add('regua2', 'money', ['Agora não', 'agora nao', 'Estou sem dinheiro']);
add('regua2', 'key:askPackage|paymentChannels', ['Sim, quero continuar', 'Quero o pacote D']);
add('regua2', 'safe', ['Para de me mandar mensagens', 'Não me incomode', 'Quem és tu?']);

// ---- A pagar ----------------------------------------------------------------
add('paying', 'action:handoff', ['Já paguei', 'Já fiz o pagamento', 'Paguei agora', '[IMAGE]', 'Segue o comprovativo', 'Transferi', 'Paguei mas não abriu']);
add('paying', 'action:wait', ['Ok', 'Está bem', 'Obrigado', 'Vou fazer agora']);
add('paying', 'money', ['Só consigo pagar no fim do mês', 'Amanhã pago', 'Estou falido', 'Ainda não tenho dinheiro', 'Pago na sexta', 'Quando receber o salário pago']);
add('paying', 'safe', ['Posso pagar com M-Pesa de outra pessoa?', 'É seguro?', 'Qual é o número do e-Mola?', 'Paguei o valor errado', 'Quero mudar para o pacote B']);

// ---- Follow-up de pagamento ---------------------------------------------------
add('payfu', 'action:handoff', ['Sim, já paguei', 'Já, mandei agora', '[IMAGE]']);
add('payfu', 'money', ['Ainda não', 'Ainda não consegui', 'Só no fim do mês', 'Estou falido', 'Amanhã']);
add('payfu', 'safe', ['Não vou pagar', 'Desisti', 'Isto é burla']);

// ---- A criar a conta --------------------------------------------------------
add('account', 'key:accountCreated|action:handoff', ['Já criei', 'Consegui', 'pronto já está', '[IMAGE]']);
add('account', 'action:handoff|key:emailCode|forgotPassword|accessProblem|linkProblem', ['Não chega o código', 'Esqueci a senha', 'O site não abre', 'Não consigo entrar']);
add('account', 'action:wait', ['Ok', 'Vou tentar', 'Está bem']);

// ==== Ronda 2: mais variantes (filtro "r2" corre so estas) ====================
const R2_START = CASES.length;
// as 5 falhas da ronda 1
add('online', 'safe', ['Estou ocupado agora']);
add('commit', 'safe', ['Estou cansado']);
add('regua1', 'money', ['Estou sem condições']);
add('paying', 'action:wait', ['Vou fazer agora']);
add('account', 'action:wait', ['Está bem']);

add('name', 'step:diagnosis', ['Boa noite, sou a Lurdes e vou concorrer para a UEM', 'me chamo Zé, unilurio', 'Lurdes 😊', 'Sou o Abel. UniSave', 'Chamo-me Neide e vou fazer exame na UP Maputo']);
add('name', 'safe', ['Tenho 17 anos', 'kkk', 'Não quero dizer', 'Vocês são de onde?', 'Ya', 'Pode ser']);

add('course', 'step:connection', ['Medicina geral', 'Enfermagem', 'Gestão', 'Ciências Farmacêuticas', 'Engenharia Mecânica', 'quero medicina mesmo']);
add('course', 'safe', ['Ainda estou a ver', 'Que cursos vocês têm?', 'Ajuda-me a escolher', 'Quanto custa?']);

add('conn', 'step:ask_online', ['kkk nada', 'Química e física', 'Biologia pá', 'Não tenho tempo', 'Não tenho material', '😔', 'Nunca estudei sozinho']);
add('conn', 'safe', ['Primeiro diz o preço']);

add('online', 'step:ask_commitment', ['Sim sim', 'Claro claro', 'Estou à vontade sim', 'Sim, uso o celular', 'Ya', 'Sim mano', 'Por mim tudo bem', 'Tudo bem']);
add('online', 'safe', ['Estou a trabalhar agora', 'Estou em aulas', 'Não tenho internet', 'Tou doente', 'Vocês têm explicação presencial?', 'Onde ficam?', 'Estou liso', 'Tou sem dinheiro']);

add('commit', 'action:send_pdf', ['Sim estou pronto', 'Estou mais que comprometido', '100%', 'Sim, quero muito entrar', 'Claro, é o meu sonho', 'Sim chefe 💪']);
add('commit', 'safe', ['Estou a pensar', 'Não sei se consigo', 'Vou ver', 'Estou doente', 'Estou a trabalhar', 'Tenho pouco tempo', 'Primeiro quero o preço', 'Estou ocupado']);

add('pdf', 'action:wait', ['Tá bem', 'Beleza', 'Fixe', 'Okay amanhã', 'Obrigada 🙏']);
add('pdf', 'key:paymentChannels', ['Vou ficar com o D', 'Escolho o pacote B', 'Quero o D']);
add('pdf', 'money', ['Estou liso', 'Não tenho massa', 'Tou duro', 'Estou sem condições agora']);
add('pdf', 'safe', ['Vou analisar', 'Qual é a diferença entre o C e o D?', 'Pode me ligar?', 'O capítulo 1 não abre', 'Estou ocupado', 'Estou cansado']);

add('regua1', 'money', ['Estou falido mano', 'Tou sem massa', 'Ainda não, estou apertado', 'Não tenho condições agora']);
add('regua1', 'key:paymentChannels', ['Vou ficar com o D', 'Escolhi o C']);
add('regua1', 'safe', ['Estou ocupado', 'Ainda estou a ver', 'Estou a decidir com os meus pais', 'Estou cansado disso', 'Estou a trabalhar']);

add('regua2', 'money', ['Agora não dá', 'Estou falido', 'Tou liso']);
add('regua2', 'safe', ['Estou ocupado', 'Já não quero', 'Estou cansado']);

add('paying', 'action:wait', ['Já vou fazer', 'Vou pagar agora', 'Daqui a pouco mando', 'Ok vou transferir agora', 'Tá bem']);
add('paying', 'action:handoff', ['Mandei por e-Mola', 'Pronto paguei', 'Fiz a transferência']);
add('paying', 'money', ['Só semana que vem', 'Estou liso', 'Estou sem dinheiro agora', 'Estou falido mano']);
add('paying', 'safe', ['Pode me dar desconto?', 'Quero desistir']);

add('payfu', 'money', ['Ainda não, mas amanhã pago', 'Tou liso', 'Estou sem condições']);
add('payfu', 'action:wait|handoff', ['Vou pagar agora', 'Já vou mandar']);

add('account', 'action:wait', ['Tá bem', 'Já vou criar', 'Vou fazer agora']);

// Ronda 4: passado vs futuro no pagamento
add('paying', 'action:handoff', ['Paguei', 'Já mandei', 'Transferi agora mesmo', 'Fiz a transferência agora']);
add('paying', 'money|action:handoff', ['Ainda não paguei', 'Não paguei ainda, só amanhã']);
add('payfu', 'action:handoff', ['Paguei ontem', 'Mandei o comprovativo ontem']);
add('regua1', 'key:paymentChannels', ['Prefiro o D', 'Fico no B']);
add('commit', 'safe', ['Estou indeciso', 'Estou a ver ainda']);
add('online', 'safe', ['Estou na rua agora, depois falamos', 'Pode me ligar?']);
add('account', 'action:handoff|key:emailCode|forgotPassword|accessProblem|linkProblem', ['Não recebi o email', 'Diz que o email já existe']);

// ---- Verificacao ------------------------------------------------------------
const MONEY_KEYS = ['noMoney', 'reguaNotNow', 'payLater', 'notNow'];
function check(stateName: string, before: LeizProState, d: Decision, exp: Exp): boolean {
  return exp.split('|').some((alt, i, all) => {
    // "key:a|b" -> os seguintes sem prefixo herdam o prefixo do primeiro
    let e = alt;
    if (!/^(step|key|action|safe|money)/.test(e)) {
      const prev = all.slice(0, i).reverse().find((x) => /^(step|key|action):/.test(x));
      if (prev) e = `${prev.split(':')[0]}:${alt}`;
    }
    if (e === 'safe') {
      // Nao pode avancar como se fosse um "sim".
      const advancedAsYes =
        (stateName === 'online' && d.next.step === 'ask_commitment') ||
        (stateName === 'commit' && d.action === 'send_pdf') ||
        (stateName === 'name' && d.next.step === 'diagnosis' && d.next.name && d.next.name !== before.name && /^(ok|claro|sim)$/i.test(d.next.name)) ||
        (['regua1', 'regua2'].includes(stateName) && d.next.lastKey === 'askPackage') ||
        (stateName === 'pdf' && d.action === 'wait' && d.next.regua);
      return !advancedAsYes;
    }
    if (e === 'money') return d.action === 'handoff' || MONEY_KEYS.includes(String(d.next.lastKey));
    const [kind, val] = e.split(':');
    if (kind === 'step') return d.next.step === val;
    if (kind === 'key') return d.action !== 'handoff' && d.action !== 'wait' && d.next.lastKey === val;
    if (kind === 'action') return d.action === val;
    return false;
  });
}

async function main() {
  const filter = process.argv[2] || '';
  const list = filter === 'r2' ? CASES.slice(R2_START) : CASES.filter(([s]) => !filter || s === filter);
  const fails: string[] = [];
  let total = 0;
  const t0 = Date.now();
  for (const [stateName, reply, exp] of list) {
    const { st, hist } = STATES[stateName];
    const t = Date.now();
    let d: Decision;
    let intent = '';
    try {
      const r = await runTurn({ ...st }, reply, undefined, hist);
      d = r.d; intent = `${r.u.intent}/${r.u.intentSource}${r.u.modelError ? ' ERRO:' + r.u.modelError : ''}`;
    } catch (e: any) {
      fails.push(`[${stateName}] "${reply}" -> EXCEPCAO ${e?.message || e}`);
      continue;
    }
    total += 1;
    const ok = check(stateName, st, d, exp);
    const out = d.action === 'handoff' ? `EQUIPA: ${d.reason}` : d.action === 'wait' ? `(sem resposta: ${d.reason})` : `${d.next.lastKey}: ${d.parts.join(' / ').replace(/\s+/g, ' ').slice(0, 140)}`;
    const line = `${ok ? 'OK  ' : 'FALHA'} [${stateName}] "${reply}" (esperado ${exp}) [${intent}] ${((Date.now() - t) / 1000).toFixed(1)}s\n      -> ${out}`;
    console.log(line);
    if (!ok) fails.push(line);
  }
  console.log(`\n==== ${total} casos em ${((Date.now() - t0) / 60000).toFixed(1)} min · ${fails.length} falhas`);
  for (const f of fails) console.log(f);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
