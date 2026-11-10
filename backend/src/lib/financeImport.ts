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
// Pagamento de salario encontrado nos investimentos (investmentIndex aponta para la).
export type ParsedSalaryPayment = {
  investmentIndex: number; period: string; payee: string; associateCode: string | null;
  amount: number; wallet: Wallet; date: Date | null; notes: string | null;
};
export type ExcelField = 'dre' | 'revenue' | 'expense' | 'balance' | 'salary' | 'proLabore' | 'profit';
// Linha do "Desempenho do lote": inTotal diz se a coluna entra na soma do Excel.
export type ExcelLote = {
  total: number; totalBad: boolean;
  persons: { name: string; value: number; bad: boolean; inTotal: boolean }[];
};
export type ExcelMonth = {
  dre: number; revenue: number; expense: number; balance: number; salary: number; proLabore: number; profit: number;
  wallets: Record<Wallet, number>;
  bad: ExcelField[]; typed: ExcelField[]; lote: ExcelLote | null;
};
export type ExcelFlow = {
  years: Record<string, { revenue: number; expense: number; balance: number; salary: number; proLabore: number; profit: number; wallets: Record<Wallet, number>; bad: ExcelField[] }>;
  total: number; distributable: number;
  funds: Record<string, number>;
};
export type ParsedWorkbook = {
  associates: ParsedAssociate[]; students: ParsedStudent[]; entries: ParsedEntry[];
  investments: ParsedInvestment[]; coupons: ParsedCoupon[]; payrolls: ParsedPayroll[];
  salaryPayments: ParsedSalaryPayment[]; creditName: string;
  excel: { months: Record<string, ExcelMonth>; flow: ExcelFlow; skipped: Record<string, ExcelMonth>; manualCalc: boolean };
  warnings: string[];
};

// Desde Junho de 2026 os salarios passaram a ser lancados nos investimentos.
const SALARY_PAYMENTS_FROM = new Date('2026-06-01T00:00:00.000Z');
const PAYMENT_WORDS = new Set(['pagamento', 'pagamentos', 'pag', 'salario', 'salarios', 'de', 'do', 'da', 'ao', 'a']);
const columnLetter = (n: number) => {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12, desembro: 12,
};
// Mesmas pessoas com nomes diferentes ao longo do tempo.
const ALIASES: Record<string, string> = { dario: 'eugenio', yuran: 'bacar', bruno: 'dilauro', kaleb: 'caleb', marven: 'marvin' };

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
  private errors = new Set<string>();
  private formulas = new Map<string, string>();
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
      const at = `${columnNumber(ref[1])}:${row}`;
      if (value !== null) this.cells.set(at, value);
      if (type === 'e') this.errors.add(at);
      const f = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
      if (f || /<f(?:\s[^>]*)?\/>/.test(body)) this.formulas.set(at, f ? decode(f[1]) : '');
      if (row > this.rowCount) this.rowCount = row;
    }
  }
  private at(a: string) {
    const m = a.match(/^([A-Z]+)(\d+)$/)!;
    return `${columnNumber(m[1])}:${m[2]}`;
  }
  getCell(a: number | string, col?: number): CellValue {
    if (typeof a === 'number') return this.cells.get(`${col}:${a}`) ?? null;
    return this.cells.get(this.at(a)) ?? null;
  }
  // Erro (#REF!, #VALUE!...) ou texto onde devia haver um numero.
  isBad(a: string): boolean {
    const v = this.cells.get(this.at(a));
    return this.errors.has(this.at(a)) || (typeof v === 'string' && v.trim() !== '');
  }
  formula(a: string): string | null {
    return this.formulas.get(this.at(a)) ?? null;
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
  return {
    worksheets, getWorksheet: (n: string) => worksheets.find((w) => w.name === n),
    // Em calculo manual os valores guardados podem estar desactualizados.
    manualCalc: /<calcPr\b[^>]*calcMode="manual"/.test(wbXml),
  };
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
  opts: { fixSpaces?: boolean; extraAssociates?: ParsedAssociate[]; creditName?: string } = {},
): Promise<ParsedWorkbook> {
  const creditName = opts.creditName || 'Lucília';
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

  // Pagamentos de salario lancados como investimento (desde Junho de 2026 as
  // pessoas eram pagas por carteiras diferentes e o Excel so tinha esse sitio).
  // Reconhece-os pelo nome da pessoa na descricao e passa-os para o mes do salario.
  const payeeBy = new Map<string, { payee: string; associateCode: string | null }>();
  for (const a of associates) payeeBy.set(key(a.name).split(' ')[0], { payee: a.name, associateCode: a.code });
  for (const [alias, target] of Object.entries(ALIASES)) {
    const t = payeeBy.get(target);
    if (t && !payeeBy.has(alias)) payeeBy.set(alias, t);
  }
  const creditFirst = key(creditName).split(' ')[0];
  if (creditFirst && !payeeBy.has(creditFirst)) payeeBy.set(creditFirst, { payee: creditName, associateCode: null });
  const salaryPayments: ParsedSalaryPayment[] = [];
  investments.forEach((inv, i) => {
    if (!inv.date || inv.date < SALARY_PAYMENTS_FROM || inv.investment <= 0 || inv.returnAmount || inv.fund) return;
    const wallet = normalizeWallet(inv.paymentMethod);
    if (!wallet) return;
    const words = key(inv.description || '').replace(/[^a-z ]/g, ' ').split(' ').filter((t) => t && !PAYMENT_WORDS.has(t));
    const who = words.slice(0, 2).map((t) => payeeBy.get(t)).find(Boolean);
    if (!who) return;
    // Pago ate dia 10: e o salario do mes anterior.
    const d = inv.date;
    const salaryMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (d.getUTCDate() <= 10 ? 1 : 0), 1));
    salaryPayments.push({
      investmentIndex: i, period: salaryMonth.toISOString().slice(0, 7), payee: who.payee, associateCode: who.associateCode,
      amount: inv.investment, wallet, date: d, notes: inv.description,
    });
  });

  // Desempenho do lote: comissao de cada pessoa por mes e o total que o Excel usa.
  const lotes: Record<string, ExcelLote> = {};
  for (const [sheet, year] of [['Desempenho do lote-2025', '2025'], ['Desempenho do lote-2026', '2026']] as const) {
    const s = wb.getWorksheet(sheet);
    if (!s) continue;
    let header = 0, monthCol = 0, totalCol = 0;
    for (let r = 1; r <= Math.min(s.rowCount, 40) && !header; r++) {
      let mc = 0, tc = 0;
      for (let col = 1; col <= 26; col++) {
        const t = key(String(raw(s.getCell(r, col)) ?? ''));
        if (t === 'mes') mc = col;
        if (t === 'total') tc = col;
      }
      if (mc && tc > mc) { header = r; monthCol = mc; totalCol = tc; }
    }
    if (!header) continue;
    const names: string[] = [];
    for (let col = monthCol + 1; col < totalCol; col++) names.push(String(raw(s.getCell(header, col)) ?? '').trim());
    for (let r = header + 1; r <= s.rowCount; r++) {
      const mm = MONTHS[key(String(raw(s.getCell(r, monthCol)) ?? ''))];
      if (!mm) break;
      const ref = (col: number) => `${columnLetter(col)}${r}`;
      const range = (s.formula(ref(totalCol)) || '').match(/([A-Z]+)\d+:([A-Z]+)\d+/);
      const from = range ? columnNumber(range[1]) : monthCol + 1;
      const to = range ? columnNumber(range[2]) : totalCol - 1;
      lotes[`${year}-${String(mm).padStart(2, '0')}`] = {
        total: num(raw(s.getCell(r, totalCol))), totalBad: s.isBad(ref(totalCol)),
        persons: names.map((name, i) => {
          const col = monthCol + 1 + i;
          return { name, value: num(raw(s.getCell(r, col))), bad: s.isBad(ref(col)), inTotal: col >= from && col <= to };
        }),
      };
    }
  }

  // Resumos: salarios pagos e valores que o Excel mostra
  const payrolls: ParsedPayroll[] = [];
  const months: Record<string, ExcelMonth> = {};
  const skipped: Record<string, ExcelMonth> = {};
  // As tabelas do resumo sao encontradas pelos titulos e nomes dos meses, nao
  // por linhas fixas: a folha de 2026 passou de 8 para 12 meses e tudo desceu.
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const FIELDS: [ExcelField, string][] = [['dre', 'H'], ['revenue', 'I'], ['expense', 'J'], ['balance', 'K'], ['salary', 'L'], ['proLabore', 'M'], ['profit', 'P']];
  for (const [sheet, year] of [['Resumo Financeiro.M.E.T.A', '2025'], ['Resumo Financeiro.M.E.T.A-2026', '2026']] as const) {
    const s = need(sheet);
    const text = (col: string, r: number) => key(String(raw(s.getCell(`${col}${r}`)) ?? ''));
    const findRow = (col: string, test: (t: string) => boolean, from: number) => {
      for (let r = from; r <= s.rowCount; r++) if (test(text(col, r))) return r;
      return 0;
    };
    const monthRows = (col: string, start: number) => {
      const rows = new Map<number, number>();
      for (let r = start; start && r <= s.rowCount && MONTHS[text(col, r)]; r++) rows.set(MONTHS[text(col, r)], r);
      return rows;
    };
    const isMonth = (t: string) => !!MONTHS[t];
    const summaryRows = monthRows('G', findRow('G', isMonth, 1));
    const payHeader = findRow('G', (t) => t.startsWith('pagamentos mensais'), 1);
    const statusRows = monthRows('G', payHeader ? payHeader + 1 : 0);
    const walletRows = monthRows('L', payHeader ? findRow('L', isMonth, payHeader + 1) : 0);
    const paidHeader = findRow('I', (t) => t === 'coluna1', 1);
    const paidRows = monthRows('I', paidHeader ? paidHeader + 1 : 0);
    if (!summaryRows.size || !statusRows.size || !walletRows.size || !paidRows.size) {
      throw new Error(`A folha "${sheet}" mudou de formato e não a consigo ler com segurança.`);
    }
    const c = (col: string, row: number | undefined) => (row ? num(raw(s.getCell(`${col}${row}`))) : 0);
    for (const [mm, r] of summaryRows) {
      const period = `${year}-${String(mm).padStart(2, '0')}`;
      const w = walletRows.get(mm);
      const em: ExcelMonth = {
        dre: c('H', r), revenue: c('I', r), expense: c('J', r), balance: c('K', r), salary: c('L', r),
        proLabore: c('M', r), profit: c('P', r),
        wallets: { 'M-pesa': c('M', w), 'E-mola': c('N', w), BIM: c('O', w), Fisico: c('P', w) },
        bad: FIELDS.filter(([, col]) => s.isBad(`${col}${r}`)).map(([k]) => k),
        // Receita/despesa devem vir da folha do mes; sem formula foi escrito a mao.
        typed: FIELDS.filter(([k, col]) => (k === 'revenue' || k === 'expense') && s.getCell(`${col}${r}`) !== null && s.formula(`${col}${r}`) === null).map(([k]) => k),
        lote: lotes[period] || null,
      };
      // Meses futuros ainda vazios ficam de fora: o mes aparece com o primeiro lancamento.
      if (period > currentPeriod && !em.revenue && !em.expense) { skipped[period] = em; continue; }
      const st = statusRows.get(mm), pd = paidRows.get(mm);
      payrolls.push({
        period, proLabore: c('M', r), reinvestment: c('N', r), reserve: c('O', r),
        status: st && str(raw(s.getCell(`J${st}`))) === 'Pago' ? 'Pago' : 'Por pagar',
        paidMpesa: c('M', pd), paidEmola: c('N', pd), paidBim: c('O', pd),
      });
      months[period] = em;
    }
  }

  const fl = need('Fluxo de caixa');
  const f = (a: string) => num(raw(fl.getCell(a)));
  const yr = (r: number, w: number) => ({
    revenue: f(`I${r}`), expense: f(`J${r}`), balance: f(`K${r}`), salary: f(`L${r}`), proLabore: f(`M${r}`), profit: f(`P${r}`),
    wallets: { 'M-pesa': f(`G${w}`), 'E-mola': f(`H${w}`), BIM: f(`I${w}`), Fisico: f(`J${w}`) } as Record<Wallet, number>,
    bad: FIELDS.filter(([, col]) => fl.isBad(`${col}${r}`)).map(([k]) => k),
  });
  const flow: ExcelFlow = {
    years: { 2025: yr(7, 16), 2026: yr(9, 17) }, total: f('K18'), distributable: f('L24'),
    funds: { Previdencia: f('M17'), Oportunidade: f('N17'), Dono: f('O17'), Expansao: f('P17') },
  };

  return {
    associates, students, entries, investments, coupons, payrolls, salaryPayments, creditName,
    excel: { months, flow, skipped, manualCalc: wb.manualCalc }, warnings,
  };
}

// Marca como "sugerido" o pagamento que bate com o que a pessoa tinha a receber
// nesse mes (comissao, ou comissao + um salario fixo). Os restantes ficam para
// a pessoa decidir: nem tudo o que tem um nome na descricao e salario.
export type SalaryPaymentCandidate = ParsedSalaryPayment & { expected: number[]; suggested: boolean };
export function suggestSalaryPayments(p: ParsedWorkbook, months: MonthSummary[], cfg: FinanceConfig): SalaryPaymentCandidate[] {
  const byPeriod = new Map(months.map((m) => [m.period, m]));
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.002);
  const expectedFor = (sp: ParsedSalaryPayment) => {
    const m = byPeriod.get(sp.period);
    if (!m) return [];
    const base = sp.associateCode ? m.commissions[sp.associateCode] || 0 : m.newStudentFee;
    const fixed = cfg.fixedSalaries
      .filter((s) => sp.period >= s.startPeriod && (!s.endPeriod || sp.period <= s.endPeriod))
      .map((s) => s.amount);
    return [...new Set([base, ...fixed.map((f) => base + f)])].filter((v) => v > 0);
  };
  const out: SalaryPaymentCandidate[] = p.salaryPayments.map((sp) => ({ ...sp, expected: expectedFor(sp), suggested: false }));
  const groups = new Map<string, SalaryPaymentCandidate[]>();
  for (const c of out) {
    const k = `${c.period}|${c.payee}`;
    groups.set(k, [...(groups.get(k) || []), c]);
  }
  for (const g of groups.values()) {
    const total = g.reduce((a, c) => a + c.amount, 0);
    // Pago em varias transferencias que somam o valor certo.
    if (g.length > 1 && g[0].expected.some((e) => close(total, e))) { g.forEach((c) => { c.suggested = true; }); continue; }
    for (const c of g) c.suggested = c.expected.some((e) => close(c.amount, e));
  }
  return out;
}

export type Difference = {
  area: string; item: string; excel: number; crm: number; diff: number;
  // explained: a diferenca tem um motivo conhecido (quase sempre um erro do Excel).
  explained: boolean; reason: string | null;
};

const ITEM_LABEL: Record<ExcelField, string> = {
  dre: 'Receita potencial (DRE)', revenue: 'Receita', expense: 'Despesa', balance: 'Saldo',
  salary: 'Salários', proLabore: 'Pró-labore', profit: 'Lucro',
};
const fmt = (n: number) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(n);
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const BAD_CELL = 'A célula do Excel tem um erro (#REF!/#VALUE!) ou texto em vez de número; o CRM calcula o valor.';

// Compara o que o CRM calcula com o que o Excel mostra (tolerancia de 0,01) e
// tenta explicar cada diferenca. O calculo do CRM nao muda com a explicacao.
export function reconcile(p: ParsedWorkbook, cfg: FinanceConfig): { differences: Difference[]; months: MonthSummary[]; checked: number } {
  // Aqui os pagamentos de salario ficam nos investimentos, como no Excel.
  const months = computeMonths(
    p.entries.map((e) => ({ ...e, associateId: e.associateCode })),
    p.payrolls,
    p.students.map((s) => (s.sellerCredit ? s.entryDate : null)),
    cfg,
  );
  const flow = computeFlow(months, p.investments, cfg);
  const differences: Difference[] = [];
  let checked = 0;
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  // Estado de cada comparacao feita: diferenca e se ficou explicada.
  const seen = new Map<string, { diff: number; explained: boolean }>();
  const cmp = (area: string, item: string, excel: number, crm: number, explain?: () => string | null) => {
    checked++;
    const diff = crm - excel;
    if (near(diff, 0)) { seen.set(`${area}|${item}`, { diff: 0, explained: true }); return; }
    const reason = explain ? explain() : null;
    seen.set(`${area}|${item}`, { diff, explained: !!reason });
    differences.push({ area, item, excel, crm, diff, explained: !!reason, reason });
  };
  const ok = (area: string, item: string) => seen.get(`${area}|${item}`)?.explained ?? true;
  const dif = (area: string, item: string) => seen.get(`${area}|${item}`)?.diff ?? 0;

  const per = cfg.perNewStudent;
  const creditKey = key(p.creditName).split(' ')[0];
  const isCredit = (name: string) => key(name).split(' ')[0] === creditKey;
  // A formula da planilha usa DATE(ano, mes, 31): em meses de 30 dias isso e o
  // dia 1 do mes seguinte, e esses alunos contam nos dois meses.
  const dayOneOverlap = (period: string) => {
    const [y, mm] = period.split('-').map(Number);
    if (![4, 6, 9, 11].includes(mm)) return 0;
    const next = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10);
    return p.students.filter((s) => s.sellerCredit && s.entryDate && s.entryDate.toISOString().slice(0, 10) === next).length;
  };

  const explainSalary = (m: MonthSummary, e: ExcelMonth): string | null => {
    if (e.bad.includes('salary')) {
      const broken = (e.lote?.persons || []).filter((x) => x.bad).map((x) => x.name);
      return broken.length
        ? `O Excel mostra erro porque a comissão de ${broken.join(' e ')} tem a fórmula partida (#REF!). O CRM calcula o valor.`
        : BAD_CELL;
    }
    const lote = e.lote;
    if (!lote) return null;
    const parts: string[] = [];
    let rest = m.salary - e.salary;
    if (!lote.totalBad) {
      const excelFixed = e.salary - lote.total;
      const d = m.fixedSalaries - excelFixed;
      if (!near(d, 0)) {
        parts.push(`salários fixos: ${fmt(m.fixedSalaries)} no CRM e ${fmt(excelFixed)} no Excel (os salários fixos configurados no CRM)`);
        rest -= d;
      }
    }
    const left = lote.persons.filter((x) => !x.inTotal && !isCredit(x.name) && !near(x.value, 0));
    if (left.length) {
      const v = left.reduce((a, x) => a + x.value, 0);
      parts.push(`o total do Excel não soma a comissão de ${left.map((x) => x.name).join(' e ')} (${fmt(v)}), que foi recebida`);
      rest -= v;
    }
    // Associados sem coluna no "Desempenho do lote" (ex.: criados depois no CRM):
    // o Excel nao soma a comissao deles, o CRM sim.
    const firstKey = (s: string) => key(s).split(' ')[0];
    const loteKeys = new Set(lote.persons.map((x) => firstKey(x.name)).flatMap((k) => [k, ALIASES[k]].filter(Boolean)));
    const noColumn = p.associates.filter((as) => !loteKeys.has(firstKey(as.name)) && !near(m.commissions[as.code] || 0, 0));
    if (noColumn.length) {
      const v = noColumn.reduce((s, as) => s + (m.commissions[as.code] || 0), 0);
      parts.push(`comissão de ${noColumn.map((as) => as.name).join(' e ')} (${fmt(v)}), que não tem coluna no "Desempenho do lote" do Excel`);
      rest -= v;
    }
    const fee = lote.persons.find((x) => isCredit(x.name) && x.inTotal);
    if (fee) {
      const d = m.newStudentFee - fee.value;
      if (!near(d, 0)) {
        let unexplained = d;
        const overlap = dayOneOverlap(m.period);
        if (overlap && unexplained < 0) {
          const n = Math.min(overlap, Math.round(-unexplained / per));
          parts.push(`a fórmula de ${p.creditName} usa o "dia 31" e conta ${n} aluno(s) do dia 1 do mês seguinte, que já contam nesse mês`);
          unexplained += n * per;
        }
        if (p.excel.manualCalc && unexplained > 0 && near(unexplained / per, Math.round(unexplained / per))) {
          parts.push(`o Excel está em cálculo manual e não contou ${Math.round(unexplained / per)} aluno(s) de ${p.creditName} registados depois do último cálculo`);
          unexplained = 0;
        }
        rest -= d - unexplained;
      }
    }
    if (!parts.length || !near(rest, 0)) return null;
    const text = parts.join('; ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  };

  for (const m of months) {
    const e = p.excel.months[m.period];
    if (!e) continue;
    const a = m.period;
    const bad = (k: ExcelField) => (e.bad.includes(k) ? BAD_CELL : null);
    const typed = (k: ExcelField) => (e.typed.includes(k)
      ? 'No resumo do Excel este valor foi escrito à mão em vez de vir da folha do mês; o CRM soma os lançamentos do mês.'
      : null);
    cmp(a, ITEM_LABEL.dre, e.dre, m.dre, () => bad('dre'));
    cmp(a, ITEM_LABEL.revenue, e.revenue, m.revenue, () => bad('revenue') || typed('revenue'));
    cmp(a, ITEM_LABEL.expense, e.expense, m.expense, () => bad('expense') || typed('expense'));
    cmp(a, ITEM_LABEL.balance, e.balance, m.balance, () => bad('balance')
      || (ok(a, ITEM_LABEL.revenue) && ok(a, ITEM_LABEL.expense) && near(m.balance - e.balance, dif(a, ITEM_LABEL.revenue) - dif(a, ITEM_LABEL.expense))
        ? 'Consequência da diferença na receita/despesa deste mês.' : null));
    cmp(a, ITEM_LABEL.salary, e.salary, m.salary, () => explainSalary(m, e));
    cmp(a, ITEM_LABEL.proLabore, e.proLabore, m.proLabore, () => bad('proLabore'));
    cmp(a, ITEM_LABEL.profit, e.profit, m.profit, () => {
      if (e.bad.includes('profit')) return e.bad.includes('salary') ? 'O Excel mostra erro porque o salário deste mês tem erro.' : BAD_CELL;
      const parts = [ITEM_LABEL.balance, ITEM_LABEL.salary, ITEM_LABEL.proLabore];
      const expected = dif(a, ITEM_LABEL.balance) - dif(a, ITEM_LABEL.salary) - dif(a, ITEM_LABEL.proLabore);
      return parts.every((x) => ok(a, x)) && near(m.profit - e.profit, expected) ? 'Consequência das diferenças acima neste mês.' : null;
    });
    for (const w of WALLETS) cmp(a, `Carteira ${w}`, e.wallets[w], m.wallets[w].net);
  }

  // Totais do ano: explicados quando sao a soma das diferencas (ja explicadas)
  // dos meses e dos meses futuros que o Excel ja conta.
  const yearReason = (year: string, item: string, diff: number, skippedValue: (e: ExcelMonth) => number) => {
    const ms = months.filter((m) => m.period.startsWith(year) && p.excel.months[m.period]);
    if (!ms.every((m) => ok(m.period, item))) return null;
    const future = Object.entries(p.excel.skipped).filter(([k]) => k.startsWith(year));
    const futureSum = future.reduce((s, [, e]) => s + skippedValue(e), 0);
    const expected = ms.reduce((s, m) => s + dif(m.period, item), 0) - futureSum;
    if (!near(diff, expected)) return null;
    const notes: string[] = [];
    if (ms.some((m) => !near(dif(m.period, item), 0))) notes.push('soma das diferenças dos meses, já explicadas acima');
    if (!near(futureSum, 0)) notes.push(`o Excel já conta ${future.filter(([, e]) => !near(skippedValue(e), 0)).map(([k]) => MONTH_NAMES[Number(k.slice(5)) - 1]).join(', ')}, que ainda não chegou`);
    if (!notes.length) return null;
    const text = notes.join('; ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  };
  for (const y of flow.years) {
    const e = p.excel.flow.years[y.year];
    if (!e) continue;
    const a = `Ano ${y.year}`;
    const item = (k: Exclude<ExcelField, 'dre'>, crm: number) => cmp(a, ITEM_LABEL[k], e[k], crm, () => (e.bad.includes(k)
      ? 'O total do ano no Excel tem erro porque um dos meses tem erro; o CRM calcula o valor.'
      : yearReason(y.year, ITEM_LABEL[k], crm - e[k], (s) => s[k])));
    item('revenue', y.totals.revenue);
    item('expense', y.totals.expense);
    item('balance', y.totals.balance);
    item('salary', y.totals.salary);
    item('proLabore', y.totals.proLabore);
    item('profit', y.totals.profit);
    for (const w of WALLETS) {
      cmp(a, `Carteira ${w}`, e.wallets[w], y.wallets[w], () => yearReason(y.year, `Carteira ${w}`, y.wallets[w] - e.wallets[w], (s) => s.wallets[w]));
    }
  }
  const walletsOk = () => {
    const w = [...seen.entries()].filter(([k, v]) => k.includes('|Carteira ') && !near(v.diff, 0));
    return w.length && w.every(([, v]) => v.explained) ? 'Consequência das diferenças nas carteiras, já explicadas acima.' : null;
  };
  cmp('Geral', 'Dinheiro existente', p.excel.flow.total, flow.total, walletsOk);
  cmp('Geral', 'Valor a distribuir', p.excel.flow.distributable, flow.distributable, walletsOk);
  for (const k of ['Previdencia', 'Oportunidade', 'Dono', 'Expansao'] as const) cmp('SEAL', k, p.excel.flow.funds[k], flow.funds[k].available, walletsOk);
  return { differences, months, checked };
}
