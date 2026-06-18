import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import prisma from '../lib/prisma';
const router = Router();

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cb(null, `${id}-${safe}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const banned = ['.exe', '.bat', '.sh', '.cmd', '.msi'];
    if (banned.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Tipo de ficheiro nao permitido'));
    }
    cb(null, true);
  },
});

// GET /api/products  (?search=&active=true)
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { search, active } = req.query as { search?: string; active?: string };
    const products = await prisma.product.findMany({
      where: {
        workspaceId: req.user!.workspaceId,
        ...(active === 'true' ? { isActive: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { files: { orderBy: { createdAt: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (e) { next(e); }
});

// POST /api/products
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, description, sku, unitPrice, currency, taxRate, unit, isActive } = req.body;
    if (!name || !name.trim()) throw new AppError('Nome do produto obrigatório', 400);
    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        sku: sku?.trim() || null,
        unitPrice: Number(unitPrice) || 0,
        currency: currency || undefined,
        taxRate: Number(taxRate) || 0,
        unit: unit?.trim() || null,
        isActive: isActive !== false,
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(product);
  } catch (e) { next(e); }
});

// PATCH /api/products/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Produto não encontrado', 404);

    const { name, description, sku, unitPrice, currency, taxRate, unit, isActive } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(sku !== undefined && { sku: sku?.trim() || null }),
        ...(unitPrice !== undefined && { unitPrice: Number(unitPrice) || 0 }),
        ...(currency !== undefined && { currency }),
        ...(taxRate !== undefined && { taxRate: Number(taxRate) || 0 }),
        ...(unit !== undefined && { unit: unit?.trim() || null }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    });
    res.json(product);
  } catch (e) { next(e); }
});

// DELETE /api/products/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: { files: true },
    });
    if (!existing) throw new AppError('Produto não encontrado', 404);
    // Apaga ficheiros do disco antes de apagar o produto (cascade BD apaga registo).
    for (const f of existing.files) {
      try {
        const fp = path.join(uploadsDir, path.basename(f.url));
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch { /* ignorar */ }
    }
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Produto eliminado' });
  } catch (e) { next(e); }
});

// ==================== Ficheiros do catalogo ====================
// Sao usados pela IA Vendedora para enviar materiais (fotos, brochuras, PDFs)
// no momento certo. Cada ficheiro tem rotulo curto (ex: "Brochura 2026") e
// descricao para a IA decidir quando o usar.

async function ensureProductOwnership(productId: string, workspaceId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, workspaceId } });
  if (!product) throw new AppError('Produto não encontrado', 404);
  return product;
}

// GET /api/products/:id/files
router.get('/:id/files', async (req: AuthRequest, res: Response, next) => {
  try {
    await ensureProductOwnership(req.params.id, req.user!.workspaceId);
    const files = await prisma.file.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(files);
  } catch (e) { next(e); }
});

// POST /api/products/:id/files  (multipart: file, label?, description?)
router.post('/:id/files', upload.single('file'), async (req: AuthRequest, res: Response, next) => {
  try {
    await ensureProductOwnership(req.params.id, req.user!.workspaceId);
    if (!req.file) throw new AppError('Sem ficheiro', 400);
    const file = await prisma.file.create({
      data: {
        name: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        size: req.file.size,
        mimeType: req.file.mimetype,
        productId: req.params.id,
        label: typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 80) || null : null,
        description: typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 500) || null : null,
      },
    });
    res.status(201).json(file);
  } catch (e) { next(e); }
});

// PATCH /api/products/:id/files/:fileId  (actualiza label/descricao)
router.patch('/:id/files/:fileId', async (req: AuthRequest, res: Response, next) => {
  try {
    await ensureProductOwnership(req.params.id, req.user!.workspaceId);
    const existing = await prisma.file.findFirst({
      where: { id: req.params.fileId, productId: req.params.id },
    });
    if (!existing) throw new AppError('Ficheiro não encontrado', 404);
    const { label, description } = req.body || {};
    const file = await prisma.file.update({
      where: { id: req.params.fileId },
      data: {
        ...(label !== undefined && { label: typeof label === 'string' ? label.trim().slice(0, 80) || null : null }),
        ...(description !== undefined && { description: typeof description === 'string' ? description.trim().slice(0, 500) || null : null }),
      },
    });
    res.json(file);
  } catch (e) { next(e); }
});

// DELETE /api/products/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req: AuthRequest, res: Response, next) => {
  try {
    await ensureProductOwnership(req.params.id, req.user!.workspaceId);
    const existing = await prisma.file.findFirst({
      where: { id: req.params.fileId, productId: req.params.id },
    });
    if (!existing) throw new AppError('Ficheiro não encontrado', 404);
    await prisma.file.delete({ where: { id: req.params.fileId } });
    try {
      const fp = path.join(uploadsDir, path.basename(existing.url));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch { /* ignorar */ }
    res.json({ message: 'Ficheiro eliminado' });
  } catch (e) { next(e); }
});

export default router;
