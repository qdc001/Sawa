// Leitura da planilha M.E.T.A._FINANCAS (.xlsm). So le: valores guardados no
// ficheiro, nunca macros. Devolve dados limpos e os valores que o proprio Excel
// mostra, para o relatorio de comparacao.
import JSZip from 'jszip';
import { WALLETS, Wallet, normalizeWallet, computeMonths, computeFlow, FinanceConfig, MonthSummary } from './financeCalc';

export type ParsedAssociate = { code: string; name: string; whatsapp: string | null };
export type ParsedStudent = {
  code: string; name: string; gender: string | null; whatsapp: string | null; associateCode: string | null;
  faculty: string | null; course: string | null; theme: string | null; entryDate: Date | null; sellerCredit: boolean;
  currentPhase: number | null; lastActivityAt: Date | null; phases: Record<string, { status?: string; date?: string }>;
  notes: string | null; project: string | null; origin: string | null; totalValue: number;
  installments: number | null; paidAmount: number; installmentsPaid: number; nextDueDate: Date | null; status: string;
};
export type ParsedEntry = {
  period: string; date: Date | null; description: string | null; type: string; category: string | null;
  potentialRevenue: number; expense: number; revenue: number; commission: number;
  associateCode: string | null; commissionistRaw: string | null; paymentMethod: string | null; notes: string | null;
};
export type ParsedInvestment = {
  date: Date | null; description: string | null; investment: number; returnAmount: number; potentialReturn: number;
  paymentMethod: string | null; notes: string | null; fund: string | null;
};
export type ParsedCoupon = {
  code: string; discount: number; validUntil: Date | null; maxUses: number; usedCount: number;
  clientName: string | null; usedAt: Date | null;
};
export type ParsedPayroll = {
  period: string; proLabore: number; reinvestment: number; reserve: number; status: string;
  paidMpesa: number; paidEmola: number; paidBim: number;
};
export type ExcelMonth = {
  dre: number; revenue: number; expense: number; balance: number; salary: number; proLabore: number; profit: number;
  wallets: Record<Wallet, number>;
};
export type ExcelFlow = {
  years: Record<string, { revenue: number; expense: number; balance: number; salary: number; proLabore: number; profit: number; wallets: Record<Wallet, number> }>;
  total: number; distributable: number;
  funds: Record<string, number>;
};
export type ParsedWorkbook = {
  associates: ParsedAssociate[]; students: ParsedStudent[]; entries: ParsedEntry[];
  investments: ParsedInvestment[]; coupons: ParsedCoupon[]; payrolls: ParsedPayroll[];
  excel: { months: Record<string, ExcelMonth>; flow: ExcelFlow };
  warnings: string[];
};

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12, desembro: 12,
};
// Mesmas pessoas com nomes diferentes ao longo do tempo.
const ALIASES: Record<string, string> = { dario: 'eugenio', yuran: 'bacar', bruno: 'dilauro', kaleb: 'caleb' };

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const key = (s: string) => strip(s).toLowerCase().replace(/\s+/g, ' ').trim();

// Leitor minimo de .xlsx/.xlsm: so precisamos dos valores guardados em cada celula.
type CellValue = string | number | boolean | null;
const raw = (v: CellValue) => v;
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const columnNumber = (letters: string) => letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);

class Sheet {
  rowCount = 0;
  private cells = new Map<string, CellValue>();
  constructor(public name: string, xml: string, shared: string[]) {
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      if (m[2] === undefined) continue;
      const ref = m[1].match(/\br="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const type = m[1].match(/\bt="(\w+)"/)?.[1] || 'n';
      const body = m[2];
      let value: CellValue = null;
      if (type === 'inlineStr') {
        value = decode([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) {
          if (type === 's') value = shared[+v] ?? null;
          else if (type === 'str') value = decode(v);
          else if (type === 'b') value = v === '1';
          else if (type !== 'e') value = Number(v);
        }
      }
      const row = +ref[2];
      if (value !== null) this.cells.set(`${columnNumber(ref[1])}:${row}`, value);
      if (row > this.rowCount) this.rowCount = row;
    }
  }
  getCell(a: number | string, col?: number): CellValue {
    if (typeof a === 'number') return this.cells.get(`${col}:${a}`) ?? null;
    const m = a.match(/^([A-Z]+)(\d+)$/)!;
    return this.cells.get(`${columnNumber(m[1])}:${m[2]}`) ?? null;
  }
}

async function loadWorkbook(buffer: Buffer) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw new Error('O ficheiro não é um Excel válido.'); }
  const read = (p: string) => zip.file(p)?.async('string');
  const wbXml = await read('xl/workbook.xml');
  const relsXml = await read('xl/_rels/workbook.xml.rels');
  if (!wbXml || !relsXml) throw new Error('O ficheiro não é um Excel válido.');
  const sharedXml = (await read('xl/sharedStrings.xml')) || '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const rels = new Map<string, string>();
  for (const r of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = r[1].match(/\bId="([^"]+)"/)?.[1];
    const target = r[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target);
  }
  const worksheets: Sheet[] = [];
  for (const s of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = decode(s[1].match(/\bname="([^"]+)"/)?.[1] || '');
    const target = rels.get(s[1].match(/\br:id="([^"]+)"/)?.[1] || '');
    if (!target) continue;
    const xml = await read(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (xml) worksheets.push(new Sheet(name, xml, shared));
  }
  return { worksheets, getWorksheet: (n: string) => worksheets.find((w) => w.name === n) };
}
const num = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && s !== '0' ? s : null;
};
function date(v: any): Date | null {
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number' && v > 20000 && v < 80000) d = new Date(Math.round((v - 25569) * 86400000));
  else if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }
  if (!d || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2024 || y > 2030) return null; // 1899 = celula vazia; 3036 = erro de escrita
  return new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
}

const CATEGORY_WORDS = ['monografia', 'defesa', 'tcc', 'dissertacao', 'mestrado', 'revisao', 'projecto', 'essencial', 'intermediario', 'completo', 'avancado', 'equilibrado', 'rapido', 'flexivel', 'preparacao', 'simulacao', 'office'];
function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}
export function cleanCategory(v: any): string | null {
  const s = str(v);
  if (!s) return null;
  const parts = key(s).split('-').map((p) => p.trim()).filter(Boolean).map((p) => {
    if (p === 'intermedia' || p === 'intermediaria') p = 'intermediario';
    if (p === 'completa') p = 'completo';
    const best = CATEGORY_WORDS.map((w) => ({ w, d: distance(p, w) })).sort((x, y) => x.d - y.d)[0];
    const fixed = best.d <= 2 ? best.w : p;
    return fixed === 'tcc' ? 'TCC' : fixed.charAt(0).toUpperCase() + fixed.slice(1);
  });
  return parts.join(' - ') || null;
}

function cleanProject(v: any): string | null {
  const s = str(v);
  if (!s) return null;
  const k = key(s);
  return k.charAt(0).toUpperCase() + k.slice(1);
}

// fixSpaces: em 2025 ha nomes com espacos a mais ("Absalao ", "m-pesa ") que o
// Excel nao soma. Por defeito o CRM faz o mesmo, para bater com o Excel.
// extraAssociates: associados criados no CRM que a planilha nao tem. Mantem-se
// e os lancamentos com o nome deles ficam ligados.
export async function parseFinanceWorkbook(
  buffer: Buffer,
  opts: { fixSpaces?: boolean; extraAssociates?: ParsedAssociate[] } = {},
): Promise<ParsedWorkbook> {
  const wb = await loadWorkbook(buffer);
  const warnings: string[] = [];
  const need = (n: string) => {
    const s = wb.getWorksheet(n);
    if (!s) throw new Error(`A planilha não tem a folha "${n}".`);
    return s;
  };

  // Associados
  const assocSheet = need('Associados');
  const associates: ParsedAssociate[] = [];
  for (let r = 5; r <= 15; r++) {
    const code = str(raw(assocSheet.getCell(r, 1)));
    const name = str(raw(assocSheet.getCell(r, 2)));
    if (code && /^A\d+$/.test(code) && name) associates.push({ code, name, whatsapp: str(raw(assocSheet.getCell(r, 8))) });
  }
  for (const extra of opts.extraAssociates || []) {
    if (!associates.some((a) => a.code === extra.code || key(a.name) === key(extra.name))) associates.push(extra);
  }
  associates.sort((a, b) => a.code.localeCompare(b.code));
  const byName = new Map(associates.map((a) => [key(a.name), a.code]));
  const resolve = (name: string): string | null => {
    const k = key(name);
    return byName.get(k) || byName.get(ALIASES[k] || '') || null;
  };

  // Datas de entrada usadas no Controle do parcelamento
  const control = need('Controle do parcelamnto');
  const controlEntry = new Map<string, Date | null>();
  for (let r = 7; r <= control.rowCount; r++) {
    const id = str(raw(control.getCell(r, 3)));
    if (id && /^E\d+$/.test(id)) controlEntry.set(id, date(raw(control.getCell(r, 12))));
  }

  // Estudantes (so linhas com ID; as linhas sem ID no fim sao duplicados)
  const est = need('Estudantes');
  const students: ParsedStudent[] = [];
  let noId = 0;
  for (let r = 8; r <= est.rowCount; r++) {
    const id = str(raw(est.getCell(r, 1)));
    const name = str(raw(est.getCell(r, 2)));
    if (!id) { if (name) noId++; continue; }
    const phases: ParsedStudent['phases'] = {};
    for (let f = 1; f <= 7; f++) {
      const status = str(raw(est.getCell(r, 12 + f)));
      const d = date(raw(est.getCell(r, 19 + f)));
      if (status || d) phases[String(f)] = { ...(status ? { status } : {}), ...(d ? { date: d.toISOString().slice(0, 10) } : {}) };
    }
    const phase = num(raw(est.getCell(r, 10)));
    students.push({
      code: id, name: name || id, gender: str(raw(est.getCell(r, 3))), whatsapp: str(raw(est.getCell(r, 4))),
      associateCode: str(raw(est.getCell(r, 5))), faculty: str(raw(est.getCell(r, 6))), course: str(raw(est.getCell(r, 7))),
      theme: str(raw(est.getCell(r, 8))),
      entryDate: controlEntry.get(id) || date(raw(est.getCell(r, 9))),
      // Na planilha, a data preenchida e o que marca a venda da Lucilia.
      sellerCredit: !!(controlEntry.get(id) || date(raw(est.getCell(r, 9)))),
      currentPhase: phase >= 1 && phase <= 7 ? phase : null,
      lastActivityAt: date(raw(est.getCell(r, 11))), phases, notes: str(raw(est.getCell(r, 27))),
      project: cleanProject(raw(est.getCell(r, 28))), origin: str(raw(est.getCell(r, 29))),
      totalValue: num(raw(est.getCell(r, 30))), installments: num(raw(est.getCell(r, 31))) || null,
      paidAmount: num(raw(est.getCell(r, 32))), installmentsPaid: num(raw(est.getCell(r, 33))),
      nextDueDate: date(raw(est.getCell(r, 35))), status: str(raw(est.getCell(r, 36))) || 'Em aberto',
    });
  }
  if (noId) warnings.push(`${noId} linhas sem ID no fim da folha Estudantes foram ignoradas (são duplicados).`);

  // Lancamentos mensais
  const entries: ParsedEntry[] = [];
  const unresolved = new Map<string, number>();
  let spacedCommission = 0, spacedMethod = 0;
  for (const ws of wb.worksheets) {
    const m = ws.name.match(/^([A-Za-z]+)-(20\d\d)$/);
    if (!m || !MONTHS[m[1].toLowerCase()]) continue;
    const mm = MONTHS[m[1].toLowerCase()];
    const period = `${m[2]}-${String(mm).padStart(2, '0')}`;
    let end = 0;
    for (let r = 11; r <= ws.rowCount; r++) {
      if (key(String(raw(ws.getCell(r, 4)) ?? '')) === 'total') { end = r; break; }
    }
    if (!end) { warnings.push(`Folha ${ws.name}: linha Total não encontrada.`); continue; }
    for (let r = 11; r < end; r++) {
      const [desc, tipo, cat, pot, des, rec, com, comissao, fp, obs] = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((c) => raw(ws.getCell(r, c)));
      if ([desc, tipo, cat, pot, des, rec, com, fp].every((v) => v === null || v === '')) continue;
      let d = date(raw(ws.getCell(r, 4)));
      // Dia e mes trocados ao escrever: a folha diz qual e o mes certo.
      if (d && d.getUTCMonth() + 1 !== mm && d.getUTCDate() === mm) d = new Date(Date.UTC(+m[2], mm - 1, d.getUTCMonth() + 1));
      const comName = str(com);
      const hasSpaces = (v: any) => typeof v === 'string' && v !== v.trim();
      const assoc = comName && (opts.fixSpaces || !hasSpaces(com)) ? resolve(comName) : null;
      if (comName && !assoc) {
        if (resolve(comName)) {
          spacedCommission += num(comissao);
        } else unresolved.set(comName, (unresolved.get(comName) || 0) + 1);
      }
      const method = !opts.fixSpaces && hasSpaces(fp) && normalizeWallet(str(fp))
        ? (spacedMethod += num(rec) - num(des), `${str(fp)} (sem carteira)`)
        : normalizeWallet(str(fp)) || str(fp);
      const expense = num(des), revenue = num(rec);
      entries.push({
        period, date: d, description: str(desc), type: expense && !revenue ? 'DESPESA' : revenue ? 'RECEITA' : (key(String(tipo ?? '')).startsWith('desp') ? 'DESPESA' : 'RECEITA'),
        category: cleanCategory(cat), potentialRevenue: num(pot), expense, revenue, commission: num(comissao),
        associateCode: assoc, commissionistRaw: comName && !assoc ? comName : null,
        paymentMethod: method, notes: str(obs),
      });
    }
  }
  if (spacedCommission || spacedMethod) warnings.push(`Nomes com espaços a mais que o Excel não soma: ${spacedCommission.toFixed(2)} MZN de comissões e ${spacedMethod.toFixed(2)} MZN de carteiras.`);
  if (unresolved.size) warnings.push(`Comissionistas sem associado (a comissão não entra nos salários, como no Excel): ${[...unresolved].map(([k, v]) => `${k} (${v})`).join(', ')}.`);

  // Investimentos
  const invSheet = need('Investimento - 2026');
  const investments: ParsedInvestment[] = [];
  for (let r = 11; r <= invSheet.rowCount; r++) {
    if (key(String(raw(invSheet.getCell(r, 4)) ?? '')) === 'forma de pagamento') break;
    const [dt, desc, inv, ret, pot, fp, obs, , fund] = [4, 5, 6, 7, 8, 9, 10, 0, 11].map((c) => (c ? raw(invSheet.getCell(r, c)) : null));
    if ([desc, inv, ret, pot].every((v) => v === null || v === '')) continue;
    investments.push({
      date: date(dt), description: str(desc), investment: num(inv), returnAmount: num(ret), potentialReturn: num(pot),
      paymentMethod: normalizeWallet(str(fp)) || str(fp), notes: str(obs), fund: str(fund),
    });
  }

  // Cupoes
  const cup = need('Cupons de Desconto');
  const coupons: ParsedCoupon[] = [];
  for (let r = 8; r <= cup.rowCount; r++) {
    const code = str(raw(cup.getCell(r, 2)));
    if (!code) continue;
    coupons.push({
      code, discount: num(raw(cup.getCell(r, 3))), validUntil: date(raw(cup.getCell(r, 4))),
      maxUses: num(raw(cup.getCell(r, 5))) || 1, usedCount: num(raw(cup.getCell(r, 6))),
      clientName: str(raw(cup.getCell(r, 7))), usedAt: date(raw(cup.getCell(r, 8))),
    });
  }

  // Resumos: salarios pagos e valores que o Excel mostra
  const payrolls: ParsedPayroll[] = [];
  const months: Record<string, ExcelMonth> = {};
  for (const [sheet, year] of [['Resumo Financeiro.M.E.T.A', '2025'], ['Resumo Financeiro.M.E.T.A-2026', '2026']] as const) {
    const s = need(sheet);
    for (let i = 0; i < 8; i++) {
      const name = key(String(raw(s.getCell(7 + i, 7)) ?? ''));
      const mm = MONTHS[name];
      if (!mm) continue;
      const period = `${year}-${String(mm).padStart(2, '0')}`;
      const c = (col: string, row: number) => num(raw(s.getCell(`${col}${row}`)));
      payrolls.push({
        period, proLabore: c('M', 7 + i), reinvestment: c('N', 7 + i), reserve: c('O', 7 + i),
        status: str(raw(s.getCell(`J${17 + i}`))) === 'Pago' ? 'Pago' : 'Por pagar',
        paidMpesa: c('M', 30 + i), paidEmola: c('N', 30 + i), paidBim: c('O', 30 + i),
      });
      months[period] = {
        dre: c('H', 7 + i), revenue: c('I', 7 + i), expense: c('J', 7 + i), balance: c('K', 7 + i), salary: c('L', 7 + i),
        proLabore: c('M', 7 + i), profit: c('P', 7 + i),
        wallets: { 'M-pesa': c('M', 18 + i), 'E-mola': c('N', 18 + i), BIM: c('O', 18 + i), Fisico: c('P', 18 + i) },
      };
    }
  }

  const fl = need('Fluxo de caixa');
  const f = (a: string) => num(raw(fl.getCell(a)));
  const yr = (r: number, w: number) => ({
    revenue: f(`I${r}`), expense: f(`J${r}`), balance: f(`K${r}`), salary: f(`L${r}`), proLabore: f(`M${r}`), profit: f(`P${r}`),
    wallets: { 'M-pesa': f(`G${w}`), 'E-mola': f(`H${w}`), BIM: f(`I${w}`), Fisico: f(`J${w}`) } as Record<Wallet, number>,
  });
  const flow: ExcelFlow = {
    years: { 2025: yr(7, 16), 2026: yr(9, 17) }, total: f('K18'), distributable: f('L24'),
    funds: { Previdencia: f('M17'), Oportunidade: f('N17'), Dono: f('O17'), Expansao: f('P17') },
  };

  return { associates, students, entries, investments, coupons, payrolls, excel: { months, flow }, warnings };
}

export type Difference = { area: string; item: string; excel: number; crm: number; diff: number };

// Compara o que o CRM calcula com o que o Excel mostra (tolerancia de 0,01).
export function reconcile(p: ParsedWorkbook, cfg: FinanceConfig): { differences: Difference[]; months: MonthSummary[]; checked: number } {
  const months = computeMonths(
    p.entries.map((e) => ({ ...e, associateId: e.associateCode })),
    p.payrolls,
    p.students.map((s) => (s.sellerCredit ? s.entryDate : null)),
    cfg,
  );
  const flow = computeFlow(months, p.investments, cfg);
  const differences: Difference[] = [];
  let checked = 0;
  const cmp = (area: string, item: string, excel: number, crm: number) => {
    checked++;
    if (Math.abs(excel - crm) > 0.01) differences.push({ area, item, excel, crm, diff: crm - excel });
  };
  for (const m of months) {
    const e = p.excel.months[m.period];
    if (!e) continue;
    cmp(m.period, 'Receita potencial (DRE)', e.dre, m.dre);
    cmp(m.period, 'Receita', e.revenue, m.revenue);
    cmp(m.period, 'Despesa', e.expense, m.expense);
    cmp(m.period, 'Saldo', e.balance, m.balance);
    cmp(m.period, 'Salários', e.salary, m.salary);
    cmp(m.period, 'Pró-labore', e.proLabore, m.proLabore);
    cmp(m.period, 'Lucro', e.profit, m.profit);
    for (const w of WALLETS) cmp(m.period, `Carteira ${w}`, e.wallets[w], m.wallets[w].net);
  }
  for (const y of flow.years) {
    const e = p.excel.flow.years[y.year];
    if (!e) continue;
    cmp(`Ano ${y.year}`, 'Receita', e.revenue, y.totals.revenue);
    cmp(`Ano ${y.year}`, 'Despesa', e.expense, y.totals.expense);
    cmp(`Ano ${y.year}`, 'Saldo', e.balance, y.totals.balance);
    cmp(`Ano ${y.year}`, 'Salários', e.salary, y.totals.salary);
    cmp(`Ano ${y.year}`, 'Pró-labore', e.proLabore, y.totals.proLabore);
    cmp(`Ano ${y.year}`, 'Lucro', e.profit, y.totals.profit);
    for (const w of WALLETS) cmp(`Ano ${y.year}`, `Carteira ${w}`, e.wallets[w], y.wallets[w]);
  }
  cmp('Geral', 'Dinheiro existente', p.excel.flow.total, flow.total);
  cmp('Geral', 'Valor a distribuir', p.excel.flow.distributable, flow.distributable);
  for (const k of ['Previdencia', 'Oportunidade', 'Dono', 'Expansao'] as const) cmp('SEAL', k, p.excel.flow.funds[k], flow.funds[k].available);
  return { differences, months, checked };
}
