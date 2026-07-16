// CRUD de base de conhecimento da Leizy (Sprint 4).
// Um documento e um bloco de texto (do admin) que serve de fonte de verdade
// para respostas: tabela de precos, procedimentos, planos aceites, protocolos.
// O documento e fatiado em chunks pesquisaveis pelo retriever.
//
// v1 aceita texto directo (copy-paste). Upload de PDF fica para v2 (precisa
// pdf-parse). O admin cola texto no editor e nos fatiamos.

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { chunkDocumentText } from '../lib/aiKnowledgeRetrieval';

const router = Router();

// GET /api/knowledge - lista documentos do workspace
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const docs = await prisma.knowledgeDocument.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, category: true, sourceType: true,
        fileSizeKb: true, isActive: true, createdAt: true, updatedAt: true,
        _count: { select: { chunks: true } },
      },
    });
    res.json(docs);
  } catch (e) { next(e); }
});

// GET /api/knowledge/:id - detalhe (com content)
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!doc) throw new AppError('Documento nao encontrado', 404);
    res.json(doc);
  } catch (e) { next(e); }
});

// POST /api/knowledge - criar
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
      throw new AppError('Sem permissao', 403);
    }
    const { title, content, category } = req.body || {};
    if (!title || !String(title).trim()) throw new AppError('Titulo obrigatorio', 400);
    if (!content || !String(content).trim()) throw new AppError('Conteudo obrigatorio', 400);

    const cleanContent = String(content).trim();
    const doc = await prisma.knowledgeDocument.create({
      data: {
        workspaceId: req.user!.workspaceId,
        title: String(title).trim().slice(0, 200),
        content: cleanContent,
        category: category ? String(category).trim().slice(0, 60) : null,
        sourceType: 'text',
        fileSizeKb: Math.ceil(Buffer.byteLength(cleanContent, 'utf8') / 1024),
        createdById: req.user!.id,
      },
    });

    // Fatiar em chunks
    const chunks = chunkDocumentText(cleanContent, 500);
    if (chunks.length > 0) {
      await prisma.knowledgeChunk.createMany({
        data: chunks.map((c, i) => ({
          workspaceId: req.user!.workspaceId,
          documentId: doc.id,
          chunkIndex: i,
          content: c,
        })),
      });
    }

    res.status(201).json({ ...doc, chunksCreated: chunks.length });
  } catch (e) { next(e); }
});

// PATCH /api/knowledge/:id - actualizar (refatia chunks se content mudou)
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
      throw new AppError('Sem permissao', 403);
    }
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Documento nao encontrado', 404);

    const { title, content, category, isActive } = req.body || {};
    const data: any = {};
    if (title !== undefined) data.title = String(title).trim().slice(0, 200);
    if (category !== undefined) data.category = category ? String(category).trim().slice(0, 60) : null;
    if (isActive !== undefined) data.isActive = !!isActive;

    // Se o content mudou, refatiar chunks
    let chunksCreated = 0;
    if (content !== undefined && content !== existing.content) {
      const cleanContent = String(content).trim();
      data.content = cleanContent;
      data.fileSizeKb = Math.ceil(Buffer.byteLength(cleanContent, 'utf8') / 1024);
      // apagar chunks antigos e recriar
      await prisma.knowledgeChunk.deleteMany({ where: { documentId: existing.id } });
      const chunks = chunkDocumentText(cleanContent, 500);
      if (chunks.length > 0) {
        await prisma.knowledgeChunk.createMany({
          data: chunks.map((c, i) => ({
            workspaceId: req.user!.workspaceId,
            documentId: existing.id,
            chunkIndex: i,
            content: c,
          })),
        });
      }
      chunksCreated = chunks.length;
    }

    const updated = await prisma.knowledgeDocument.update({
      where: { id: existing.id },
      data,
    });

    res.json({ ...updated, chunksCreated });
  } catch (e) { next(e); }
});

// DELETE /api/knowledge/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
      throw new AppError('Sem permissao', 403);
    }
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!existing) throw new AppError('Documento nao encontrado', 404);
    await prisma.knowledgeDocument.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
