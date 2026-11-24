// Testes dos follow-ups por etapa (guia v31), sem modelo nem base de dados:
//  1. Horas pelos tiques do WhatsApp (fuTiming.ts).
//  2. Texto de cada follow-up de cada etapa (sem campos por preencher, "Bom
//     dia" certo, 3 por etapa e depois a Reactivacao).
//
// Uso: npx ts-node --transpile-only src/scripts/leizProFuTest.ts

import { fuDue, nextSendTime, type FuInput } from '../lib/leizpro/fuTiming';
import { fuTurn, fuStageOf, FU_KEYS, INITIAL_STATE, hasPlaceholders, type LeizProState, type FuStage } from '../lib/leizpro/engine';

let fails = 0;
let total = 0;
function ok(cond: boolean, what: string, extra = '') {
  total += 1;
  if (!cond) { fails += 1; console.log(`FALHA ${what}${extra ? ` -> ${extra}` : ''}`); } else console.log(`OK    ${what}`);
}

// Hora de Maputo -> Date (UTC+2). d: dia de Novembro 2026.
const M = (d: number, h: number, min = 0) => new Date(Date.UTC(2026, 10, d, h - 2, min));
const hm = (x: Date | null | undefined) => {
  if (!x) return 'null';
  const l = new Date(x.getTime() + 2 * 3600_000);
  return `${l.getUTCDate()}/${l.getUTCHours()}h${String(l.getUTCMinutes()).padStart(2, '0')}`;
};
const inWindow = (x: Date) => { const h = new Date(x.getTime() + 2 * 3600_000); const v = h.getUTCHours() + h.getUTCMinutes() / 60; return (v >= 12 && v < 13) || (v >= 18 && v < 20); };

const base = (over: Partial<FuInput['last']>, sent = 0, receiptsOff = false): FuInput => ({
  sent, receiptsOff,
  last: { status: 'READ', createdAt: M(24, 10), deliveredAt: M(24, 10, 1), readAt: M(24, 10, 30), ...over },
});

// ---- 1. Tiques --------------------------------------------------------------
console.log('\n== Horas pelos tiques ==');
// ✓ um so tique: nada.
ok(fuDue(base({ status: 'SENT', deliveredAt: null, readAt: null })) === null, '✓ um tique: nao manda nada');
ok(fuDue(base({ status: 'PENDING', deliveredAt: null, readAt: null })) === null, 'pendente: nao manda nada');
ok(fuDue(base({ status: 'FAILED', deliveredAt: null, readAt: null })) === null, 'falhou: nao manda nada');
// ✓✓ azul: lida as 10h30 -> +3h = 13h30 -> janela seguinte 18h.
let d = fuDue(base({}));
ok(!!d && hm(d.at) === '24/18h00' && d.kind === 'fu', '✓✓ azul lida as 10h30: 1.o follow-up as 18h (3 a 4h depois, na janela)', hm(d?.at));
// Lida as 9h -> 12h.
d = fuDue(base({ readAt: M(24, 9) }));
ok(!!d && hm(d.at) === '24/12h00', '✓✓ azul lida as 9h: 1.o follow-up as 12h', hm(d?.at));
// Lida as 15h30 -> 18h30 (dentro da janela).
d = fuDue(base({ readAt: M(24, 15, 30) }));
ok(!!d && hm(d.at) === '24/18h30', '✓✓ azul lida as 15h30: 1.o follow-up as 18h30', hm(d?.at));
// Lida as 19h (noite) -> dia seguinte 12h.
d = fuDue(base({ createdAt: M(24, 18, 50), deliveredAt: M(24, 18, 50), readAt: M(24, 19) }));
ok(!!d && hm(d.at) === '25/12h00', '✓✓ azul lida as 19h: 1.o follow-up no dia seguinte as 12h', hm(d?.at));
// Lida as 23h -> dia seguinte 12h (nunca depois das 21h).
d = fuDue(base({ readAt: M(24, 23) }));
ok(!!d && hm(d.at) === '25/12h00', '✓✓ azul lida as 23h: dia seguinte as 12h', hm(d?.at));
// ✓✓ cinzento (enviada as 12h10, entregue): 24h depois, a outra hora do dia -> 25/18h.
d = fuDue(base({ status: 'DELIVERED', createdAt: M(24, 12, 10), deliveredAt: M(24, 12, 10), readAt: null }));
ok(!!d && hm(d.at) === '25/18h00' && d.kind === 'fu', '✓✓ cinzento enviada as 12h10: 1.o follow-up 24h depois, a outra hora (18h)', hm(d?.at));
// ✓✓ cinzento enviada as 10h -> 25/12h (10h nao e janela: 24h depois -> 12h).
d = fuDue(base({ status: 'DELIVERED', readAt: null }));
ok(!!d && hm(d.at) === '25/12h00', '✓✓ cinzento enviada as 10h: 1.o follow-up no dia seguinte as 12h', hm(d?.at));
// Um tique que passou a dois tiques mais tarde: conta a partir da entrega.
d = fuDue(base({ status: 'DELIVERED', createdAt: M(24, 10), deliveredAt: M(25, 9), readAt: null }));
ok(!!d && hm(d.at) === '26/12h00', '✓ -> ✓✓ entregue no dia seguinte as 9h: conta a partir da entrega (26/12h)', hm(d?.at));
// 2.o follow-up: o 1.o foi visto -> no dia seguinte.
d = fuDue(base({ createdAt: M(24, 18), deliveredAt: M(24, 18), readAt: M(24, 18, 30) }, 1));
ok(!!d && hm(d.at) === '25/12h00' && d.kind === 'fu', '2.o follow-up (1.o visto): dia seguinte as 12h', hm(d?.at));
// 3.o: dois dias depois.
d = fuDue(base({ createdAt: M(25, 12), deliveredAt: M(25, 12), readAt: M(25, 12, 5) }, 2));
ok(!!d && hm(d.at) === '27/12h00' && d.kind === 'fu', '3.o follow-up: dois dias depois as 12h', hm(d?.at));
// 1.o follow-up continua cinzento (48h sem ver): ultima tentativa e parar.
d = fuDue(base({ status: 'DELIVERED', createdAt: M(25, 12), deliveredAt: M(25, 12), readAt: null }, 1));
ok(!!d && d.kind === 'last' && hm(d.at) === '26/18h00', '✓✓ cinzento ao fim de 48h: ultima tentativa no dia seguinte, a outra hora', `${d?.kind} ${hm(d?.at)}`);
// Depois do 3.o: Reactivacao 16 dias depois.
d = fuDue(base({ createdAt: M(1, 12), deliveredAt: M(1, 12), readAt: M(1, 13) }, 3));
ok(!!d && d.kind === 'reactivation' && hm(d.at) === '17/12h00', 'depois do 3.o: Reactivacao 16 dias depois', `${d?.kind} ${hm(d?.at)}`);
ok(fuDue(base({}, 4)) === null, 'depois da Reactivacao: nada');
// Confirmacao de leitura desligada: "visto" ao fim de 24h (+3h).
d = fuDue(base({ status: 'DELIVERED', readAt: null }, 0, true));
ok(!!d && d.kind === 'fu' && hm(d.at) === '25/18h00', 'leitura desligada: tratar como visto ao fim de 24h', hm(d?.at));
// Todas as horas dentro das janelas.
let allIn = true;
for (let h = 0; h < 24; h++) for (const st of ['READ', 'DELIVERED'] as const) for (let sent = 0; sent < 4; sent++) {
  const x = fuDue(base({ status: st, createdAt: M(24, h), deliveredAt: M(24, h), readAt: st === 'READ' ? M(24, h, 20) : null }, sent));
  if (x && !inWindow(x.at)) { allIn = false; console.log('  fora da janela:', st, h, sent, hm(x.at)); }
  if (x && x.at.getTime() < M(24, h).getTime()) { allIn = false; console.log('  antes da mensagem:', st, h, sent, hm(x.at)); }
}
ok(allIn, 'todas as horas calculadas ficam das 12h as 13h ou das 18h as 20h, e nunca antes da mensagem');
ok(hm(nextSendTime(M(24, 20, 30))) === '25/12h00', 'depois das 20h passa para o dia seguinte (nunca depois das 21h)');

// ---- 2. Textos ----------------------------------------------------------------
console.log('\n== Textos dos follow-ups ==');
const B: LeizProState = { ...INITIAL_STATE, name: 'Elton Macamo', university: 'UEM', course: 'Medicina' };
const STAGE_STATES: Record<FuStage, LeizProState> = {
  course: { ...INITIAL_STATE, step: 'diagnosis', name: 'Elton', university: 'UEM', lastKey: 'askCourse', lastQuestion: 'askCourse' },
  connection: { ...B, step: 'connection', lastKey: 'connection', lastQuestion: 'connection' },
  online: { ...B, step: 'ask_online', lastKey: 'vaccineOnline', lastQuestion: 'vaccineOnline' },
  commit: { ...B, step: 'ask_commitment', lastKey: 'vaccineCommitment', lastQuestion: 'vaccineCommitment' },
  account: { ...B, step: 'account_help', lastKey: 'accountHelp', lastQuestion: 'accountHelp' },
  package: { ...B, step: 'pdf_sent', lastKey: 'liked', lastQuestion: 'liked' },
  pay: { ...B, step: 'paying', lastKey: 'paymentChannels', lastQuestion: 'paymentChannels', pkg: 'Pacote D (570 MZN)', payFollow: { at: new Date().toISOString(), sent: false } },
  amb: { ...B, step: 'ambassador', lastKey: 'noMoney', lastQuestion: 'noMoney' },
  ambNo: { ...B, step: 'ambassador', lastKey: 'ambNo', lastQuestion: 'ambNo' },
};
for (const [stage, st0] of Object.entries(STAGE_STATES) as Array<[FuStage, LeizProState]>) {
  ok(fuStageOf(st0) === stage, `etapa detectada: ${stage}`, String(fuStageOf(st0)));
  let st = st0;
  const keys: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = fuTurn(st, 'fu', M(25, i === 0 ? 12 : 18));
    if (!t) { ok(false, `${stage}: follow-up ${i + 1} gerado`); break; }
    keys.push(t.key);
    const all = t.parts.join('\n');
    ok(!hasPlaceholders(t.parts) && !/\[[A-Z]|\{|undefined|null|, ,|Para ,/.test(all), `${stage} ${i + 1}.o (${t.key}): sem campos por preencher`, all.slice(0, 140));
    ok(!/^Bom dia/.test(t.parts[0]), `${stage} ${i + 1}.o: sem "Bom dia" a tarde/noite`, t.parts[0].slice(0, 40));
    ok(/Elton/.test(all), `${stage} ${i + 1}.o: usa o nome`);
    ok(!/viste a minha mensagem|aguardo o teu retorno/i.test(all), `${stage} ${i + 1}.o: nunca "viste a minha mensagem?"`);
    ok(t.next.fu?.n === i + 1 && t.next.step === st0.step, `${stage} ${i + 1}.o: conta ${i + 1} e fica na etapa`);
    st = t.next;
  }
  ok(JSON.stringify(keys) === JSON.stringify(FU_KEYS[stage]), `${stage}: os 3 follow-ups do guia, por ordem`, keys.join(','));
  const r = fuTurn(st, 'reactivation', M(30, 12));
  ok(!!r && r.key === 'reactivation' && r.next.fu?.n === 4, `${stage}: depois do 3.o, a Reactivacao`);
  ok(fuTurn(r!.next, 'fu', M(30, 18)) === null, `${stage}: depois da Reactivacao, nada`);
  // Cinzento: 1.o e depois a ultima tentativa (o fecho).
  const g1 = fuTurn(st0, 'fu', M(25, 12))!;
  const g2 = fuTurn(g1.next, 'last', M(26, 18))!;
  ok(g2.key === FU_KEYS[stage][2] && g2.next.fu?.n === 3, `${stage}: ultima tentativa (cinzento) e o fecho da etapa`);
}
// Sem nome: "[NOME], muitos estudantes" -> "Muitos estudantes"
{
  const t = fuTurn({ ...STAGE_STATES.amb, name: null }, 'fu', M(25, 12))!;
  ok(/^Muitos estudantes/.test(t.parts[0]), 'sem nome: "[NOME], muitos..." fica "Muitos..."', t.parts[0].slice(0, 40));
}
// "Bom dia" -> "Boa tarde" (12h) / "Boa noite" (18h)
{
  const a = fuTurn({ ...STAGE_STATES.course, fu: { stage: 'course', n: 1 } }, 'fu', M(25, 12, 30))!;
  const b = fuTurn({ ...STAGE_STATES.course, fu: { stage: 'course', n: 1 } }, 'fu', M(25, 18, 30))!;
  ok(/^Boa tarde, Elton!/.test(a.parts[0]) && /^Boa noite, Elton!/.test(b.parts[0]), '"Bom dia" do guia passa a "Boa tarde"/"Boa noite" conforme a hora', `${a.parts[0].slice(0, 20)} | ${b.parts[0].slice(0, 20)}`);
}
// 2.1.1: numero de disciplinas do exame
{
  const t = fuTurn({ ...STAGE_STATES.package, examSubjects: ['Biologia', 'Química'] }, 'fu', M(25, 12))!;
  ok(/Para \d disciplinas?|Para as tuas disciplinas/.test(t.parts[0]), `2.1.1: "Para N disciplinas"`, t.parts[0].slice(0, 90));
}
// Sem follow-up por etapa: pacotes com a regua a correr, quem disse quando paga, handoff.
ok(fuStageOf({ ...B, step: 'pdf_sent', lastKey: 'packagesPdf', lastQuestion: 'packagesPdf', regua: { startAt: new Date().toISOString(), sent: 0 } }) === null, 'pacotes com a regua a correr: a regua (Fluxo 6) e nao os follow-ups por etapa');
ok(fuStageOf({ ...STAGE_STATES.pay, payFollow: { at: new Date().toISOString(), sent: true, skip: true } }) === null, 'disse quando paga: sem follow-up de pagamento');
ok(fuStageOf({ ...B, step: 'handoff' }) === null, 'passou a equipa: sem follow-ups');
ok(fuStageOf({ ...INITIAL_STATE, step: 'diagnosis', lastKey: 'greeting', lastQuestion: 'greeting' }) === null, 'saudacao (antes do curso): sem follow-up');

console.log(`\n==== ${total} verificacoes · ${fails} falhas`);
process.exit(fails ? 1 : 0);
