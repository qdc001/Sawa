// Um relatorio descrito uma vez (seccoes, listas e tabelas) e gerado em Word, PDF ou Excel.
// O ecra do CRM mostra o mesmo objecto, por isso o ficheiro e sempre igual ao que se ve.
import PDFDocument from 'pdfkit';
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { buildXlsx, XlsxSheet } from './xlsxWriter';

export type ReportCell = string | number | null;
export type ReportTable = { title?: string; columns: string[]; rows: ReportCell[][]; numeric?: number[]; empty?: string };
export type ReportSection = { heading: string; intro?: string; bullets?: string[]; tables?: ReportTable[] };
export type ReportDoc = { title: string; subtitle: string; generatedAt: string; sections: ReportSection[] };

const cellText = (v: ReportCell) => (v === null || v === undefined || v === '' ? '—' : String(v));

// ---------- Word ----------
export async function renderDocx(doc: ReportDoc): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title, bold: true, size: 36 })] }),
    new Paragraph({ children: [new TextRun({ text: doc.subtitle, size: 22, color: '475569' })] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `Gerado em ${doc.generatedAt}`, size: 18, color: '64748B' })] }),
  ];
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };
  for (const s of doc.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 }, children: [new TextRun({ text: s.heading, bold: true, size: 28 })] }));
    if (s.intro) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: s.intro, size: 20, color: '475569' })] }));
    for (const b of s.bullets || []) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 20 })] }));
    for (const t of s.tables || []) {
      if (t.title) children.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t.title, bold: true, size: 22 })] }));
      if (!t.rows.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: t.empty || 'Nada a registar.', italics: true, size: 20, color: '64748B' })] }));
        continue;
      }
      const num = new Set(t.numeric || []);
      const cell = (v: ReportCell, i: number, head: boolean) => new TableCell({
        borders,
        shading: head ? { type: ShadingType.CLEAR, fill: 'E2E8F0', color: 'auto' } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({
          alignment: num.has(i) ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text: cellText(v), bold: head, size: 18 })],
        })],
      });
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: t.columns.map((c, i) => cell(c, i, true)) }),
          ...t.rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, i, false)) })),
        ],
      }));
    }
  }
  const d = new Document({
    creator: 'Klaru CRM', title: doc.title,
    styles: { default: { document: { run: { font: 'Arial' } } } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 800, bottom: 800, left: 800, right: 800 } } }, children }],
  });
  return Packer.toBuffer(d);
}

// ---------- PDF ----------
export function renderPdf(doc: ReportDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;
    const bottom = () => pdf.page.height - pdf.page.margins.bottom;
    const ensure = (h: number) => { if (pdf.y + h > bottom()) pdf.addPage(); };

    pdf.font('Helvetica-Bold').fontSize(18).fillColor('#0F172A').text(doc.title, left, pdf.y, { width });
    pdf.font('Helvetica').fontSize(11).fillColor('#475569').text(doc.subtitle, { width });
    pdf.fontSize(8).fillColor('#64748B').text(`Gerado em ${doc.generatedAt}`, { width });
    pdf.moveDown(0.8);

    for (const s of doc.sections) {
      ensure(40);
      pdf.font('Helvetica-Bold').fontSize(13).fillColor('#0F172A').text(s.heading, left, pdf.y, { width });
      pdf.moveDown(0.3);
      if (s.intro) { pdf.font('Helvetica').fontSize(9).fillColor('#475569').text(s.intro, { width }); pdf.moveDown(0.3); }
      for (const b of s.bullets || []) { ensure(14); pdf.font('Helvetica').fontSize(9).fillColor('#0F172A').text(`•  ${b}`, left + 6, pdf.y, { width: width - 6 }); }
      if (s.bullets?.length) pdf.moveDown(0.3);
      for (const t of s.tables || []) {
        if (t.title) { ensure(30); pdf.font('Helvetica-Bold').fontSize(10).fillColor('#0F172A').text(t.title, left, pdf.y, { width }); pdf.moveDown(0.2); }
        if (!t.rows.length) { pdf.font('Helvetica-Oblique').fontSize(9).fillColor('#64748B').text(t.empty || 'Nada a registar.', left, pdf.y, { width }); pdf.moveDown(0.5); continue; }
        drawTable(pdf, t, left, width, ensure);
        pdf.moveDown(0.6);
      }
      pdf.moveDown(0.4);
    }
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      pdf.font('Helvetica').fontSize(7).fillColor('#94A3B8')
        .text(`${doc.title} · página ${i + 1} de ${range.count}`, left, pdf.page.height - 24, { width, align: 'right', lineBreak: false });
    }
    pdf.end();
  });
}

function drawTable(pdf: PDFKit.PDFDocument, t: ReportTable, left: number, width: number, ensure: (h: number) => void) {
  const size = 7.5;
  const pad = 3;
  const num = new Set(t.numeric || []);
  // Largura de cada coluna pelo texto mais comprido (com limites), ajustada a largura da pagina.
  pdf.font('Helvetica').fontSize(size);
  const want = t.columns.map((c, i) => {
    let w = pdf.widthOfString(c) + 2 * pad;
    for (const r of t.rows.slice(0, 200)) w = Math.max(w, Math.min(pdf.widthOfString(cellText(r[i])) + 2 * pad, 260));
    return Math.max(w, 34);
  });
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => (w / total) * width);
  const rowHeight = (cells: string[], bold: boolean) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    return Math.max(...cells.map((c, i) => pdf.heightOfString(c, { width: widths[i] - 2 * pad }))) + 2 * pad;
  };
  const drawRow = (cells: string[], head: boolean) => {
    const h = rowHeight(cells, head);
    ensure(h);
    const y = pdf.y;
    let x = left;
    if (head) pdf.rect(left, y, width, h).fill('#E2E8F0');
    pdf.fillColor('#0F172A').font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    cells.forEach((c, i) => {
      pdf.text(c, x + pad, y + pad, { width: widths[i] - 2 * pad, align: num.has(i) ? 'right' : 'left' });
      x += widths[i];
    });
    pdf.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.4).strokeColor('#CBD5E1').stroke();
    pdf.x = left;
    pdf.y = y + h;
  };
  const header = t.columns;
  ensure(rowHeight(header, true) + 14);
  drawRow(header, true);
  for (const r of t.rows) {
    const cells = r.map(cellText);
    if (pdf.y + rowHeight(cells, false) > pdf.page.height - pdf.page.margins.bottom) { pdf.addPage(); drawRow(header, true); }
    drawRow(cells, false);
  }
}

// ---------- Excel: uma folha por tabela ----------
export function renderXlsx(doc: ReportDoc): Promise<Buffer> {
  const sheets: XlsxSheet[] = [];
  const used = new Set<string>();
  const summary: XlsxSheet = { name: 'Resumo', rows: [[doc.title], [doc.subtitle], [`Gerado em ${doc.generatedAt}`], []] };
  sheets.push(summary);
  used.add('resumo');
  for (const s of doc.sections) {
    summary.rows.push([s.heading]);
    for (const b of s.bullets || []) summary.rows.push([`• ${b}`]);
    summary.rows.push([]);
    for (const t of s.tables || []) {
      let base = (t.title || s.heading).replace(/[[\]:*?/\\]/g, ' ').slice(0, 28).trim();
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 26)} ${n}`;
      used.add(name.toLowerCase());
      sheets.push({ name, rows: [t.columns, ...t.rows] });
    }
  }
  return buildXlsx(sheets);
}

export async function sendReport(res: any, doc: ReportDoc, format: string, fileBase: string) {
  if (format === 'docx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.docx"`);
    return res.send(await renderDocx(doc));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
    return res.send(await renderPdf(doc));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    return res.send(await renderXlsx(doc));
  }
  return res.json(doc);
}
