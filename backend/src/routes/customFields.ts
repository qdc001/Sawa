import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

// GET /api/custom-fields?entity=lead
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { entity } = req.query;
    const where: any = { workspaceId: req.user!.workspaceId };
    if (entity) where.entity = entity as string;
    const fields = await prisma.customField.findMany({
      where,
      orderBy: { position: 'asc' },
    });
    res.json(fields);
  } catch (e) { next(e); }
});

// POST /api/custom-fields
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, key, type, entity, options, isRequired, position } = req.body;
    if (!name || !type || !entity) throw new AppError('Nome, tipo e entidade são obrigatórios', 400);

    const slugKey = (key || name).toString().toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);

    const count = await prisma.customField.count({
      where: { workspaceId: req.user!.workspaceId, entity },
    });

    const field = await prisma.customField.create({
      data: {
        name,
        key: slugKey || `field_${Date.now()}`,
        type,
        entity,
        options: Array.isArray(options) ? options : [],
        isRequired: !!isRequired,
        position: position ?? count,
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(field);
  } catch (e) { next(e); }
});

// PATCH /api/custom-fields/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, options, isRequired, position } = req.body;
    const field = await prisma.customField.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(options !== undefined && { options }),
        ...(isRequired !== undefined && { isRequired: !!isRequired }),
        ...(position !== undefined && { position }),
      },
    });
    res.json(field);
  } catch (e) { next(e); }
});

// DELETE /api/custom-fields/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.customFieldValue.deleteMany({ where: { fieldId: req.params.id } });
    await prisma.customField.delete({ where: { id: req.params.id } });
    res.json({ message: 'Campo eliminado' });
  } catch (e) { next(e); }
});

export default router;
