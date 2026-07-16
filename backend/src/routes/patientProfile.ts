// Ficha consolidada do paciente. Devolve numa unica chamada tudo o que
// a recepcao/medico precisam ver antes de atender ou responder:
//   - Dados basicos e custom fields (destacando alergias/medicacao)
//   - Historico completo de consultas
//   - Ultimas mensagens
//   - Marcacoes futuras
//   - Tarefas abertas
//   - Sugestoes pendentes da Leizy
//
// A Leizy tambem pode consultar (usa aiPatientContext.ts em background).

import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/patient-profile/:contactId
router.get('/:contactId', async (req: AuthRequest, res: Response, next) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const contactId = req.params.contactId;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      include: {
        assignedTo: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    });
    if (!contact) throw new AppError('Paciente não encontrado', 404);

    const [cfValues, appointments, tasks, recentMessages, pendingLeizy, messageCount] = await Promise.all([
      // Custom fields com o valor
      prisma.customFieldValue.findMany({
        where: { contactId, field: { workspaceId, entity: 'contact' } },
        include: { field: { select: { key: true, name: true, type: true, position: true, options: true } } },
      }),
      // Todas as marcacoes (ordem desc por data)
      prisma.appointment.findMany({
        where: { workspaceId, contactId },
        orderBy: { startsAt: 'desc' },
        take: 50,
        include: {
          assignedTo: { select: { id: true, name: true, avatar: true } },
        },
      }),
      // Tarefas abertas
      prisma.task.findMany({
        where: {
          contactId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          assignedTo: { workspaceId },
        },
        include: { assignedTo: { select: { id: true, name: true } } },
        orderBy: { dueAt: 'asc' },
      }),
      // Ultimas 30 mensagens
      prisma.message.findMany({
        where: { contactId, contact: { workspaceId } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true, content: true, type: true, direction: true, channel: true,
          createdAt: true, status: true,
          sentBy: { select: { id: true, name: true } },
        },
      }),
      // Sugestoes pendentes da Leizy para este paciente
      prisma.aiSalesSuggestion.findMany({
        where: { workspaceId, contactId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, action: true, parts: true, reasoning: true,
          actionPayload: true, createdAt: true,
        },
      }),
      prisma.message.count({ where: { contactId, contact: { workspaceId } } }),
    ]);

    // Separar custom fields criticos dos informativos
    const CRITICAL = new Set(['allergies', 'medication', 'emergency_contact']);
    const critical: Array<{ key: string; name: string; value: string }> = [];
    const info: Array<{ key: string; name: string; value: string; type: string }> = [];
    for (const v of cfValues) {
      if (!v.value?.trim()) continue;
      const item = { key: v.field.key, name: v.field.name, value: v.value, type: v.field.type };
      if (CRITICAL.has(v.field.key)) {
        critical.push({ key: item.key, name: item.name, value: item.value });
      } else {
        info.push(item);
      }
    }

    // Idade calculada
    let age: number | null = null;
    const birth = cfValues.find((v) => v.field.key === 'birth_date');
    if (birth?.value) {
      const d = new Date(birth.value);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
      }
    }

    // Estatisticas
    const completedAppts = appointments.filter((a) => a.status === 'COMPLETED');
    const futureAppts = appointments.filter((a) => a.startsAt.getTime() > Date.now() && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED'));
    const noShows = appointments.filter((a) => a.status === 'NO_SHOW').length;
    const canceled = appointments.filter((a) => a.status === 'CANCELED').length;

    const daysSinceLast = completedAppts.length > 0
      ? Math.floor((Date.now() - completedAppts[0].startsAt.getTime()) / (24 * 3600_000))
      : null;

    res.json({
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        whatsapp: contact.whatsapp,
        avatar: contact.avatar,
        company: contact.company,
        city: contact.city,
        country: contact.country,
        notes: contact.notes,
        assignedTo: contact.assignedTo,
        tags: contact.tags.map((t: any) => t.tag),
        createdAt: contact.createdAt,
        age,
      },
      customFields: { critical, info },
      appointments: {
        all: appointments,
        stats: {
          total: appointments.length,
          completed: completedAppts.length,
          future: futureAppts.length,
          noShows,
          canceled,
          daysSinceLast,
        },
      },
      tasks,
      messages: {
        recent: recentMessages,
        total: messageCount,
      },
      leizySuggestions: pendingLeizy,
    });
  } catch (e) { next(e); }
});

export default router;
