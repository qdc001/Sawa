// Endpoints para envio de mensagem com criacao/actualizacao automatica de
// tarefa. Dois fluxos:
//
// 1) POST /api/auto-task/announce
//    "Vou enviar X do Y ate D" — envia mensagem WhatsApp + cria tarefa nova
//    com titulo "Enviar {assunto} do {tipo}" e dueAt = D 23:59.
//
// 2) POST /api/auto-task/deliver
//    "Envio em anexo X, pede feedback" — envia mensagem WhatsApp + fecha a
//    tarefa antiga (se indicada) + cria nova tarefa "Pedir feedback do X"
//    com dueAt = hoje + 3 dias.
//
// Ambos os endpoints reusam o pipeline normal de envio (chamada Evolution
// via sendWhatsAppOut) e criacao de tarefas via prisma directo. O contacto
// e o lead sao inferidos dos parametros.

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';
import { sendWhatsAppOut } from '../lib/whatsappSend';

const router = Router();

const VALID_TYPES = ['Dissertação', 'Monografia', 'Projecto', 'Slides', 'Outros'] as const;

function buildAnnounceMessage(name: string, subject: string, type: string | null, dateDDMM: string): string {
  const typeText = type ? ` do teu ${type.toLowerCase()}` : '';
  return `Olá ${name}, irei enviar o(a) ${subject}${typeText} até ${dateDDMM}.`;
}

function buildDeliverMessage(name: string, subject: string): string {
  return `Olá ${name}, envio em anexo o(a) ${subject}. Peço para analisar e depois deixar o teu feedback.`;
}

function buildTaskTitle(subject: string, type: string | null): string {
  if (type) return `Enviar ${subject} do ${type.toLowerCase()}`;
  return `Enviar ${subject}`;
}

function ddmmToDate(ddmm: string): Date | null {
  // Aceita DD/MM ou DD/MM/YYYY. Aplica hora 23:59:59 local.
  const m = ddmm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month, day, 23, 59, 59, 999);
  if (isNaN(d.getTime())) return null;
  // Se a data for no passado (mais de 1 dia atras), assume ano seguinte
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d < yesterday && !m[3]) {
    d.setFullYear(year + 1);
  }
  return d;
}

// POST /api/auto-task/announce
// Body: { contactId, subject, type?, dueDate (DD/MM ou DD/MM/YYYY), leadId? }
router.post('/announce', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, subject, type, dueDate, leadId } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatorio', 400);
    if (!dueDate || typeof dueDate !== 'string') throw new AppError('Data obrigatoria (formato DD/MM)', 400);
    const parsedDate = ddmmToDate(dueDate.trim());
    if (!parsedDate) throw new AppError('Data invalida. Usa DD/MM ou DD/MM/YYYY', 400);
    if (type && !VALID_TYPES.includes(type)) throw new AppError(`Tipo invalido. Usa: ${VALID_TYPES.join(', ')}`, 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp', 400);

    const contactName = contact.firstName || 'cliente';
    const subj = subject.trim();
    const typeStr = type && type !== 'Outros' ? type : null;
    const dateDDMM = `${String(parsedDate.getDate()).padStart(2, '0')}/${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
    const messageContent = buildAnnounceMessage(contactName, subj, typeStr, dateDDMM);
    const taskTitle = buildTaskTitle(subj, typeStr);

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

    // 3. Criar tarefa (sem check de "ja existe" para permitir varios envios seguidos)
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
// Body: { contactId, subject, taskToCompleteId?, leadId?, attachmentUrl?, attachmentName? }
router.post('/deliver', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, subject, taskToCompleteId, leadId, attachmentUrl, attachmentName } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatorio', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp', 400);

    const contactName = contact.firstName || 'cliente';
    const subj = subject.trim();
    const messageContent = buildDeliverMessage(contactName, subj);

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

    // 2. Persistir mensagem
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

    // 3. Fechar tarefa antiga se indicada
    let closedTask = null;
    if (taskToCompleteId) {
      try {
        closedTask = await prisma.task.update({
          where: { id: taskToCompleteId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      } catch { /* task pode ja estar fechada */ }
    }

    // 4. Criar tarefa de follow-up (pedir feedback) com data +3 dias
    const followupDue = new Date();
    followupDue.setDate(followupDue.getDate() + 3);
    followupDue.setHours(23, 59, 59, 999);

    const followupTask = await prisma.task.create({
      data: {
        title: `Pedir feedback do ${subj}`,
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
// Devolve tarefas abertas do contacto para o dropdown de "qual fechar".
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

export default router;
