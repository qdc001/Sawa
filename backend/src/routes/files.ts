import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import prisma from '../lib/prisma';
const router = Router();

// Pasta uploads/
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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    // permitir tudo excepto executaveis
    const banned = ['.exe', '.bat', '.sh', '.cmd', '.msi'];
    if (banned.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Tipo de ficheiro não permitido'));
    }
    cb(null, true);
  },
});

// POST /api/files/upload
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response, next) => {
  try {
    if (!req.file) throw new AppError('Sem ficheiro', 400);
    const file = await prisma.file.create({
      data: {
        name: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        size: req.file.size,
        mimeType: req.file.mimetype,
        leadId: req.body.leadId || null,
      },
    });
    res.status(201).json(file);
  } catch (e) { next(e); }
});

// GET /api/files?leadId=X
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: any = {};
    if (req.query.leadId) where.leadId = req.query.leadId;
    const files = await prisma.file.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(files);
  } catch (e) { next(e); }
});

// DELETE /api/files/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const file = await prisma.file.findUnique({ where: { id: req.params.id } });
    if (!file) throw new AppError('Ficheiro não encontrado', 404);
    await prisma.file.delete({ where: { id: req.params.id } });
    // tentar apagar do disco
    try {
      const filePath = path.join(uploadsDir, path.basename(file.url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
    res.json({ message: 'Ficheiro eliminado' });
  } catch (e) { next(e); }
});

export default router;
