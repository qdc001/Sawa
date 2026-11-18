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

import path from 'path';
import fs from 'fs';
import { Router, Response, NextFunction } from 'express';
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

// Avisa os ecras abertos sempre que uma tarefa muda (criar, editar, concluir, reatribuir, apagar),
// para a lista de tarefas aparecer sem ser preciso actualizar a pagina.
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user) req.app.get('io')?.to(`workspace:${req.user.workspaceId}`).emit('task:changed', {});
    });
  }
  next();
});

function requireAdmin(req: AuthRequest) {
  if (!['OWNER', 'ADMIN'].includes(req.user!.role)) {
    throw new AppError('Apenas administradores podem editar a configuração', 403);
  }
}

// Converte DD/MM ou DD/MM/YYYY em Date que representa 23:59:59 no fuso
// horario dado. Ex: "04/07" em Africa/Maputo (UTC+2) devolve o instante
// UTC que corresponde a 04/07 23:59 em Maputo (ou seja, 04/07 21:59 UTC).
function ddmmToDate(ddmm: string, timezone: string): Date | null {
  const m = ddmm.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;

  // Truque: cria a data como se 23:59 fosse UTC. Depois compara como esse
  // instante e formatado no timezone alvo vs em UTC para descobrir o offset
  // e ajusta.
  const naive = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  try {
    const tzStr = naive.toLocaleString('en-US', { timeZone: timezone });
    const utcStr = naive.toLocaleString('en-US', { timeZone: 'UTC' });
    const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
    const adjusted = new Date(naive.getTime() + offsetMs);
    if (isNaN(adjusted.getTime())) return null;
    // Auto-avanca para o proximo ano se a data ficou no passado
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (adjusted < yesterday && !m[3]) {
      return ddmmToDate(`${m[1]}/${m[2]}/${year + 1}`, timezone);
    }
    return adjusted;
  } catch {
    // Timezone invalido: cai para local
    const d = new Date(year, month, day, 23, 59, 59, 999);
    return isNaN(d.getTime()) ? null : d;
  }
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

// Encontra o subject config com match case-insensitive por label.
// Se nao encontrar (texto livre em "Outros"), devolve defaults 'a'/'tua'.
function lookupSubject(config: AutoTaskConfig, subjectLabel: string): { artigo: string; possessivo: string } {
  const s = config.subjects.find((x) => x.label.trim().toLowerCase() === subjectLabel.trim().toLowerCase());
  return { artigo: s?.article || 'a', possessivo: s?.possessive || 'tua' };
}

// POST /api/auto-task/announce
// Body: { contactId, subject, typeKey?, customTypeLabel?, dueDate (DD/MM), leadId? }
router.post('/announce', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contactId, subject, typeKey, customTypeLabel, dueDate, leadId, updateTaskId } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatório', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatório', 400);
    if (!dueDate) throw new AppError('Data obrigatória (formato DD/MM)', 400);

    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { timezone: true },
    });
    const tz = workspace?.timezone || 'Africa/Maputo';

    const parsedDate = ddmmToDate(String(dueDate).trim(), tz);
    if (!parsedDate) throw new AppError('Data inválida. Usa DD/MM ou DD/MM/YYYY', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto não encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem número de WhatsApp', 400);

    // Regra: 1 tarefa aberta por contacto. Se updateTaskId veio (o utilizador
    // escolheu "Actualizar existente" no dialog de conflito) reaproveitamos
    // essa tarefa. Caso contrario, se ja existe alguma aberta, 409.
    const openExisting = await prisma.task.findFirst({
      where: {
        contactId,
        parentTaskId: null,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (openExisting && (!updateTaskId || updateTaskId !== openExisting.id)) {
      return res.status(409).json({
        message: 'Este contacto já tem uma tarefa aberta. Conclui-a antes de criar outra.',
        existingTask: openExisting,
      });
    }

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
    const subjectMeta = lookupSubject(config, subj);

    const messageContent = renderTemplate(config.announceTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
      data: dateDDMM,
      artigoAssunto: subjectMeta.artigo,
      possAssunto: subjectMeta.possessivo,
    });
    const taskTitle = renderTemplate(config.announceTaskTitleTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
      artigoAssunto: subjectMeta.artigo,
      possAssunto: subjectMeta.possessivo,
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

    // 3. Criar tarefa OU actualizar a existente (updateTaskId).
    let task;
    let taskWasUpdated = false;
    if (updateTaskId && openExisting && openExisting.id === updateTaskId) {
      task = await prisma.task.update({
        where: { id: updateTaskId },
        data: {
          title: taskTitle,
          description: messageContent,
          dueAt: parsedDate,
          status: 'PENDING',
        },
      });
      taskWasUpdated = true;
      console.log('[announce] tarefa existente actualizada', task.id);
    } else {
      task = await prisma.task.create({
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
      console.log('[announce] tarefa criada', task.id);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);
      io.to(`workspace:${req.user!.workspaceId}`).emit(taskWasUpdated ? 'task:updated' : 'task:new', task);
    }

    res.status(201).json({ message, task, taskWasUpdated, sentVia: sendResult.via });
  } catch (e) { next(e); }
});

// POST /api/auto-task/deliver
// Body: { contactId, subject, typeKey?, customTypeLabel?, taskToCompleteId?, leadId?, attachmentUrl?, attachmentName? }
// Envio da entrega (ficheiro + mensagem + fechar tarefa + follow-up). Usado pelo envio imediato e pelos agendados.
// Devolve { conflict } se o contacto tem outra tarefa aberta que nao vai ser fechada.
export async function performDeliver(workspaceId: string, userId: string, body: any, io: any): Promise<any> {
    const { contactId, subject, typeKey, customTypeLabel, taskToCompleteId, leadId, attachmentUrl, attachmentName, updateTaskId } = body || {};
    console.log('[deliver] recebido', { contactId: !!contactId, subject, taskToCompleteId, updateTaskId, hasAttachment: !!attachmentUrl });
    if (!contactId) throw new AppError('contactId obrigatório', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatório', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: workspaceId },
    });
    if (!contact) throw new AppError('Contacto não encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem número de WhatsApp', 400);

    // Regra: 1 tarefa aberta por contacto. O /deliver fecha a antiga (taskToCompleteId)
    // e cria um follow-up. Se ha alguma outra tarefa aberta que nao seja a que se vai
    // fechar, recusar para nao ficar com duas.
    const openTasks = await prisma.task.findMany({
      where: {
        contactId,
        parentTaskId: null,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatar: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    // Se o utilizador escolheu "Actualizar existente" no dialog de conflito,
    // reaproveitamos essa tarefa como follow-up (em vez de criar nova).
    const stillOpen = openTasks.filter((t) => t.id !== taskToCompleteId && t.id !== updateTaskId);
    if (stillOpen.length > 0) {
      return { conflict: {
        message: `Este contacto já tem uma tarefa aberta ("${stillOpen[0].title}") que não vai ser fechada. Conclui-a antes.`,
        existingTask: stillOpen[0],
      } };
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    const tz = workspace?.timezone || 'Africa/Maputo';

    const config = await getConfig(workspaceId);
    const workType = typeKey ? config.workTypes.find((t) => t.key === typeKey) : null;
    const effectiveTipo = customTypeLabel && workType?.key === 'outros'
      ? customTypeLabel.trim()
      : (workType?.label || '');
    const artigo = workType?.article || '';
    const possessivo = workType?.possessive || '';
    const contactName = contact.firstName || 'cliente';
    const subj = subject.trim();
    const subjectMeta = lookupSubject(config, subj);

    const messageContent = renderTemplate(config.deliverTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
      artigoAssunto: subjectMeta.artigo,
      possAssunto: subjectMeta.possessivo,
    });
    const followupTitle = renderTemplate(config.followupTitleTemplate, {
      nome: contactName,
      assunto: subj,
      tipo: effectiveTipo,
      artigo,
      possessivo,
      artigoAssunto: subjectMeta.artigo,
      possAssunto: subjectMeta.possessivo,
    });

    // 1. Enviar. Se ha anexo: PRIMEIRO o ficheiro (sem caption), DEPOIS
    // a mensagem de texto em separado. Assim o destinatario ve o
    // documento como bloco distinto e a explicacao por baixo.
    const messages: any[] = [];
    if (attachmentUrl) {
      const fileResult = await sendWhatsAppOut(
        workspaceId,
        phone,
        '',
        'DOCUMENT',
        attachmentUrl,
        attachmentName,
      );
      if (!fileResult.ok) {
        throw new AppError(`Falha a enviar ficheiro: ${fileResult.error || 'desconhecido'}`, 502);
      }
      const fileMsg = await prisma.message.create({
        data: {
          content: attachmentName || 'Anexo',
          type: 'DOCUMENT',
          direction: 'OUTBOUND',
          channel: 'WHATSAPP',
          status: 'SENT',
          externalId: fileResult.externalId,
          contactId: contact.id,
          leadId: leadId || null,
          sentById: userId,
          mediaUrl: attachmentUrl,
        },
      });
      messages.push(fileMsg);
    }

    const textResult = await sendWhatsAppOut(workspaceId, phone, messageContent, 'TEXT');
    if (!textResult.ok) {
      throw new AppError(`Falha a enviar mensagem: ${textResult.error || 'desconhecido'}`, 502);
    }
    const textMsg = await prisma.message.create({
      data: {
        content: messageContent,
        type: 'TEXT',
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: 'SENT',
        externalId: textResult.externalId,
        contactId: contact.id,
        leadId: leadId || null,
        sentById: userId,
      },
    });
    messages.push(textMsg);

    // Alias para compatibilidade com codigo antigo do frontend que espera .message
    const message = textMsg;
    const sendResult = textResult;

    let closedTask = null;
    if (taskToCompleteId) {
      try {
        closedTask = await prisma.task.update({
          where: { id: taskToCompleteId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        console.log('[deliver] tarefa fechada', taskToCompleteId);
      } catch (err: any) {
        console.error('[deliver] falha a fechar tarefa', taskToCompleteId, err.message);
      }
    } else {
      console.warn('[deliver] taskToCompleteId ausente — nao vai fechar nada');
    }

    // Data do follow-up em fuso do workspace: hoje + N dias, 23:59 local
    const followupDaysN = config.followupDays || 3;
    const now = new Date();
    const nowTzStr = now.toLocaleString('en-US', { timeZone: tz });
    const nowTz = new Date(nowTzStr);
    const followupNaive = new Date(Date.UTC(
      nowTz.getFullYear(),
      nowTz.getMonth(),
      nowTz.getDate() + followupDaysN,
      23, 59, 59, 999,
    ));
    const followupTzStr = followupNaive.toLocaleString('en-US', { timeZone: tz });
    const followupUtcStr = followupNaive.toLocaleString('en-US', { timeZone: 'UTC' });
    const followupOffsetMs = new Date(followupUtcStr).getTime() - new Date(followupTzStr).getTime();
    const followupDue = new Date(followupNaive.getTime() + followupOffsetMs);

    let followupTask;
    let followupWasUpdated = false;
    if (updateTaskId && openTasks.some((t) => t.id === updateTaskId)) {
      followupTask = await prisma.task.update({
        where: { id: updateTaskId },
        data: {
          title: followupTitle,
          description: `Follow-up: confirmar se ${contactName} recebeu e analisou o material enviado.`,
          dueAt: followupDue,
          status: 'PENDING',
        },
      });
      followupWasUpdated = true;
      console.log('[deliver] tarefa existente actualizada como follow-up', followupTask.id);
    } else {
      followupTask = await prisma.task.create({
        data: {
          title: followupTitle,
          description: `Follow-up: confirmar se ${contactName} recebeu e analisou o material enviado.`,
          type: 'FOLLOW_UP',
          status: 'PENDING',
          priority: 'MEDIUM',
          dueAt: followupDue,
          contactId: contact.id,
          leadId: leadId || null,
          assignedToId: userId,
          parentTaskId: closedTask?.id || null,
        },
      });
      console.log('[deliver] followup criado', followupTask.id, 'title=', followupTitle);
    }

    if (io) {
      for (const m of messages) {
        io.to(`workspace:${workspaceId}`).emit('message:new', m);
      }
      if (closedTask) io.to(`workspace:${workspaceId}`).emit('task:updated', closedTask);
      io.to(`workspace:${workspaceId}`).emit(followupWasUpdated ? 'task:updated' : 'task:new', followupTask);
    }

    return { message, messages, closedTask, followupTask, followupWasUpdated, sentVia: sendResult.via };
}

// POST /api/auto-task/deliver
// Body: { contactId, subject, typeKey?, customTypeLabel?, taskToCompleteId?, leadId?, attachmentUrl?, attachmentName?, scheduleAt? }
// Com scheduleAt (data/hora ISO) nao envia agora: fica agendado e o servidor envia a essa hora.
router.post('/deliver', async (req: AuthRequest, res: Response, next) => {
  try {
    const b = req.body || {};
    if (b.scheduleAt) {
      const sched: any = await scheduleDeliver(req, b);
      if (sched.conflict) return res.status(409).json(sched.conflict);
      return res.status(201).json({ scheduled: sched });
    }
    const r = await performDeliver(req.user!.workspaceId, req.user!.id, b, req.app.get('io'));
    if (r.conflict) return res.status(409).json(r.conflict);
    res.status(201).json(r);
  } catch (e) { next(e); }
});

// ---------- Entregas agendadas ----------
const MAX_SCHEDULE_DAYS = 60;

async function scheduleDeliver(req: AuthRequest, b: any) {
  const workspaceId = req.user!.workspaceId;
  const runAt = new Date(String(b.scheduleAt));
  if (isNaN(runAt.getTime())) throw new AppError('Data/hora do envio inválida', 400);
  if (runAt.getTime() < Date.now() + 60_000) throw new AppError('Escolhe uma hora no futuro (pelo menos daqui a 1 minuto)', 400);
  if (runAt.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86400_000) throw new AppError(`Só se pode agendar até ${MAX_SCHEDULE_DAYS} dias`, 400);
  if (!b.contactId) throw new AppError('contactId obrigatório', 400);
  if (!b.subject || typeof b.subject !== 'string' || !b.subject.trim()) throw new AppError('Assunto obrigatório', 400);
  if (b.attachmentUrl && !/^\/uploads\/[^/]+$/.test(String(b.attachmentUrl))) throw new AppError('Anexo inválido', 400);
  const contact = await prisma.contact.findFirst({ where: { id: String(b.contactId), workspaceId } });
  if (!contact) throw new AppError('Contacto não encontrado', 404);
  if (!(contact.whatsapp || contact.phone)) throw new AppError('Contacto sem número de WhatsApp', 400);
  // O mesmo controlo do envio: outra tarefa aberta que nao vai ser fechada resolve-se ja, nao a hora do envio.
  const stillOpen = await prisma.task.findFirst({
    where: {
      contactId: contact.id, parentTaskId: null, status: { in: ['PENDING', 'IN_PROGRESS'] },
      id: { notIn: [b.taskToCompleteId, b.updateTaskId].filter(Boolean).map(String) },
    },
    include: { assignedTo: { select: { id: true, name: true, avatar: true } }, contact: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (stillOpen) {
    return { conflict: { message: `Este contacto já tem uma tarefa aberta ("${stillOpen.title}") que não vai ser fechada. Conclui-a antes.`, existingTask: stillOpen } };
  }
  const payload = {
    contactId: contact.id, subject: b.subject.trim(), typeKey: b.typeKey || null, customTypeLabel: b.customTypeLabel || null,
    taskToCompleteId: b.taskToCompleteId || null, leadId: b.leadId || null, updateTaskId: b.updateTaskId || null,
    attachmentUrl: b.attachmentUrl || null, attachmentName: b.attachmentName || null,
  };
  return prisma.scheduledDelivery.create({
    data: { workspaceId, createdById: req.user!.id, contactId: contact.id, contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '), payload, runAt },
  });
}

// GET /api/auto-task/scheduled?contactId=X -> agendados deste contacto (por enviar e falhados recentes)
router.get('/scheduled', async (req: AuthRequest, res: Response, next) => {
  try {
    const where: any = { workspaceId: req.user!.workspaceId };
    if (req.query.contactId) where.contactId = String(req.query.contactId);
    where.OR = [{ status: { in: ['PENDING', 'RUNNING'] } }, { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }];
    res.json(await prisma.scheduledDelivery.findMany({ where, orderBy: { runAt: 'asc' }, take: 50 }));
  } catch (e) { next(e); }
});

// DELETE /api/auto-task/scheduled/:id -> cancela (so por enviar; quem agendou ou administrador)
router.delete('/scheduled/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const d = await prisma.scheduledDelivery.findFirst({ where: { id: req.params.id, workspaceId: req.user!.workspaceId } });
    if (!d) throw new AppError('Envio agendado não encontrado', 404);
    if (d.createdById !== req.user!.id && !['OWNER', 'ADMIN'].includes(req.user!.role)) throw new AppError('Só quem agendou (ou um administrador) pode cancelar', 403);
    const r = await prisma.scheduledDelivery.updateMany({ where: { id: d.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (!r.count) throw new AppError('Este envio já não está por enviar', 409);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

async function notifyUser(userId: string, title: string, body: string, contactId: string) {
  await prisma.notification.create({ data: { userId, title, body, type: 'scheduled_delivery', link: `/inbox?contactId=${contactId}` } }).catch(() => {});
  const io = (global as any).io;
  if (io) io.to(`user:${userId}`).emit('notification:new', { type: 'scheduled_delivery' });
}

// Corre de minuto a minuto: envia o que ja chegou a hora.
export async function runScheduledDeliveries() {
  // Um envio que ficou a meio (o servidor reiniciou) nao se repete sozinho: fica falhado para nao enviar duas vezes.
  await prisma.scheduledDelivery.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: 'FAILED', error: 'O envio foi interrompido (o servidor reiniciou). Confirma na conversa se chegou e, se não, envia de novo.' },
  });
  const due = await prisma.scheduledDelivery.findMany({ where: { status: 'PENDING', runAt: { lte: new Date() } }, orderBy: { runAt: 'asc' }, take: 20 });
  for (const d of due) {
    const claimed = await prisma.scheduledDelivery.updateMany({ where: { id: d.id, status: 'PENDING' }, data: { status: 'RUNNING' } });
    if (!claimed.count) continue;
    const p: any = d.payload || {};
    const who = d.contactName || 'o contacto';
    try {
      if (p.attachmentUrl) {
        const file = path.join(__dirname, '../../uploads', path.basename(String(p.attachmentUrl)));
        if (!fs.existsSync(file)) throw new Error('O ficheiro anexado já não está no servidor. Anexa-o de novo e envia.');
      }
      const r = await performDeliver(d.workspaceId, d.createdById, p, (global as any).io);
      if (r.conflict) throw new Error(r.conflict.message);
      await prisma.scheduledDelivery.update({ where: { id: d.id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
      await notifyUser(d.createdById, `Entrega enviada a ${who}`, `O envio agendado de "${p.subject}" foi enviado.`, d.contactId);
    } catch (e: any) {
      const msg = String(e?.message || e || 'erro').slice(0, 500);
      await prisma.scheduledDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', error: msg } });
      await notifyUser(d.createdById, `Falhou o envio agendado a ${who}`, `"${p.subject}": ${msg}`, d.contactId);
    }
  }
}

// GET /api/auto-task/open-tasks?contactId=X
router.get('/open-tasks', async (req: AuthRequest, res: Response, next) => {
  try {
    const contactId = String(req.query.contactId || '');
    if (!contactId) throw new AppError('contactId obrigatório', 400);
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
    const subjText = String(req.query.subject || '');
    const subjectMeta = lookupSubject(config, subjText);
    const vars = {
      nome: String(req.query.nome || 'Nome'),
      assunto: subjText,
      tipo: effectiveTipo,
      artigo: workType?.article || '',
      possessivo: workType?.possessive || '',
      data: String(req.query.dueDate || ''),
      artigoAssunto: subjectMeta.artigo,
      possAssunto: subjectMeta.possessivo,
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
