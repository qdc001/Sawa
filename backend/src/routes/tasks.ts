import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { triggerAutomations } from '../lib/automationEngine';
import prisma from '../lib/prisma';
const router = Router();

const taskInclude = {
  assignedTo: { select: { id: true, name: true, avatar: true } },
  lead: { select: { id: true, title: true, pipelineId: true } },
  contact: { select: { id: true, firstName: true, lastName: true, phone: true, whatsapp: true, avatar: true } },
  subtasks: { orderBy: { createdAt: 'asc' as const } },
  tags: { include: { tag: true } },
};

router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { leadId, contactId, status, type, priority, assignedToId, dueFrom, dueTo, search, tagId, parentOnly } = req.query;
    const where: any = { assignedTo: { workspaceId: req.user!.workspaceId } };
    if (leadId) where.leadId = leadId;
    if (contactId) where.contactId = contactId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) where.title = { contains: search as string, mode: 'insensitive' };
    if (tagId) where.tags = { some: { tagId: tagId as string } };
    if (parentOnly === 'true') where.parentTaskId = null;
    // Visibilidade restrita
    if (req.user!.viewOnlyOwn && req.user!.role === 'AGENT') where.assignedToId = req.user!.id;
    if (dueFrom || dueTo) {
      where.dueAt = {};
      if (dueFrom) where.dueAt.gte = new Date(dueFrom as string);
      if (dueTo) where.dueAt.lte = new Date(dueTo as string);
    }
    const tasks = await prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: { dueAt: 'asc' },
    });
    res.json(tasks);
  } catch (e) { next(e); }
});

router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { title, description, type, status, priority, dueAt, leadId, contactId: rawContactId, assignedToId, recurrence, parentTaskId, tags, force } = req.body;

    // Associação primária ao CONTACTO. Se vier um leadId explícito ainda o preservamos
    // (compatibilidade com automações antigas), mas não auto-ligamos lead a partir de contacto
    // — tarefas devem ficar ligadas só ao contacto a partir desta versão.
    let finalLeadId: string | null = leadId || null;
    let finalContactId: string | null = rawContactId || null;
    if (finalLeadId && !finalContactId) {
      // Se só veio leadId, popular contactId (mantém legacy de criar tarefa a partir do lead)
      const lead = await prisma.lead.findUnique({ where: { id: finalLeadId }, select: { contactId: true } });
      if (lead?.contactId) finalContactId = lead.contactId;
    }

    // Verificar se já existe tarefa pendente (lead OU contact)
    if (!parentTaskId && !force && (finalLeadId || finalContactId)) {
      const orFilters: any[] = [];
      if (finalLeadId) orFilters.push({ leadId: finalLeadId });
      if (finalContactId) orFilters.push({ contactId: finalContactId });
      const existing = await prisma.task.findFirst({
        where: {
          parentTaskId: null,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          OR: orFilters,
        },
        include: taskInclude,
      });
      if (existing) {
        return res.status(409).json({
          message: 'Já existe uma tarefa pendente para este lead/contacto.',
          existingTask: existing,
          hint: 'Conclui a tarefa existente, ou envia force:true para criar mesmo assim.',
        });
      }
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        type: type || 'CALL',
        status: status || 'PENDING',
        priority: priority || 'MEDIUM',
        dueAt: dueAt ? new Date(dueAt) : null,
        leadId: finalLeadId,
        contactId: finalContactId,
        recurrence: recurrence || null,
        parentTaskId: parentTaskId || null,
        assignedToId: assignedToId || req.user!.id,
        tags: Array.isArray(tags) && tags.length
          ? { create: tags.map((tagId: string) => ({ tagId })) }
          : undefined,
      },
      include: taskInclude,
    });
    if (task.leadId && !parentTaskId) {
      await prisma.activity.create({
        data: { type: 'TASK_CREATED', description: `Tarefa "${task.title}" criada`, leadId: task.leadId, userId: req.user!.id },
      });
    }
    triggerAutomations({ type: 'task_created', workspaceId: req.user!.workspaceId, entityType: 'task', entityId: task.id }).catch(() => {});
    res.status(201).json(task);
  } catch (e) { next(e); }
});

// Helper: calcular próxima ocorrência
function nextDueDate(dueAt: Date, recurrence: string): Date {
  const d = new Date(dueAt);
  switch (recurrence) {
    case 'DAILY': d.setDate(d.getDate() + 1); break;
    case 'WEEKLY': d.setDate(d.getDate() + 7); break;
    case 'MONTHLY': d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tags, ...rest } = req.body;
    const data: any = { ...rest };
    if (data.dueAt) data.dueAt = new Date(data.dueAt);
    if (data.status === 'COMPLETED') data.completedAt = new Date();
    if (data.status && data.status !== 'COMPLETED') data.completedAt = null;

    if (Array.isArray(tags)) {
      await prisma.tagOnTask.deleteMany({ where: { taskId: req.params.id } });
      if (tags.length) {
        await prisma.tagOnTask.createMany({
          data: tags.map((tagId: string) => ({ taskId: req.params.id, tagId })),
        });
      }
    }

    const before = await prisma.task.findUnique({ where: { id: req.params.id } });
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data,
      include: taskInclude,
    });

    // Se concluiu uma tarefa recorrente, criar a próxima
    if (
      before && before.status !== 'COMPLETED' && task.status === 'COMPLETED' &&
      task.recurrence && task.dueAt && !task.parentTaskId
    ) {
      const nextDue = nextDueDate(task.dueAt, task.recurrence);
      await prisma.task.create({
        data: {
          title: task.title,
          description: task.description,
          type: task.type,
          status: 'PENDING',
          priority: task.priority,
          dueAt: nextDue,
          leadId: task.leadId,
          recurrence: task.recurrence,
          assignedToId: task.assignedToId,
        },
      });
    }

    if (req.body.status === 'COMPLETED' && task.leadId) {
      await prisma.activity.create({
        data: { type: 'TASK_COMPLETED', description: `Tarefa "${task.title}" concluída`, leadId: task.leadId, userId: req.user!.id },
      });
    }
    if (before && before.status !== 'COMPLETED' && task.status === 'COMPLETED') {
      triggerAutomations({ type: 'task_completed', workspaceId: req.user!.workspaceId, entityType: 'task', entityId: task.id }).catch(() => {});
    }
    res.json(task);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tarefa eliminada' });
  } catch (e) { next(e); }
});

// Bulk operations
router.post('/bulk-complete', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids vazio', 400);
    const result = await prisma.task.updateMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (e) { next(e); }
});

router.post('/bulk-delete', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('ids vazio', 400);
    const result = await prisma.task.deleteMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
    });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

router.post('/bulk-assign', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids, assignedToId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !assignedToId) throw new AppError('ids e assignedToId obrigatórios', 400);
    const result = await prisma.task.updateMany({
      where: { id: { in: ids }, assignedTo: { workspaceId: req.user!.workspaceId } },
      data: { assignedToId },
    });
    res.json({ updated: result.count });
  } catch (e) { next(e); }
});

// Tags
router.post('/:id/tags', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tagId } = req.body;
    if (!tagId) throw new AppError('tagId obrigatório', 400);
    await prisma.tagOnTask.create({ data: { taskId: req.params.id, tagId } }).catch(() => {});
    const task = await prisma.task.findUnique({ where: { id: req.params.id }, include: taskInclude });
    res.json(task);
  } catch (e) { next(e); }
});

router.delete('/:id/tags/:tagId', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.tagOnTask.deleteMany({ where: { taskId: req.params.id, tagId: req.params.tagId } });
    res.json({ message: 'Tag removida' });
  } catch (e) { next(e); }
});

// POST /api/tasks/bulk-import - importar lista de tarefas (ex: exportadas do Kommo)
// Aceita um array `tasks` com campos flexíveis. Faz match de lead/contact por nome,
// mapeia tipo/status/prioridade (PT e EN do Kommo), e usa o utilizador autenticado
// como assignedTo por defeito quando não há match.
router.post('/bulk-import', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new AppError('Lista de tarefas vazia', 400);
    }
    const workspaceId = req.user!.workspaceId;
    const fallbackUserId = req.user!.id;

    // Caches para reduzir consultas
    const usersByName = new Map<string, string>();
    const users = await prisma.user.findMany({ where: { workspaceId }, select: { id: true, name: true, email: true } });
    users.forEach((u) => {
      usersByName.set(u.name.toLowerCase(), u.id);
      if (u.email) usersByName.set(u.email.toLowerCase(), u.id);
    });

    const norm = (v: any) => (v === undefined || v === null) ? '' : String(v).trim();
    const mapType = (raw: string): any => {
      const v = raw.toLowerCase();
      if (/chamada|call|liga[cç][aã]o|phone/.test(v)) return 'CALL';
      if (/email|e-mail|mail/.test(v)) return 'EMAIL';
      if (/reuni[aã]o|meet|encontro/.test(v)) return 'MEETING';
      if (/follow|seguimento/.test(v)) return 'FOLLOW_UP';
      if (/demo|apresenta/.test(v)) return 'DEMO';
      return 'OTHER';
    };
    const mapStatus = (raw: string): any => {
      const v = raw.toLowerCase();
      if (/conclu[ií]da|complet|done|fechad|finaliz/.test(v)) return 'COMPLETED';
      if (/cancel/.test(v)) return 'CANCELLED';
      if (/progress|andamento|a fazer|in[_ ]?progress/.test(v)) return 'IN_PROGRESS';
      return 'PENDING';
    };
    const mapPriority = (raw: string): any => {
      const v = raw.toLowerCase();
      if (/urgent/.test(v)) return 'URGENT';
      if (/alta|high/.test(v)) return 'HIGH';
      if (/baixa|low/.test(v)) return 'LOW';
      return 'MEDIUM';
    };
    const parseDate = (raw: string): Date | null => {
      if (!raw) return null;
      const s = norm(raw);
      // ISO directo
      let d = new Date(s);
      if (!isNaN(d.getTime())) return d;
      // DD/MM/YYYY [HH:MM]
      const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
      if (m) {
        const [, dd, mm, yyyy, hh, mi] = m;
        const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
        d = new Date(year, Number(mm) - 1, Number(dd), Number(hh || 9), Number(mi || 0));
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const t of tasks) {
      try {
        const title = norm(t.title || t.text || t.Tarefa || t.descrição || t.Descrição || t.subject);
        if (!title) { skipped++; continue; }

        // Match de responsável
        const respRaw = norm(t.responsibleUser || t.responsible || t.Responsável || t.responsável || t.assignedTo);
        const assignedToId = (respRaw && usersByName.get(respRaw.toLowerCase())) || fallbackUserId;

        // Match de contacto (prioridade): 1) telefone exacto > 2) nome exacto > 3) nome parcial
        let contactId: string | null = null;
        const contactRaw = norm(t.contact || t.Contacto || t.contactName);
        const phoneRaw = norm(t.contactPhone || t.phone || t.Telefone).replace(/\D/g, '');

        // 1) Telefone (mantém o nome do CRM mesmo se diferente do nome importado)
        if (phoneRaw && phoneRaw.length >= 7) {
          const c = await prisma.contact.findFirst({ where: { workspaceId, OR: [{ whatsapp: phoneRaw }, { phone: { contains: phoneRaw } }] } });
          if (c) contactId = c.id;
        }

        // 2) Nome exacto (case-insensitive) em firstName, lastName ou firstName+lastName
        if (!contactId && contactRaw) {
          const all = await prisma.contact.findMany({
            where: { workspaceId },
            select: { id: true, firstName: true, lastName: true },
          });
          const target = contactRaw.toLowerCase();
          let match = all.find((c) => {
            const full = `${c.firstName || ''} ${c.lastName || ''}`.trim().toLowerCase();
            return full === target || (c.firstName || '').toLowerCase() === target;
          });
          // 3) Match parcial: target contém o firstName ou o firstName contém target
          if (!match) {
            match = all.find((c) => {
              const fn = (c.firstName || '').toLowerCase();
              if (!fn || fn.length < 3) return false;
              return target.includes(fn) || fn.includes(target);
            });
          }
          if (match) contactId = match.id;
        }

        // Match de lead por título
        let leadId: string | null = null;
        const leadRaw = norm(t.lead || t.Lead || t.leadTitle || t.deal);
        if (leadRaw) {
          const l = await prisma.lead.findFirst({ where: { workspaceId, title: { equals: leadRaw, mode: 'insensitive' } } });
          if (l) leadId = l.id;
        }
        // Se há contacto e nenhum lead explícito, tentar lead aberto desse contacto
        if (!leadId && contactId) {
          const l = await prisma.lead.findFirst({ where: { workspaceId, contactId, status: 'OPEN' } });
          if (l) leadId = l.id;
        }

        const description = norm(t.description || t.notes || t.Notas) || null;
        const taskType = mapType(norm(t.type || t.Tipo));
        const status = mapStatus(norm(t.status || t.Estado));
        const priority = mapPriority(norm(t.priority || t.Prioridade));
        const dueAt = parseDate(norm(t.dueAt || t.dueDate || t.completeTill || t['Complete till'] || t.deadline || t.data || t.Data));
        const completedAt = status === 'COMPLETED' ? parseDate(norm(t.completedAt || t.completed_at)) || new Date() : null;

        await prisma.task.create({
          data: {
            title,
            description,
            type: taskType,
            status,
            priority,
            dueAt,
            completedAt,
            assignedToId,
            leadId,
            contactId,
          },
        });
        created++;
      } catch (e: any) {
        skipped++;
        if (errors.length < 5) errors.push(`Linha ${created + skipped}: ${e.message}`);
      }
    }
    res.status(201).json({ created, skipped, total: tasks.length, errors });
  } catch (e) { next(e); }
});

export default router;
