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
    const { contactId, subject, typeKey, customTypeLabel, dueDate, leadId } = req.body || {};
    if (!contactId) throw new AppError('contactId obrigatorio', 400);
    if (!subject || typeof subject !== 'string' || !subject.trim()) throw new AppError('Assunto obrigatorio', 400);
    if (!dueDate) throw new AppError('Data obrigatoria (formato DD/MM)', 400);

    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { timezone: true },
    });
    const tz = workspace?.timezone || 'Africa/Maputo';

    const parsedDate = ddmmToDate(String(dueDate).trim(), tz);
    if (!parsedDate) throw new AppError('Data invalida. Usa DD/MM ou DD/MM/YYYY', 400);

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: req.user!.workspaceId },
    });
    if (!contact) throw new AppError('Contacto nao encontrado', 404);
    const phone = contact.whatsapp || contact.phone;
    if (!phone) throw new AppError('Contacto sem numero de WhatsApp', 400);

    // Regra: 1 tarefa aberta por contacto. Impede criar antes de fechar a existente.
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
    if (openExisting) {
      return res.status(409).json({
        message: 'Este contacto ja tem uma tarefa aberta. Conclui-a antes de criar outra.',
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
    const stillOpen = openTasks.filter((t) => t.id !== taskToCompleteId);
    if (stillOpen.length > 0) {
      return res.status(409).json({
        message: `Este contacto ja tem uma tarefa aberta ("${stillOpen[0].title}") que nao vai ser fechada. Conclui-a antes.`,
        existingTask: stillOpen[0],
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: req.user!.workspaceId },
      select: { timezone: true },
    });
    const tz = workspace?.timezone || 'Africa/Maputo';

    const config = await getConfig(req.user!.workspaceId);
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
        req.user!.workspaceId,
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
          sentById: req.user!.id,
          mediaUrl: attachmentUrl,
        },
      });
      messages.push(fileMsg);
    }

    const textResult = await sendWhatsAppOut(req.user!.workspaceId, phone, messageContent, 'TEXT');
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
        sentById: req.user!.id,
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
      } catch { /* pode ja estar fechada */ }
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
      for (const m of messages) {
        io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', m);
      }
      if (closedTask) io.to(`workspace:${req.user!.workspaceId}`).emit('task:updated', closedTask);
      io.to(`workspace:${req.user!.workspaceId}`).emit('task:new', followupTask);
    }

    res.status(201).json({ message, messages, closedTask, followupTask, sentVia: sendResult.via });
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
