import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

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
    });
    if (!existing) throw new AppError('Produto não encontrado', 404);
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ message: 'Produto eliminado' });
  } catch (e) { next(e); }
});

export default router;
