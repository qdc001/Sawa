// Simulador da Leiz Pro: corre conversas inteiras (situacoes normais e dificeis)
// pelo mesmo caminho do WhatsApp (modelo local + motor do guia), sem gravar nada
// na base de dados e sem enviar mensagens.
//
// No servidor (consola do backend):   node dist/scripts/leizProSimulate.js
// So um cenario:                      node dist/scripts/leizProSimulate.js 7
// Sem o modelo (so regras):           OLLAMA_URL=http://127.0.0.1:1 node dist/scripts/leizProSimulate.js

import { runTurn, INITIAL_STATE, type LeizProState } from '../lib/leizpro/engine';

type Scenario = { title: string; expect: string; turns: string[] };

const TRIGGER = 'Olá! Vi o anúncio da Zona Nerd e gostaria de saber como fazer parte.';

const SCENARIOS: Scenario[] = [
  { title: 'Caminho feliz completo', expect: 'chega aos pacotes com 1 pacote calculado e passa a equipa para pagar',
    turns: [TRIGGER, 'Chamo-me Elton Macamo, vou fazer exame na UEM', 'Medicina', 'Biologia e Química', 'sim, faltava material para estudar', 'sim', 'sim estou', 'sim consigo', 'em fevereiro', 'quero o pacote D'] },
  { title: 'So o nome, sem universidade', expect: 'pergunta a universidade e o curso, depois segue',
    turns: [TRIGGER, 'Elton', 'UEM, medicina', 'matematica e fisica'] },
  { title: 'So a universidade, sem nome', expect: 'pergunta o nome, depois o curso',
    turns: [TRIGGER, 'UP', 'Ana', 'Direito'] },
  { title: 'Tudo de uma vez na primeira mensagem', expect: 'salta a saudacao e vai directo a conexao',
    turns: ['Olá, sou a Ana Mussa, vou fazer UEM para Medicina, as disciplinas são biologia e química, exame em fevereiro'] },
  { title: 'Ignora a pergunta e pergunta o preco', expect: 'explica que depende (1.2); se insistir, repete e depois equipa',
    turns: [TRIGGER, 'quanto custa?', 'mas quanto é?', 'diz só o preço'] },
  { title: 'Responde com outra coisa (fora do tema)', expect: 'repete a pergunta uma vez, depois passa a equipa',
    turns: [TRIGGER, 'tudo bem?', 'ok'] },
  { title: 'Corrige a universidade', expect: 'fica com UP (a correccao)',
    turns: [TRIGGER, 'Sou o Carlos, vou fazer UEM', 'desculpa, afinal é UP', 'Engenharia Civil'] },
  { title: 'Nao sabe as disciplinas', expect: 'passa a equipa para confirmar, com rascunho "vou confirmar"',
    turns: [TRIGGER, 'Chamo-me Joana, UEM', 'Arquitectura', 'não sei quais são'] },
  { title: 'Disciplina que a Zona Nerd nao tem', expect: 'Passo 1.6: diz que falta e sugere as disponiveis',
    turns: [TRIGGER, 'Sou o Pedro, vou fazer UEM', 'Relações Internacionais', 'história e inglês', 'nunca estudei sozinho'] },
  { title: 'So disciplinas que nao temos', expect: 'passa a equipa (ser honesto, nao insistir)',
    turns: [TRIGGER, 'Sou a Rita, ISCTEM', 'Línguas', 'inglês e francês'] },
  { title: 'Prefere presencial na vacina do online', expect: 'responde presencial; se voltar a recusar, equipa',
    turns: [TRIGGER, 'Sou o Mario, UEM', 'Economia', 'matematica', 'falta de tempo', 'prefiro presencial', 'não, quero mesmo presencial'] },
  { title: 'Hesita no compromisso', expect: 'sugere o capitulo 1 gratis sem forcar',
    turns: [TRIGGER, 'Sou o Luis, UP', 'Matemática', 'matematica e fisica', 'nada', 'sim', 'vou tentar'] },
  { title: 'Sem dinheiro na vacina do orcamento', expect: 'passa a equipa para marcar dia e hora',
    turns: [TRIGGER, 'Sou a Fatima, UEM', 'Biologia', 'biologia e quimica', 'falta de material', 'sim', 'sim', 'agora não tenho dinheiro, só no mês que vem'] },
  { title: 'Acha caro duas vezes', expect: 'primeira vez: resposta do guia; segunda: equipa',
    turns: [TRIGGER, 'Sou o Tomas, UEM', 'Medicina', 'biologia e quimica', 'tempo', 'sim', 'sim', 'sim', 'março', 'está muito caro', 'continua caro'] },
  { title: 'Problema de acesso a meio do diagnostico', expect: 'responde o acesso e depois continua no mesmo passo',
    turns: [TRIGGER, 'Sou a Lucia, UP', 'o site pede código do email', 'Psicologia'] },
  { title: 'Ja pagou logo no inicio', expect: 'passa a equipa (validar comprovativo)',
    turns: [TRIGGER, 'já paguei, segue o comprovativo'] },
  { title: 'Audio em vez de texto', expect: 'pede para escrever; segundo audio: equipa',
    turns: [TRIGGER, '[AUDIO]', '[AUDIO]'] },
  { title: 'Respostas de uma palavra / emoji', expect: 'repete a pergunta e depois equipa (nao inventa)',
    turns: [TRIGGER, '👍', 'hmm'] },
  { title: 'Data relativa do exame', expect: 'calcula com "daqui a 4 meses"',
    turns: [TRIGGER, 'Sou o Nuno, UEM', 'Medicina', 'quimica', 'nada', 'sim', 'sim', 'sim', 'daqui a 4 meses'] },
  { title: 'Exame em menos de 2 meses', expect: 'recomenda A ou B (2 meses), nao C/D',
    turns: [TRIGGER, 'Sou a Celia, UEM', 'Medicina', 'biologia', 'nada', 'sim', 'sim', 'sim', 'daqui a 1 mes'] },
  { title: 'Nao sabe a data do exame', expect: 'repete uma vez e depois equipa',
    turns: [TRIGGER, 'Sou o Rui, UEM', 'Medicina', 'biologia', 'nada', 'sim', 'sim', 'sim', 'não sei ainda'] },
  { title: 'Pergunta de conteudo fora do guia', expect: 'passa a equipa',
    turns: [TRIGGER, 'Sou a Eva, UEM', 'tem videos de fisica?'] },
  { title: 'Quer so 1 mes', expect: 'resposta do guia (o mais curto e o A)',
    turns: [TRIGGER, 'Sou o Abel, UEM', 'Medicina', 'biologia', 'nada', 'sim', 'sim', 'sim', 'só quero 1 mês'] },
  { title: 'Pergunta se o pagamento e seguro', expect: 'resposta do guia e mantem o passo',
    turns: [TRIGGER, 'Sou o Dino, UP', 'é seguro pagar?', 'Gestão'] },
  { title: 'Varias mensagens seguidas numa so volta', expect: 'apanha nome, universidade e curso juntos',
    turns: [TRIGGER, 'oi\nsou o Jorge\nvou fazer na UEM\npara Direito'] },
  { title: 'Nome que parece palavra comum', expect: 'nao aceita "Sim" ou "Obrigado" como nome',
    turns: [TRIGGER, 'Sim', 'obrigado'] },
  { title: 'Muda as disciplinas depois dos pacotes', expect: 'recalcula o pacote',
    turns: [TRIGGER, 'Sou o Ivo, UEM', 'Medicina', 'biologia', 'nada', 'sim', 'sim', 'sim', 'fevereiro', 'afinal é biologia e química'] },
  { title: 'Insulto / mensagem estranha', expect: 'nao responde com o fluxo: repete ou equipa',
    turns: [TRIGGER, 'isto é burla?', 'vocês são burladores'] },
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
        u.subjects.length && `disc=${u.subjects.join('+')}`, u.missingSubjects.length && `falta=${u.missingSubjects.join('+')}`,
        u.examMonth !== null && `mes=${u.examMonth + 1}`, u.examMonthsAhead !== null && `daqui=${u.examMonthsAhead}m`]
        .filter(Boolean).join(' ');
      console.log(`  [${u.intent}/${u.intentSource}${u.modelError ? ' MODELO-ERRO:' + u.modelError : ''}] ${data} | ${st.step} -> ${d.next.step} | ${secs}s`);
      if (d.action === 'handoff') {
        console.log(`  >>> PASSA PARA A EQUIPA: ${d.reason}`);
      } else {
        show('  SHERONE:  ', d.parts);
      }
      st = d.next;
      if (d.action === 'handoff') break;
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
