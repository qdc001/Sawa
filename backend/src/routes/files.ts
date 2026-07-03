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

// WhatsApp aceita documentos ate 100 MB. Deixamos aqui 100 MB para nao sermos
// o gargalo. O proxy Traefik do Easypanel tem que estar configurado ao mesmo
// nivel (label traefik.http.middlewares.body-limit.buffering.maxRequestBodyBytes
// no servico backend, ou remover o buffering).
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    // permitir tudo excepto executaveis
    const banned = ['.exe', '.bat', '.sh', '.cmd', '.msi'];
    if (banned.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Tipo de ficheiro não permitido'));
    }
    cb(null, true);
  },
});

// Middleware que apanha erros do multer (413, MIME, etc) antes de o request
// continuar, e devolve JSON com detalhe em vez de 500 opaco.
function handleUpload(req: AuthRequest, res: Response, next: any) {
  console.log(`[files/upload] recebido content-length=${req.headers['content-length'] || '?'} content-type=${req.headers['content-type'] || '?'}`);
  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      console.error('[files/upload] multer erro:', err.code, err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: `Ficheiro excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` });
      }
      return res.status(400).json({ message: err.message || 'Falha no upload' });
    }
    next();
  });
}

// POST /api/files/upload
router.post('/upload', handleUpload, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!req.file) throw new AppError('Sem ficheiro', 400);
    console.log(`[files/upload] ok filename=${req.file.filename} size=${req.file.size} mime=${req.file.mimetype}`);
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
