import { Router, Response } from 'express';
import PDFDocument from 'pdfkit';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// ==================== Helpers ====================

interface ItemInput {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string | null;
  productId?: string | null;
}

interface TotalsOpts {
  discountType?: string;
  discountValue?: number | string;
  taxRate?: number | string;
}

function computeTotals(items: ItemInput[], opts: TotalsOpts) {
  const subtotal = items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
    0
  );
  let discountAmount = 0;
  if (opts.discountType === 'percent') discountAmount = subtotal * (Number(opts.discountValue) || 0) / 100;
  else if (opts.discountType === 'amount') discountAmount = Number(opts.discountValue) || 0;
  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
  const net = subtotal - discountAmount;
  const taxBeforeDiscount = items.reduce((s, i) => {
    const line = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    const rate = i.taxRate !== undefined && i.taxRate !== null && i.taxRate !== ('' as any)
      ? Number(i.taxRate)
      : (Number(opts.taxRate) || 0);
    return s + line * (rate / 100);
  }, 0);
  const tax = subtotal > 0 ? taxBeforeDiscount * (net / subtotal) : 0;
  const total = net + tax;
  return {
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    tax: round2(tax),
    total: round2(total),
  };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function nextQuoteNumber(workspaceId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.quote.count({
    where: { workspaceId, createdAt: { gte: new Date(year, 0, 1) } },
  });
  return `PROP-${year}-${String(count + 1).padStart(4, '0')}`;
}

function money(n: number, currency: string) {
  const s = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  const [int, dec] = s.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${currency} ${withSep},${dec}`;
}

function dmy(d: Date | string | null | undefined) {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho', SENT: 'Enviada', ACCEPTED: 'Aceite', REJECTED: 'Recusada',
};

const quoteInclude = {
  items: { orderBy: { position: 'asc' as const }, include: { product: { select: { id: true, name: true } } } },
  contact: { select: { id: true, firstName: true, lastName: true, company: true, email: true, phone: true, whatsapp: true } },
  lead: { select: { id: true, title: true } },
  createdBy: { select: { id: true, name: true } },
};

// ==================== Rotas ====================

// GET /api/quotes  (?status=&search=)
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { status, search } = req.query as { status?: string; search?: string };
    const quotes = await prisma.quote.findMany({
      where: {
        workspaceId: req.user!.workspaceId,
        ...(status ? { status: status as any } : {}),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: quoteInclude,
    });
    const withTotals = quotes.map((q) => ({
      ...q,
      totals: computeTotals(q.items as any, q),
    }));
    res.json(withTotals);
  } catch (e) { next(e); }
});

// GET /api/quotes/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: quoteInclude,
    });
    if (!quote) throw new AppError('Proposta não encontrada', 404);
    res.json({ ...quote, totals: computeTotals(quote.items as any, quote) });
  } catch (e) { next(e); }
});

// POST /api/quotes
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { title, contactId, leadId, currency, notes, discountType, discountValue, taxRate, validUntil, items } = req.body;
    if (!title || !title.trim()) throw new AppError('Título da proposta obrigatório', 400);
    const itemList: ItemInput[] = Array.isArray(items) ? items : [];

    const number = await nextQuoteNumber(req.user!.workspaceId);
    const quote = await prisma.quote.create({
      data: {
        number,
        title: title.trim(),
        currency: currency || undefined,
        notes: notes?.trim() || null,
        discountType: discountType || 'none',
        discountValue: Number(discountValue) || 0,
        taxRate: Number(taxRate) || 0,
        validUntil: validUntil ? new Date(validUntil) : null,
        workspaceId: req.user!.workspaceId,
        createdById: req.user!.id,
        contactId: contactId || null,
        leadId: leadId || null,
        items: {
          create: itemList.map((it, idx) => ({
            description: (it.description || '').trim() || 'Item',
            quantity: Number(it.quantity) || 0,
            unitPrice: Number(it.unitPrice) || 0,
            taxRate: Number(it.taxRate) || 0,
            position: idx,
            productId: it.productId || null,
          })),
        },
      },
      include: quoteInclude,
    });
    res.status(201).json({ ...quote, totals: computeTotals(quote.items as any, quote) });
  } catch (e) { next(e); }
});

// PATCH /api/quotes/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.quote.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Proposta não encontrada', 404);

    const { title, contactId, leadId, currency, notes, discountType, discountValue, taxRate, validUntil, items } = req.body;
    const data: any = {
      ...(title !== undefined && { title: title.trim() }),
      ...(contactId !== undefined && { contactId: contactId || null }),
      ...(leadId !== undefined && { leadId: leadId || null }),
      ...(currency !== undefined && { currency }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(discountType !== undefined && { discountType }),
      ...(discountValue !== undefined && { discountValue: Number(discountValue) || 0 }),
      ...(taxRate !== undefined && { taxRate: Number(taxRate) || 0 }),
      ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
    };

    // Se vierem itens, substitui-os por completo
    if (Array.isArray(items)) {
      data.items = {
        deleteMany: {},
        create: (items as ItemInput[]).map((it, idx) => ({
          description: (it.description || '').trim() || 'Item',
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          taxRate: Number(it.taxRate) || 0,
          position: idx,
          productId: it.productId || null,
        })),
      };
    }

    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data,
      include: quoteInclude,
    });
    res.json({ ...quote, totals: computeTotals(quote.items as any, quote) });
  } catch (e) { next(e); }
});

// PATCH /api/quotes/:id/status  { status }
router.patch('/:id/status', async (req: AuthRequest, res: Response, next) => {
  try {
    const { status } = req.body;
    if (!['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'].includes(status)) {
      throw new AppError('Estado invalido', 400);
    }
    const existing = await prisma.quote.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Proposta não encontrada', 404);

    const now = new Date();
    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(status === 'SENT' && !existing.sentAt ? { sentAt: now } : {}),
        ...(status === 'ACCEPTED' ? { acceptedAt: now } : {}),
        ...(status === 'REJECTED' ? { rejectedAt: now } : {}),
      },
      include: quoteInclude,
    });
    res.json({ ...quote, totals: computeTotals(quote.items as any, quote) });
  } catch (e) { next(e); }
});

// DELETE /api/quotes/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.quote.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Proposta não encontrada', 404);
    await prisma.quote.delete({ where: { id: req.params.id } });
    res.json({ message: 'Proposta eliminada' });
  } catch (e) { next(e); }
});

// GET /api/quotes/:id/pdf  — gera o PDF com a marca Sawa
router.get('/:id/pdf', async (req: AuthRequest, res: Response, next) => {
  try {
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: quoteInclude,
    });
    if (!quote) throw new AppError('Proposta não encontrada', 404);
    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { name: true },
    });
    const totals = computeTotals(quote.items as any, quote);
    const cur = quote.currency;

    const INK = '#1A2E25';
    const TERRA = '#C8553D';
    const MUTED = '#6B7280';
    const LIGHT = '#E7E0D2';

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${quote.number}.pdf"`);
    doc.pipe(res);

    const left = 50;
    const right = 545;
    const contentW = right - left;

    // Cabecalho: simbolo Sawa (circulo + ponto) e wordmark
    doc.lineWidth(2).strokeColor(TERRA).circle(left + 9, 66, 9).stroke();
    doc.fillColor(TERRA).circle(left + 15, 71, 3.2).fill();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('Sawa', left + 26, 56);

    // Emissor e título do documento (direita)
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('PROPOSTA', left, 54, { width: contentW, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(quote.number, left, 76, { width: contentW, align: 'right' });
    doc.text(workspace?.name || 'Sawa', left, 90, { width: contentW, align: 'right' });

    // Linha separadora
    doc.moveTo(left, 116).lineTo(right, 116).lineWidth(1).strokeColor(LIGHT).stroke();

    // Bloco cliente + meta
    let y = 132;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('PARA', left, y);
    const c = quote.contact;
    const clientName = c ? `${c.firstName} ${c.lastName || ''}`.trim() : 'Cliente';
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(clientName, left, y + 12);
    let cy = y + 28;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    if (c?.company) { doc.text(c.company, left, cy); cy += 13; }
    if (c?.email) { doc.text(c.email, left, cy); cy += 13; }
    if (c?.phone || c?.whatsapp) { doc.text(c.phone || c.whatsapp || '', left, cy); cy += 13; }

    // Meta (direita)
    const metaX = 360;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text('Data:', metaX, y + 12, { continued: true }).fillColor(INK).text('  ' + dmy(quote.createdAt));
    doc.fillColor(MUTED).text('Estado:', metaX, y + 27, { continued: true }).fillColor(INK).text('  ' + (STATUS_LABELS[quote.status] || quote.status));
    if (quote.validUntil) {
      doc.fillColor(MUTED).text('Valida até:', metaX, y + 42, { continued: true }).fillColor(INK).text('  ' + dmy(quote.validUntil));
    }

    // Título da proposta
    y = Math.max(cy, y + 60) + 6;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(quote.title, left, y, { width: contentW });
    y = doc.y + 12;

    // Cabecalho da tabela
    const colDesc = left;
    const colQty = 320;
    const colPrice = 380;
    const colTotal = 470;
    const rowH = 22;

    doc.rect(left, y, contentW, 22).fill(INK);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIÇÃO', colDesc + 8, y + 7);
    doc.text('QTD', colQty, y + 7, { width: 50, align: 'right' });
    doc.text('PREÇO', colPrice, y + 7, { width: 80, align: 'right' });
    doc.text('TOTAL', colTotal, y + 7, { width: right - colTotal - 8, align: 'right' });
    y += 22;

    // Linhas
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    for (const it of quote.items as any[]) {
      const line = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
      const descH = doc.heightOfString(it.description, { width: colQty - colDesc - 16 });
      const h = Math.max(rowH, descH + 10);
      if (y + h > 760) { doc.addPage(); y = 50; }
      doc.fillColor(INK).text(it.description, colDesc + 8, y + 5, { width: colQty - colDesc - 16 });
      doc.fillColor(MUTED).text(String(it.quantity), colQty, y + 5, { width: 50, align: 'right' });
      doc.text(money(Number(it.unitPrice) || 0, cur), colPrice, y + 5, { width: 80, align: 'right' });
      doc.fillColor(INK).text(money(line, cur), colTotal, y + 5, { width: right - colTotal - 8, align: 'right' });
      doc.moveTo(left, y + h).lineTo(right, y + h).lineWidth(0.5).strokeColor(LIGHT).stroke();
      y += h;
    }

    // Totais
    y += 12;
    const totX = 350;
    const totLabelW = 110;
    const drawTot = (label: string, val: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.fillColor(bold ? INK : MUTED).text(label, totX, y, { width: totLabelW, align: 'right' });
      doc.fillColor(INK).text(val, totX + totLabelW, y, { width: right - totX - totLabelW, align: 'right' });
      y += bold ? 22 : 16;
    };
    drawTot('Subtotal', money(totals.subtotal, cur));
    if (totals.discountAmount > 0) drawTot('Desconto', '- ' + money(totals.discountAmount, cur));
    if (totals.tax > 0) drawTot('Imposto', money(totals.tax, cur));
    doc.moveTo(totX, y + 2).lineTo(right, y + 2).lineWidth(1).strokeColor(LIGHT).stroke();
    y += 8;
    drawTot('TOTAL', money(totals.total, cur), true);

    // Notas / termos
    if (quote.notes) {
      y += 16;
      if (y > 720) { doc.addPage(); y = 50; }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('NOTAS E CONDIÇÕES', left, y);
      y += 14;
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(quote.notes, left, y, { width: contentW });
    }

    // Rodape
    const footerY = 800;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`${workspace?.name || 'Sawa'}  ·  Proposta ${quote.number}  ·  Gerada pelo Sawa CRM`, left, footerY, { width: contentW, align: 'center' });

    doc.end();
  } catch (e) { next(e); }
});

export default router;
