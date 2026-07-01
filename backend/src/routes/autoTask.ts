// Endpoints para envio de mensagem com criacao/actualizacao automatica de
// tarefa. Dois fluxos:
//
// 1) POST /api/auto-task/announce
//    "Vou enviar X do Y ate D" — envia mensagem WhatsApp + cria tarefa nova.
//
// 2) POST /api/auto-task/deliver
//    "Envio em anexo X, pede feedback" — envia mensagem WhatsApp + fecha a
//    tarefa antiga (se indicada) + cria nova tarefa de follow-up.
//
// A estrutura de tipos e os textos das mensagens sao configuraveis por
// workspace via Workspace.autoTaskConfig. Ver lib/autoTaskDefaults.ts para
// os defaults e o renderer de templates.

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { sendWhatsAppOut } from '../lib/whatsappSend';
import {
  getEffectiveConfig,
  renderTemplate,
  formatDDMM,
  DEFAULT_AUTO_TASK_CONFIG,
  AutoTaskConfig,
} from '../lib/autoTaskDefaults';

const router = Router();

function requireAdmin(req: AuthRequest) {
  if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
    throw new AppError('Apenas administradores podem editar a configuração', 403);
  }
}

function ddmmToDate(ddmm: string): Date | null {
  const m = ddmm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month, day, 23, 59, 59, 999);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d < yesterday && !m[3]) d.setFullYear(year + 1);
  return d;
}

// GET /api/auto-task/config — devolve config actual do workspace com defaults aplicados
router.get('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { autoTaskConfig: true },
    });
    const config = getEffectiveConfig(ws?.autoTaskConfig);
    res.json({ config, isCustom: !!ws?.autoTaskConfig });
  } catch (e) { next(e); }
});

// PATCH /api/auto-task/config (admin) — grava config custom
router.patch('/config', async (req: AuthRequest, res: Response, next) => {
  try {
    requireAdmin(req);
    const body = req.body || {};
    // Aceita reset via { reset: true } que apaga a config custom
    if (body.reset === true) {
      await prisma.workspace.update({
        where: { id: req.user!.workspaceId },
        data: { autoTaskConfig: null as any },
      });
      return res.json({ config: DEFAULT_AUTO_TASK_CONFIG, isCustom: false });
    }
    const validated = getEffectiveConfig(body);
    await prisma.workspace.update({
      where: { id: req.user!.workspaceId },
      data: { autoTaskConfig: validated as any },
    });
    res.json({ config: validated, isCustom: true });
  } catch (e) { next(e); }
});

async function getConfig(workspaceId: string): Promise<AutoTaskConfig> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { autoTaskConfig: true },
  });
  return getEffectiveConfig(ws?.autoTaskConfig);
}

// POST /api/auto-task/announce
// Body: { contactId, subject, typeKey?, customTypeLabel?, dueDate (DD/MM), leadId? }
router.post('/announce', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, subject, typeKey, customTypeLabel, dueDate, leadId } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatorio', 400);
    if (!dueDate) throw new AppError('Data obrigatoria (formato DD/MM)', 400);
    const parsedDate = ddmmToDate(String(dueDate).trim());
    if (!parsedDate) throw new AppError('Data invalida. Usa DD/MM ou DD/MM/YYYY', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp', 400);

    const config = await getConfig(req.user!.workspaceId);
    const workType = typeKey ? config.workTypes.find((t) => t.key === typeKey) : null;
    // Se e "outros" com label customizada, usar essa label mantendo artigo/possessivo do tipo
    const effectiveTipo = customTypeLabel && workType?.key === 'outros'
      ? customTypeLabel.trim()
      : (workType?.label || '');
    const artigo = workType?.article || '';
    const possessivo = workType?.possessive || '';
    const contactName = contact.firstName || 'cliente';
    const subj = subject.trim();
    const dateDDMM = formatDDMM(parsedDate);

    const messageContent = renderTemplate(config.announceTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
      data: dateDDMM,
    });
    const taskTitle = renderTemplate(config.announceTaskTitleTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
    });

    // 1. Enviar via WhatsApp
    const sendResult = await sendWhatsAppOut(req.user!.workspaceId, phone, messageContent, 'TEXT');
    if (!sendResult.ok) throw new AppError(`Falha a enviar: ${sendResult.error || 'desconhecido'}`, 502);

    // 2. Persistir mensagem
    const message = await prisma.message.create({
      data: {
        content: messageContent,
        type: 'TEXT',
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: 'SENT',
        externalId: sendResult.externalId,
        contactId: contact.id,
        leadId: leadId || null,
        sentById: req.user!.id,
      },
    });

    // 3. Criar tarefa
    const task = await prisma.task.create({
      data: {
        title: taskTitle,
        description: messageContent,
        type: 'OTHER',
        status: 'PENDING',
        priority: 'MEDIUM',
        dueAt: parsedDate,
        contactId: contact.id,
        leadId: leadId || null,
        assignedToId: req.user!.id,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);
      io.to(`workspace:${req.user!.workspaceId}`).emit('task:new', task);
    }

    res.status(201).json({ message, task, sentVia: sendResult.via });
  } catch (e) { next(e); }
});

// POST /api/auto-task/deliver
// Body: { contactId, subject, typeKey?, customTypeLabel?, taskToCompleteId?, leadId?, attachmentUrl?, attachmentName? }
router.post('/deliver', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, subject, typeKey, customTypeLabel, taskToCompleteId, leadId, attachmentUrl, attachmentName } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatorio', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp', 400);

    const config = await getConfig(req.user!.workspaceId);
    const workType = typeKey ? config.workTypes.find((t) => t.key === typeKey) : null;
    const effectiveTipo = customTypeLabel && workType?.key === 'outros'
      ? customTypeLabel.trim()
      : (workType?.label || '');
    const artigo = workType?.article || '';
    const possessivo = workType?.possessive || '';
    const contactName = contact.firstName || 'cliente';
    const subj = subject.trim();

    const messageContent = renderTemplate(config.deliverTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
    });
    const followupTitle = renderTemplate(config.followupTitleTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
    });

    // 1. Enviar mensagem (com anexo se dado)
    let sendResult;
    let messageType: 'TEXT' | 'DOCUMENT' = 'TEXT';
    if (attachmentUrl) {
      messageType = 'DOCUMENT';
      sendResult = await sendWhatsAppOut(req.user!.workspaceId, phone, messageContent, 'DOCUMENT', attachmentUrl, attachmentName);
    } else {
      sendResult = await sendWhatsAppOut(req.user!.workspaceId, phone, messageContent, 'TEXT');
    }
    if (!sendResult.ok) throw new AppError(`Falha a enviar: ${sendResult.error || 'desconhecido'}`, 502);

    const message = await prisma.message.create({
      data: {
        content: messageContent,
        type: messageType,
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: 'SENT',
        externalId: sendResult.externalId,
        contactId: contact.id,
        leadId: leadId || null,
        sentById: req.user!.id,
        mediaUrl: attachmentUrl || null,
      },
    });

    let closedTask = null;
    if (taskToCompleteId) {
      try {
        closedTask = await prisma.task.update({
          where: { id: taskToCompleteId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      } catch { /* pode ja estar fechada */ }
    }

    const followupDue = new Date();
    followupDue.setDate(followupDue.getDate() + (config.followupDays || 3));
    followupDue.setHours(23, 59, 59, 999);

    const followupTask = await prisma.task.create({
      data: {
        title: followupTitle,
        description: `Follow-up: confirmar se ${contactName} recebeu e analisou o material enviado.`,
        type: 'FOLLOW_UP',
        status: 'PENDING',
        priority: 'MEDIUM',
        dueAt: followupDue,
        contactId: contact.id,
        leadId: leadId || null,
        assignedToId: req.user!.id,
        parentTaskId: closedTask?.id || null,
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);
      if (closedTask) io.to(`workspace:${req.user!.workspaceId}`).emit('task:updated', closedTask);
      io.to(`workspace:${req.user!.workspaceId}`).emit('task:new', followupTask);
    }

    res.status(201).json({ message, closedTask, followupTask, sentVia: sendResult.via });
  } catch (e) { next(e); }
});

// GET /api/auto-task/open-tasks?contactId=X
router.get('/open-tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const contactId = String(req.query.contactId || '');
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    const tasks = await prisma.task.findMany({
      where: {
        contactId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      orderBy: { dueAt: 'asc' },
      take: 20,
      select: { id: true, title: true, dueAt: true, status: true },
    });
    res.json({ tasks });
  } catch (e) { next(e); }
});

// GET /api/auto-task/preview?typeKey=X&customTypeLabel=Y&subject=Z&dueDate=DD/MM
// Devolve preview renderizado sem enviar nada. Util para o modal mostrar
// ao user o que vai ser enviado usando a config actual.
router.get('/preview', async (req: AuthRequest, res: Response, next) => {
  try {
    const mode = String(req.query.mode || 'announce');
    const config = await getConfig(req.user!.workspaceId);
    const workType = req.query.typeKey ? config.workTypes.find((t) => t.key === req.query.typeKey) : null;
    const effectiveTipo = req.query.customTypeLabel && workType?.key === 'outros'
      ? String(req.query.customTypeLabel).trim()
      : (workType?.label || '');
    const vars = {
      nome: String(req.query.nome || 'Nome'),
      assunto: String(req.query.subject || ''),
      tipo: effectiveTipo,
      artigo: workType?.article || '',
      possessivo: workType?.possessive || '',
      data: String(req.query.dueDate || ''),
    };
    const message = renderTemplate(
      mode === 'deliver' ? config.deliverTemplate : config.announceTemplate,
      vars,
    );
    const taskTitle = renderTemplate(
      mode === 'deliver' ? config.followupTitleTemplate : config.announceTaskTitleTemplate,
      vars,
    );
    res.json({ message, taskTitle });
  } catch (e) { next(e); }
});

export default router;
