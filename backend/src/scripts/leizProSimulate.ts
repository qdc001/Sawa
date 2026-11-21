// Simulador da Leiz Pro (guia v21): corre conversas inteiras (situacoes normais
// e dificeis) pelo mesmo caminho do WhatsApp (modelo local + motor do guia),
// sem gravar nada na base de dados e sem enviar mensagens.
//
// No servidor (consola do backend):   node dist/scripts/leizProSimulate.js
// So um cenario:                      node dist/scripts/leizProSimulate.js 7
// Sem o modelo (so regras):           OLLAMA_URL=http://127.0.0.1:1 node dist/scripts/leizProSimulate.js

import { runTurn, INITIAL_STATE, type LeizProState } from '../lib/leizpro/engine';

type Scenario = { title: string; expect: string; turns: string[] };

const TRIGGER = 'Olá! Vi o anúncio da Zona Nerd e gostaria de saber como fazer parte.';
// Ate a pergunta do compromisso (respondida com "sim" no cenario).
const UNTIL_COMMIT = [TRIGGER, 'Chamo-me Elton Macamo, vou fazer exame na UEM', 'Medicina', 'falta de material para estudar', 'sim'];

const SCENARIOS: Scenario[] = [
  { title: 'Caminho feliz: marca a chamada', expect: 'saudacao, curso, conexao, vacinas, convite com 2 horas, escolhe a primeira, chamada na Agenda',
    turns: [...UNTIL_COMMIT, 'sim estou', 'a primeira', 'ok obrigado'] },
  { title: 'Escolhe amanha', expect: 'marca para a proposta de amanha',
    turns: [...UNTIL_COMMIT, 'sim', 'amanhã'] },
  { title: 'Escolhe uma hora propria', expect: 'marca as 17h (hoje ou amanha)',
    turns: [...UNTIL_COMMIT, 'sim', 'pode ser às 17h'] },
  { title: 'Hora fora do horario', expect: 'pede uma hora entre as 8h e as 20h, depois marca',
    turns: [...UNTIL_COMMIT, 'sim', 'às 22h', 'então às 19h'] },
  { title: 'Pede outra hora', expect: 'pergunta o melhor dia e hora, depois marca',
    turns: [...UNTIL_COMMIT, 'sim', 'hoje não posso', 'sexta às 10'] },
  { title: 'Nao pode falar por chamada', expect: 'passos para criar a conta por mensagem; a seguir equipa',
    turns: [...UNTIL_COMMIT, 'sim', 'não posso falar em chamada, prefiro escrever', 'ok vou tentar'] },
  { title: 'Hesita no compromisso', expect: 'amostra sem conta e proposta de contacto com 2 horas',
    turns: [...UNTIL_COMMIT, 'vou tentar', 'a segunda'] },
  { title: 'So o nome, sem universidade', expect: 'pergunta a universidade e o curso',
    turns: [TRIGGER, 'Elton', 'UEM, medicina', 'tempo'] },
  { title: 'So a universidade, sem nome', expect: 'pergunta o nome, depois o curso',
    turns: [TRIGGER, 'UP', 'Ana', 'Direito'] },
  { title: 'Tudo de uma vez', expect: 'salta a saudacao e vai a conexao',
    turns: ['Olá, sou a Ana Mussa, vou fazer UEM para Medicina'] },
  { title: 'Preco logo a partida e insiste', expect: '1.2 (gratis); depois explica o modo Super Nerd',
    turns: [TRIGGER, 'quanto custa?', 'mas quanto é?', '2 disciplinas por 1 mês'] },
  { title: 'Super Nerd a meio das vacinas', expect: 'valor calculado (2 disc, 2 meses = 570) e volta a pergunta do online',
    turns: [TRIGGER, 'Sou o Rui, UEM', 'Medicina', 'nada', 'quanto custa o super nerd?', 'duas disciplinas', '2 meses', 'sim'] },
  { title: 'Super Nerd com 3 disciplinas', expect: 'passa a equipa (por confirmar no guia)',
    turns: [...UNTIL_COMMIT, 'sim', 'a primeira', 'quero o modo super nerd', '3 disciplinas por 1 mês'] },
  { title: 'Depois da chamada marcada quer activar', expect: 'valor, "queres que te explique", pagamento na app',
    turns: [...UNTIL_COMMIT, 'sim', 'a primeira', 'quanto é o super nerd para 1 disciplina 1 mês?', 'sim', 'ok'] },
  { title: 'Ja pagou', expect: '4.1; se voltar a falar do pagamento, equipa',
    turns: [TRIGGER, 'já paguei, segue o comprovativo', 'paguei e ainda não abriu'] },
  { title: 'Nao percebi o compromisso', expect: 'explica e repete a pergunta',
    turns: [TRIGGER, 'Absalão \nUem', 'Quero me candidatar para o curso de Zootécnia', 'tenho dificuldade para memorizar', 'Sim.', 'Não percebi...', 'sim'] },
  { title: 'Prefere presencial na vacina do online', expect: 'responde presencial e repete a pergunta do online; se insistir, equipa',
    turns: [TRIGGER, 'Sou o Mario, UEM', 'Economia', 'tempo', 'prefiro presencial', 'não, quero mesmo presencial'] },
  { title: 'Sem dinheiro', expect: 'o gratis, as redes e convite para ligar; aceita',
    turns: [TRIGGER, 'Sou a Fatima, UEM', 'Biologia', 'material', 'agora não tenho dinheiro', 'sim'] },
  { title: 'Acha caro duas vezes', expect: 'resposta do gratis e volta a pergunta; a segunda vez equipa',
    turns: [TRIGGER, 'Sou o Tomas, UEM', 'Medicina', 'tempo', 'está muito caro', 'continua caro'] },
  { title: 'Codigo do e-mail', expect: 'passa a equipa (criacao de conta por confirmar)',
    turns: [TRIGGER, 'o site pede código do email'] },
  { title: 'Como instalo a app', expect: 'passa a equipa (link do APK por confirmar)',
    turns: [TRIGGER, 'como instalo a app?'] },
  { title: 'O que sao as vidas', expect: 'passa a equipa (vidas por confirmar)',
    turns: [TRIGGER, 'o que são as vidas?'] },
  { title: 'O link nao abre (com erro)', expect: 'resposta do link e volta a pergunta',
    turns: [TRIGGER, 'Sou a Lucia, UP', 'O link não abri...', 'Psicologia'] },
  { title: 'Audio', expect: 'pede para escrever; segundo audio equipa',
    turns: [TRIGGER, '[AUDIO]', '[AUDIO]'] },
  { title: 'Fora do tema', expect: 'repete a pergunta uma vez, depois equipa',
    turns: [TRIGGER, 'tudo bem?', 'ok'] },
  { title: 'Desconfianca', expect: 'passa a equipa',
    turns: [TRIGGER, 'isto é burla?'] },
  { title: 'Conheco alguem', expect: 'resposta do ecra Convidar',
    turns: [TRIGGER, 'Sou o Ivo, UEM', 'tenho um amigo que também quer'] },
  { title: 'Cobre o exame?', expect: 'resposta do guia (sem prometer)',
    turns: [TRIGGER, 'Sou a Eva, UEM', 'o conteúdo cobre tudo o que sai no exame?', 'Direito'] },
];

function show(label: string, lines: string[]) {
  lines.forEach((l, i) => console.log(`${i === 0 ? label : ' '.repeat(label.length)}${l.replace(/\n/g, '\n' + ' '.repeat(label.length))}`));
}

async function main() {
  const only = process.argv[2] ? Number(process.argv[2]) : null;
  const list = SCENARIOS.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => only === null || s.n === only);
  for (const sc of list) {
    console.log(`\n==================== ${sc.n}. ${sc.title}`);
    console.log(`Esperado: ${sc.expect}`);
    let st: LeizProState = { ...INITIAL_STATE };
    for (const msg of sc.turns) {
      const t0 = Date.now();
      const { u, d } = await runTurn(st, msg);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log('');
      show('ESTUDANTE: ', [msg]);
      const data = [u.name && `nome=${u.name}`, u.university && `uni=${u.university}`, u.course && `curso=${u.course}`,
        u.snCount && `sn_disc=${u.snCount}`, u.snMonths && `sn_meses=${u.snMonths}`]
        .filter(Boolean).join(' ');
      console.log(`  [${u.intent}/${u.intentSource}${u.modelError ? ' MODELO-ERRO:' + u.modelError : ''}] ${data} | ${st.step} -> ${d.next.step} | ${secs}s`);
      if (d.action === 'handoff') {
        console.log(`  >>> PASSA PARA A EQUIPA: ${d.reason}`);
      } else if (d.action === 'wait') {
        console.log(`  (sem resposta: ${d.reason})`);
      } else {
        show('  SHERONE:  ', d.parts);
        if (d.appointment) console.log(`  >>> AGENDA: "${d.appointment.title}" ${d.appointment.startsAtISO} (${d.appointment.durationMin} min) | ${d.appointment.notes}`);
      }
      st = d.next;
      if (d.action === 'handoff') break;
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
