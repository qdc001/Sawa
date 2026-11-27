/**
 * Segunda opiniao (Gemini no Vertex): que mensagens vao ao Gemini, que opcoes
 * ele recebe e (com credenciais) o que escolhe.
 *
 *   npx ts-node --transpile-only src/scripts/leizProVertexTest.ts          (so encaminhamento, sem gastar)
 *   VERTEX_API_KEY=... npx ts-node --transpile-only src/scripts/leizProVertexTest.ts live
 */
import { INITIAL_STATE, type LeizProState, decide, needsSecondOpinion, secondOpinion, runTurn } from '../lib/leizpro/engine';
import { understand } from '../lib/leizpro/understand';
import { vertexEnabled, vertexSpend } from '../lib/leizpro/vertex';

const base = (p: Partial<LeizProState>): LeizProState => ({ ...INITIAL_STATE, name: 'Ana', university: 'UEM', course: 'Medicina', ...p });

// [descricao, estado, mensagem, esperado: 'leiz' (responde sozinha) | 'gemini']
const CASES: [string, LeizProState, string, 'leiz' | 'gemini'][] = [
  ['sim no online', base({ step: 'ask_online', lastKey: 'askOnline' as any }), 'Sim', 'leiz'],
  ['nao no compromisso', base({ step: 'ask_commitment', lastKey: 'askCommitment' as any }), 'Não', 'leiz'],
  ['dados por regra', base({ step: 'diagnosis', name: null, university: null, course: null }), 'Chamo-me Elton, UEM', 'leiz'],
  ['pacote escolhido', base({ step: 'pdf_sent' }), 'Quero o pacote B', 'leiz'],
  ['cumprimento de volta', base({ step: 'connection' }), 'Estou bem e você está bem?', 'gemini'],
  ['mistura assuntos', base({ step: 'pdf_sent' }), 'Gostei dos pacotes mas o meu irmão também quer, ele faz Direito na UP, dá para os dois juntos?', 'gemini'],
  ['resposta vaga longa', base({ step: 'connection' }), 'Tipo eu estudei sozinho no ano passado mas não deu muito certo porque trabalhava', 'gemini'],
  ['fora do tema', base({ step: 'ask_commitment' }), 'Vocês também dão explicação para a 12a classe?', 'gemini'],
];

// Casos extremos (sem resposta esperada fixa: para ler o que o Gemini escolhe).
const EXTREME: [string, LeizProState, string][] = [
  ['pagar metade', base({ step: 'pdf_sent' }), 'Quanto custa mesmo o pacote C? E posso pagar metade agora e metade no fim do mês?'],
  ['numero errado', base({ step: 'paying', pkg: 'Pacote B' }), 'Mandei o dinheiro para o número errado, o que faço agora?'],
  ['so dados moveis', base({ step: 'ask_online' }), 'Não tenho internet em casa, só uso dados móveis quando vou à escola, dá para estudar assim?'],
  ['reprovou 2 vezes', base({ step: 'connection' }), 'Reprovei duas vezes na UEM por causa de Matemática, já estou cansado'],
  ['so a noite', base({ step: 'ask_commitment' }), 'Sim mas só posso estudar à noite depois do serviço, serve?'],
  ['mae na africa do sul', base({ step: 'pdf_sent' }), 'A minha mãe é que vai pagar, ela está em Joanesburgo, pode mandar por Mukuru?'],
  ['dados numa frase', base({ step: 'diagnosis', name: null, university: null, course: null }), 'Boa tarde, sou o Fernando do IFP de Chimoio, quero fazer exame de Matemática e Português para Ensino Básico'],
  ['pagina branca', base({ step: 'account_help', pkg: 'Pacote B' }), 'Criei a conta mas não aparece nenhuma disciplina, só aparece uma página branca'],
  ['nao entende videos', base({ step: 'active', lastKey: 'accessMid' as any }), 'Estou no capítulo 4 de Física mas não entendo nada dos vídeos, são muito rápidos'],
  ['burla', base({ step: 'pdf_sent' }), 'Isto não é burla? Já fui enganado antes por um grupo de explicações no Facebook'],
  ['so 2 amigos', base({ step: 'ambassador' }), 'Não tenho 5 amigos que vão fazer exame, só tenho 2, pode ser?'],
  ['vago kkk', base({ step: 'connection' }), 'kkkk sei lá, é difícil tudo'],
  ['vou pensar', base({ step: 'pdf_sent' }), 'Vou pensar e depois digo algo'],
  ['quimica 2 meses', base({ step: 'pdf_sent' }), 'Quero só Química por 2 meses, quanto fica?'],
  ['quer pessoa', base({ step: 'ask_online' }), 'Vocês são robôs? Quero falar com uma pessoa'],
];

async function extreme() {
  if (!vertexEnabled()) { console.log('Sem credenciais do Vertex.'); process.exit(1); }
  const t0 = Date.now();
  let toGemini = 0;
  for (const [desc, st, msg] of EXTREME) {
    const r = await runTurn({ ...st }, msg, undefined, []);
    if (r.so) toGemini++;
    const who = r.so?.used ? `GEMINI opcao ${r.so.choice}/${r.so.options} (${r.so.confidence}): ${r.so.motive}`
      : r.so ? `gemini sem chamada (${r.so.error || `${r.so.options ?? 0} opcoes`})` : `LEIZ (${r.u.intent}/${r.u.intentSource})`;
    console.log(`\n## ${desc} [${st.step}] "${msg}"\n   ${who}\n   -> ${r.d.action}: ${r.d.parts.join(' || ').replace(/\s+/g, ' ').slice(0, 320)}`);
  }
  const s = vertexSpend();
  console.log(`\n==== ${EXTREME.length} casos em ${((Date.now() - t0) / 60000).toFixed(1)} min · ${toGemini} ao Gemini · gasto ${s.usd.toFixed(4)} USD em ${s.calls} chamadas`);
}

async function main() {
  if (process.argv.includes('extreme')) return extreme();
  const live = process.argv.includes('live');
  if (live && !vertexEnabled()) { console.log('Sem credenciais do Vertex (VERTEX_API_KEY ou VERTEX_SA_JSON).'); process.exit(1); }
  let fails = 0;
  for (const [desc, st, msg, want] of CASES) {
    const u = await understand(msg, 'contexto de teste', null, []);
    const d = decide(st, u, msg);
    const why = needsSecondOpinion(st, u, d, msg);
    const got = why ? 'gemini' : 'leiz';
    const ok = got === want;
    if (!ok) fails++;
    console.log(`${ok ? 'OK   ' : 'FALHA'} ${desc}: ${got}${why ? ` (${why})` : ''} | local: ${d.action} ${d.reason.slice(0, 70)}`);
    if (live && why) {
      const r = await secondOpinion(st, u, d, msg, [], why);
      console.log(`      Gemini: ${r.so.error ? `erro ${r.so.error}` : `opcao ${r.so.choice}/${r.so.options} (${r.so.confidence}) ${r.so.motive}`}`);
      console.log(`      -> ${r.d.action}: ${r.d.parts.join(' || ').slice(0, 160)}`);
    }
  }
  if (live) { const s = vertexSpend(); console.log(`Gasto: ${s.usd.toFixed(4)} USD em ${s.calls} chamadas`); }
  console.log(`==== ${CASES.length} casos · ${fails} falhas`);
}

main().catch((e) => { console.error(e); process.exit(1); });
