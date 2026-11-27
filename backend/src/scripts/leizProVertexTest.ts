/**
 * Segunda opiniao (Gemini no Vertex): que mensagens vao ao Gemini, que opcoes
 * ele recebe e (com credenciais) o que escolhe.
 *
 *   npx ts-node --transpile-only src/scripts/leizProVertexTest.ts          (so encaminhamento, sem gastar)
 *   VERTEX_API_KEY=... npx ts-node --transpile-only src/scripts/leizProVertexTest.ts live
 */
import { INITIAL_STATE, type LeizProState, decide, needsSecondOpinion, secondOpinion } from '../lib/leizpro/engine';
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

async function main() {
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
