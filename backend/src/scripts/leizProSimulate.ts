// Simulador da Leiz Pro (guia v26): corre conversas inteiras (situacoes normais
// e dificeis) pelo mesmo caminho do WhatsApp (modelo local + motor do guia),
// sem gravar nada na base de dados e sem enviar mensagens.
//
// No servidor (consola do backend):   node dist/scripts/leizProSimulate.js
// So um cenario:                      node dist/scripts/leizProSimulate.js 7
// Sem o modelo (so regras):           OLLAMA_URL=http://127.0.0.1:1 node dist/scripts/leizProSimulate.js

import { runTurn, reguaTurn, reguaContext, INITIAL_STATE, type LeizProState } from '../lib/leizpro/engine';
import { T } from '../lib/leizpro/guide';

// Turno especial: chegou a hora do proximo contacto da regua (Fluxo 6).
const REGUA = '<<REGUA>>';

type Scenario = { title: string; expect: string; turns: string[] };

const TRIGGER = 'Olá! Vi o anúncio da Zona Nerd e gostaria de saber como fazer parte.';
// Ate a pergunta do compromisso (a do online respondida com "sim").
const UNTIL_COMMIT = [TRIGGER, 'Chamo-me Elton Macamo, vou fazer exame na UEM', 'Medicina', 'tenho dificuldade em Matemática', 'sim'];
// Ate aos pacotes (compromisso respondido com "sim").
const UNTIL_PDF = [...UNTIL_COMMIT, 'sim estou'];

const SCENARIOS: Scenario[] = [
  { title: 'Caminho feliz: pacotes, conta, "consegui"', expect: 'vacinas, PDF dos pacotes, passo a passo da conta, conta criada (capitulo 1 de Matematica, convites, proximo contacto), ok sem resposta',
    turns: [...UNTIL_PDF, 'quero criar a conta', 'pronto consegui', 'ok obrigado'] },
  { title: 'Print da conta', expect: 'equipa, com a mensagem de conta criada pronta como rascunho',
    turns: [...UNTIL_PDF, 'quero criar a conta', '[IMAGE]'] },
  { title: 'Escolhe o pacote D e paga', expect: 'canais de pagamento (aviso a equipa); comprovativo (imagem) -> equipa confirma',
    turns: [...UNTIL_PDF, 'quero o pacote D', '[IMAGE]'] },
  { title: 'Diz que pagou por texto', expect: 'equipa confirma (a Sherone nao confirma pagamentos)',
    turns: [...UNTIL_PDF, 'o pacote A', 'já paguei'] },
  { title: 'Imagem com legenda a meio do diagnostico', expect: 'equipa ve a imagem',
    turns: [TRIGGER, '[IMAGE] olha isto'] },
  { title: 'Escolhe so com a letra', expect: '"o B" -> Pacote B, 390 MZN e canais de pagamento',
    turns: [...UNTIL_PDF, 'o B'] },
  { title: 'Regua: aceita o dia combinado e nao responde', expect: 'fecho com capitulo 1 de Matematica e amanha as 18h; "pode ser" sem resposta; 3 contactos (caso real, "agora nao", despedida); depois nada',
    turns: [...UNTIL_PDF, 'Pode ser.', REGUA, REGUA, REGUA, REGUA] },
  { title: 'Regua: responde ao contacto 1 e escolhe', expect: '"sim ja decidi" -> com qual pacote; "o D" -> pagamento; a regua para',
    turns: [...UNTIL_PDF, 'Pode ser.', REGUA, 'sim, já decidi', 'o pacote D', REGUA] },
  { title: 'Regua: muda a hora combinada', expect: 'regua passa a contar da nova hora, sem resposta',
    turns: [...UNTIL_PDF, 'amanhã não dá, pode ser depois de amanhã às 19h'] },
  { title: 'Regua: "agora nao" no contacto 2', expect: 'capitulo 1 gratis e proximo contacto; a regua para',
    turns: [...UNTIL_PDF, 'ok', REGUA, REGUA, 'agora não', 'daqui a 2 semanas', REGUA] },
  { title: 'Regua: responde a despedida', expect: 'volta a pergunta do pacote',
    turns: [...UNTIL_PDF, 'ok', REGUA, REGUA, REGUA, 'sim quero continuar'] },
  { title: 'Edital: Medicina com dificuldade em Matematica', expect: 'Matematica nao sai no exame de Medicina (UEM): capitulo 1 de Biologia ou de Quimica',
    turns: [TRIGGER, 'Sou a Deise, vou fazer UEM', 'Medicina', 'tenho dificuldade em Matemática', 'sim', 'sim estou'] },
  { title: 'Edital: Medicina com dificuldade em Quimica', expect: 'capitulo 1 de Quimica',
    turns: [TRIGGER, 'Sou a Deise, vou fazer UEM', 'Medicina', 'fico perdida em Química', 'sim', 'sim estou'] },
  // ---- Conversas reais de 22/11 (noite) ---------------------------------------
  { title: 'Real 22/11: dois cursos de uma vez (Paula)', expect: 'aceita Quimica Ambiental e segue para a conexao',
    turns: [TRIGGER, 'Paula Mirasse\nUEM', 'Química ambiental e ,geologia e pesquisa mineral'] },
  { title: 'Real 22/11: "Claro" nao e nome', expect: 'pede o nome, sem "Prazer, Claro"',
    turns: [TRIGGER, 'Claro'] },
  { title: 'Real 22/11: "Nao consigo me concentrar" e uma dificuldade (Rosalina)', expect: '"Percebo..." e nao "Optimo"',
    turns: [TRIGGER, 'Chamo-me Rosalina, UEM', 'Medicina', 'Não consigo me concentrar'] },
  { title: 'Real 22/11: "Tudo bem... sem problemas" depois dos pacotes (Benedito)', expect: 'aceita o dia combinado, sem resposta',
    turns: [...UNTIL_PDF, 'Tudo bem... sem problemas'] },
  { title: 'Hesita no compromisso', expect: 'capitulo 1 sem conta e proximo contacto; "ok" sem resposta',
    turns: [...UNTIL_COMMIT, 'vou tentar', 'ok'] },
  { title: 'Agora nao, depois dos pacotes', expect: 'capitulo 1 gratis e proximo contacto',
    turns: [...UNTIL_PDF, 'hoje não', 'ok'] },
  { title: 'Ja criou a conta sozinho', expect: 'mensagem de conta criada (1.5.5)',
    turns: [...UNTIL_PDF, 'já criei a conta'] },
  { title: 'Gostou do capitulo 1 e escolhe', expect: 'conta criada; "gostei" -> com qual pacote; "o pacote C" -> pagamento',
    turns: [...UNTIL_PDF, 'sim', 'pronto já criei', 'gostei muito do capítulo 1', 'o pacote C'] },
  { title: 'So o nome, sem universidade', expect: 'pergunta a universidade e o curso',
    turns: [TRIGGER, 'Elton', 'UEM, medicina', 'tempo'] },
  { title: 'So a universidade, sem nome', expect: 'pergunta o nome, depois o curso',
    turns: [TRIGGER, 'UP', 'Ana', 'Direito'] },
  { title: 'Tudo de uma vez', expect: 'salta a saudacao e vai a conexao',
    turns: ['Olá, sou a Ana Mussa, vou fazer UEM para Medicina'] },
  { title: 'Preco logo a partida e insiste', expect: '1.2 (gratis); depois o modo Super Nerd e o valor (Pacote B 390)',
    turns: [TRIGGER, 'quanto custa?', 'mas quanto é?', '2 disciplinas por 1 mês', 'sim'] },
  { title: 'Super Nerd a meio das vacinas', expect: 'Pacote D 570; "sim" -> canais de pagamento',
    turns: [TRIGGER, 'Sou o Rui, UEM', 'Medicina', 'nada', 'quanto custa o super nerd?', 'duas disciplinas', '2 meses', 'sim'] },
  { title: 'Super Nerd com 3 disciplinas', expect: 'Pacote B com mais 1 disciplina = 540 MZN',
    turns: [...UNTIL_PDF, 'quero o modo super nerd', '3 disciplinas por 1 mês'] },
  { title: 'Ja pagou logo a partida', expect: 'equipa confirma',
    turns: [TRIGGER, 'já paguei, segue o comprovativo'] },
  { title: 'Nao percebi o compromisso', expect: 'explica e repete a pergunta',
    turns: [TRIGGER, 'Absalão \nUem', 'Quero me candidatar para o curso de Zootécnia', 'tenho dificuldade para memorizar', 'Sim.', 'Não percebi...', 'sim'] },
  { title: 'Prefere presencial', expect: 'pergunta porque; ao motivo responde como e online; se insistir, equipa',
    turns: [TRIGGER, 'Sou o Mario, UEM', 'Economia', 'tempo', 'prefiro presencial', 'porque aprendo melhor com o professor ao lado', 'não, quero mesmo presencial'] },
  { title: 'Sem dinheiro', expect: 'o gratis, as redes e proximo contacto',
    turns: [TRIGGER, 'Sou a Fatima, UEM', 'Biologia', 'material', 'agora não tenho dinheiro'] },
  { title: 'Acha caro duas vezes', expect: 'resposta do guia e volta a pergunta; a segunda vez equipa',
    turns: [TRIGGER, 'Sou o Tomas, UEM', 'Medicina', 'tempo', 'está muito caro', 'continua caro'] },
  { title: 'Codigo do e-mail', expect: 'resposta do codigo do e-mail (v26)',
    turns: [TRIGGER, 'o site pede código do email'] },
  { title: 'Esqueci a palavra-passe', expect: 'resposta do guia',
    turns: [TRIGGER, 'esqueci a minha senha'] },
  { title: 'Trocar disciplinas', expect: 'resposta do guia',
    turns: [TRIGGER, 'quero trocar as disciplinas da minha conta'] },
  { title: 'Acesso acabou', expect: 'progresso guardado; "o mesmo, pacote B" -> pagamento',
    turns: [TRIGGER, 'o meu acesso acabou, quero continuar', 'o pacote B'] },
  { title: 'Pagou o valor errado', expect: 'passa a equipa',
    turns: [TRIGGER, 'paguei o valor errado, quero devolução'] },
  { title: 'Como funciona estudar online', expect: 'resposta do guia',
    turns: [TRIGGER, 'Sou a Rita, UEM', 'como funciona estudar online?'] },
  { title: 'Como instalo a app', expect: 'passa a equipa (link do APK por confirmar)',
    turns: [TRIGGER, 'como instalo a app?'] },
  { title: 'O que sao as vidas', expect: 'resposta das vidas (v26)',
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
  // ---- Conversas reais de 21-22/11 -------------------------------------------
  { title: 'Real: instituto em vez de universidade (Danny)', expect: 'aceita "Centro dos professores" como instituicao',
    turns: [TRIGGER, 'Danny', 'Centro dos professores', 'Português  Geografia e  biologia  história'] },
  { title: 'Real: IFP e "como assim que curso" (Larissa)', expect: 'explica o curso com exemplos',
    turns: [TRIGGER, 'Chamo me Larissa e quero me preparar para IFP', 'E pra IFP,uma instituição, instituto de formação de professores', 'Como assim que curso', 'Formação de professores do ensino primário'] },
  { title: 'Real: "garantir um 15 valores" nao e "vou passar?" (Paulo)', expect: 'segue para a vacina do online',
    turns: [TRIGGER, 'Sou o Paulo, UEM', 'Direito', 'Ta sendo difícil saber quais materiais estudar e dominar pra garantir um 15 valores'] },
  { title: 'Real: "resolver exames anteriores" nao e acesso (Virginia)', expect: 'segue para a vacina do online',
    turns: [TRIGGER, 'Meu nome é Virgínia, Unilurio', 'Curso de ciências biologias.', 'Tentei. O que foi difícil pra mim é resolver exames anteriores.'] },
  { title: 'Real: sim compridos nas vacinas', expect: 'conta como sim; envia os pacotes',
    turns: [...UNTIL_COMMIT.slice(0, -1), 'Sim estou tudo o que quero é entrar para a universidade', 'Yeah Claro'] },
  { title: 'Real: "e gratis?" e Super Nerd "1" (Arlete)', expect: 'responde que e gratis; "1" depois de "duas disciplinas" e 1 mes',
    turns: [...UNTIL_PDF, 'Afinal não é mahala?', 'quanto custa o super nerd?', 'Duas disciplinas', '1'] },
  { title: 'Real: so pontos (Edvaldo)', expect: 'nao responde aos "."',
    turns: [TRIGGER, 'Edvaldo, UP de Nampula', '.', 'Engenharia elétrica', '.'] },
  { title: 'Real: "e IA ou pessoa?" (Rodina)', expect: 'passa a equipa',
    turns: [TRIGGER, 'Rodina\nUem', 'Estou a conversar com IA ou com uma pessoa?😭'] },
  { title: 'Real: agradecimentos depois da conta criada', expect: 'nao responde a nenhum',
    turns: [...UNTIL_PDF, 'já criei', 'Okay, até lá.', 'Incha Allah', 'Está bem. E muito obrigada pela informação ficarei ligada.'] },
  { title: 'Real: "e necessario?" (Fred)', expect: 'explica e repete a pergunta do curso',
    turns: [TRIGGER, 'Historia e português\nUp', 'Fred Manhiça', 'É necessário?', 'Jornalismo'] },
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
      if (msg === REGUA) {
        if (!st.regua || st.step !== 'pdf_sent' || st.regua.sent >= 3) { console.log('\n  (REGUA: nada a enviar, a regua parou)'); continue; }
        if (st.regua.sent === 0 && !reguaContext(st)) { console.log('\n  (REGUA: sem curso/disciplinas: nao envia e avisa a equipa)'); st = { ...st, regua: null }; continue; }
        const r = reguaTurn(st, T);
        console.log(`\n  --- regua: contacto ${st.regua.sent + 1} (sem resposta) ---`);
        show('  SHERONE:  ', r.parts);
        st = r.next;
        continue;
      }
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
        if (d.action === 'send_pdf') console.log('  >>> (o <<PDF>> e o PDF dos pacotes do catalogo; sem ele vao os pacotes em texto)');
        if (d.notify) console.log(`  >>> AVISO A EQUIPA: ${d.notify}`);
      }
      st = d.next;
      if (d.action === 'handoff') break;
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
