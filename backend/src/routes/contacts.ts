import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { triggerAutomations } from '../lib/automationEngine';
import { propagateAssignee } from '../lib/propagateAssignee';
import { notifyWhatsAppAssignment } from '../lib/dailyTaskDigest';
import prisma from '../lib/prisma';
import { checkLimit } from '../lib/planLimits';
const router = Router();

// Tenta activar a extensão `unaccent` na BD para permitir pesquisas que ignorem
// acentuação. É idempotente — só corre uma vez por arranque do servidor.
let unaccentReady: boolean | null = null;
async function ensureUnaccent(): Promise<boolean> {
  if (unaccentReady !== null) return unaccentReady;
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    unaccentReady = true;
  } catch (e: any) {
    console.error('Failed to enable unaccent extension:', e.message);
    unaccentReady = false;
  }
  return unaccentReady;
}
// Tentar logo no arranque
ensureUnaccent().catch(() => {});

const contactInclude = {
  tags: { include: { tag: true } },
  customValues: { include: { field: true } },
  assignedTo: { select: { id: true, name: true, avatar: true } },
  _count: { select: { leads: true } },
};

// GET /api/contacts
// Filtro de responsável considera 3 origens:
//   1) Contact.assignedToId (atribuído directamente na ficha do contacto)
//   2) ConversationMeta.assignedToId (atribuído na Caixa de Entrada, por canal)
//   3) Lead.assignedToId (atribuído num lead deste contacto)
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { search, type, tagId, assignedToId, page = 1, limit = 50 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const workspaceId = req.user!.workspaceId;
    const andFilters: any[] = [{ workspaceId }];
    if (type) andFilters.push({ type });
    if (tagId) andFilters.push({ tags: { some: { tagId: tagId as string } } });

    if (assignedToId === '__none__') {
      // Nenhuma das 3 origens atribuída
      andFilters.push({
        assignedToId: null,
        conversationMetas: { none: { assignedToId: { not: null } } },
        leads: { none: { assignedToId: { not: null } } },
      });
    } else if (assignedToId) {
      andFilters.push({
        OR: [
          { assignedToId: assignedToId as string },
          { conversationMetas: { some: { assignedToId: assignedToId as string } } },
          { leads: { some: { assignedToId: assignedToId as string } } },
        ],
      });
    }

    if (search) {
      const trimmed = (search as string).trim();
      const digits = trimmed.replace(/\D/g, '');
      const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);

      // Estratégia 1: usar extensão `unaccent` para ignorar acentos
      // ("Joao" apanha "João"). Devolve IDs que batem; depois filtramos por AND.
      const useUnaccent = await ensureUnaccent();
      let unaccentIds: string[] | null = null;
      if (useUnaccent) {
        try {
          const pat = `%${trimmed}%`;
          const digitsPat = digits.length >= 3 ? `%${digits}%` : '___NEVER_MATCH___';
          const rows: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM contacts
             WHERE "workspaceId" = $1
             AND (
               unaccent(COALESCE("firstName", '')) ILIKE unaccent($2)
               OR unaccent(COALESCE("lastName", '')) ILIKE unaccent($2)
               OR unaccent(COALESCE(CONCAT_WS(' ', "firstName", "lastName"), '')) ILIKE unaccent($2)
               OR unaccent(COALESCE("email", '')) ILIKE unaccent($2)
               OR unaccent(COALESCE("company", '')) ILIKE unaccent($2)
               OR COALESCE("phone", '') ILIKE $2
               OR COALESCE("whatsapp", '') ILIKE $2
               OR REGEXP_REPLACE(COALESCE("phone", ''), '[^0-9]', '', 'g') ILIKE $3
               OR REGEXP_REPLACE(COALESCE("whatsapp", ''), '[^0-9]', '', 'g') ILIKE $3
             )
             LIMIT 2000`,
            workspaceId, pat, digitsPat,
          );
          unaccentIds = rows.map((r: any) => r.id);
        } catch (e: any) {
          console.error('unaccent search failed:', e.message);
        }
      }

      if (unaccentIds !== null) {
        // Filtragem foi feita via SQL raw — adicionar restricão por IDs
        if (unaccentIds.length === 0) {
          // Nenhum match; devolver vazio sem fazer findMany
          res.json({ contacts: [], total: 0 });
          return;
        }
        andFilters.push({ id: { in: unaccentIds } });
      } else {
        // Fallback (sem unaccent): pesquisa Prisma com tokens
        const searchOr: any[] = [
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
          { email: { contains: trimmed, mode: 'insensitive' } },
          { company: { contains: trimmed, mode: 'insensitive' } },
          { phone: { contains: trimmed, mode: 'insensitive' } },
          { whatsapp: { contains: trimmed, mode: 'insensitive' } },
        ];
        if (digits.length >= 3) {
          searchOr.push({ whatsapp: { contains: digits } });
          searchOr.push({ phone: { contains: digits } });
        }
        if (tokens.length > 1) {
          searchOr.push({
            AND: tokens.map((tok) => ({
              OR: [
                { firstName: { contains: tok, mode: 'insensitive' } },
                { lastName: { contains: tok, mode: 'insensitive' } },
                { company: { contains: tok, mode: 'insensitive' } },
              ],
            })),
          });
        }
        andFilters.push({ OR: searchOr });
      }
    }

    const where = { AND: andFilters };
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where, skip, take: Number(limit),
        orderBy: { firstName: 'asc' },
        include: contactInclude,
      }),
      prisma.contact.count({ where }),
    ]);
    res.json({ contacts, total });
  } catch (e) { next(e); }
});

// GET /api/contacts/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
      include: {
        tags: { include: { tag: true } },
        customValues: { include: { field: true } },
        leads: { include: { stage: true, pipeline: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!contact) throw new AppError('Contacto não encontrado', 404);
    res.json(contact);
  } catch (e) { next(e); }
});

// POST /api/contacts
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    await checkLimit(req.user!.workspaceId, 'contacts');
    const { tags, customValues, ...rest } = req.body;
    const cleanCV = Array.isArray(customValues)
      ? customValues
          .filter((cv: any) => cv && cv.fieldId && cv.value !== undefined && cv.value !== null && cv.value !== '')
          .map((cv: any) => ({ fieldId: cv.fieldId, value: String(cv.value) }))
      : [];
    const contact = await prisma.contact.create({
      data: {
        ...rest,
        workspaceId: req.user!.workspaceId,
        tags: Array.isArray(tags) && tags.length
          ? { create: tags.map((tagId: string) => ({ tagId })) }
          : undefined,
        customValues: cleanCV.length ? { create: cleanCV } : undefined,
      },
      include: contactInclude,
    });
    triggerAutomations({ type: 'contact_created', workspaceId: req.user!.workspaceId, entityType: 'contact', entityId: contact.id }).catch(() => {});
    res.status(201).json(contact);
  } catch (e) { next(e); }
});

// POST /api/contacts/bulk - importar lista (com deduplicação)
// Se já existir contacto com o mesmo whatsapp, phone OU email no workspace,
// faz UPDATE em vez de duplicar. Campos não-vazios da entrada sobrepoem-se;
// campos vazios na entrada não apagam o que já existia.
router.post('/bulk', async (req: AuthRequest, res: Response, next) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new AppError('Lista de contactos vazia', 400);
    }
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    const workspaceId = req.user!.workspaceId;

    const norm = (v: any) => (v === undefined || v === null) ? null : String(v).trim() || null;
    const onlyDigits = (v: any) => norm(v)?.replace(/\D/g, '') || null;

    for (const c of contacts) {
      const firstName = norm(c.firstName);
      if (!firstName) { skipped++; continue; }

      // Normalizar phone/whatsapp para procurar (só dígitos)
      const whatsappDigits = onlyDigits(c.whatsapp) || onlyDigits(c.phone);
      const phoneDigits = onlyDigits(c.phone) || whatsappDigits;
      const email = norm(c.email)?.toLowerCase() || null;

      try {
        // Tentar encontrar existente
        const orFilters: any[] = [];
        if (whatsappDigits) orFilters.push({ whatsapp: whatsappDigits });
        if (phoneDigits && phoneDigits !== whatsappDigits) orFilters.push({ phone: { contains: phoneDigits } });
        if (email) orFilters.push({ email });
        const existing = orFilters.length
          ? await prisma.contact.findFirst({ where: { workspaceId, OR: orFilters } })
          : null;

        const fields: any = {
          type: c.type === 'COMPANY' ? 'COMPANY' : 'PERSON',
          firstName,
          lastName: norm(c.lastName),
          email,
          phone: norm(c.phone),
          whatsapp: whatsappDigits,
          company: norm(c.company),
          position: norm(c.position),
          website: norm(c.website),
          address: norm(c.address),
          city: norm(c.city),
          country: norm(c.country),
          notes: norm(c.notes),
        };

        if (existing) {
          // Merge: só sobrepoe se a entrada nova tiver valor não-vazio
          const updates: any = {};
          for (const [k, v] of Object.entries(fields)) {
            if (v !== null && v !== '' && v !== undefined) updates[k] = v;
          }
          // Se o firstName actual parece placeholder (número/Contacto WhatsApp), sobrepor sempre
          const looksLikePlaceholder =
            !existing.firstName ||
            /^\+?\d[\d\s]*$/.test(existing.firstName) ||
            existing.firstName === 'Contacto WhatsApp';
          if (!looksLikePlaceholder && fields.firstName === existing.firstName) {
            delete updates.firstName;
          }
          await prisma.contact.update({ where: { id: existing.id }, data: updates });
          updated++;
        } else {
          await prisma.contact.create({ data: { ...fields, workspaceId } });
          created++;
        }
      } catch (e: any) {
        skipped++;
        if (errors.length < 5) errors.push(`Linha ${created + updated + skipped}: ${e.message}`);
      }
    }
    res.status(201).json({ created, updated, skipped, total: contacts.length, errors });
  } catch (e) { next(e); }
});

// PATCH /api/contacts/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tags, customValues, ...rest } = req.body;

    // Substituir tags se enviadas
    if (Array.isArray(tags)) {
      await prisma.tagOnContact.deleteMany({ where: { contactId: req.params.id } });
      if (tags.length) {
        await prisma.tagOnContact.createMany({
          data: tags.map((tagId: string) => ({ contactId: req.params.id, tagId })),
        });
      }
    }

    // Substituir custom values se enviados
    if (Array.isArray(customValues)) {
      await prisma.customFieldValue.deleteMany({ where: { contactId: req.params.id } });
      const clean = customValues
        .filter((cv: any) => cv && cv.fieldId && cv.value !== undefined && cv.value !== null && cv.value !== '')
        .map((cv: any) => ({ fieldId: cv.fieldId, value: String(cv.value), contactId: req.params.id }));
      if (clean.length) {
        await prisma.customFieldValue.createMany({ data: clean });
      }
    }

    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: rest,
      include: contactInclude,
    });

    // Propagar responsável para conversas + leads se a chamada inclui assignedToId
    if (rest.assignedToId !== undefined) {
      await propagateAssignee(req.user!.workspaceId, contact.id, rest.assignedToId || null, 'contact');
      if (rest.assignedToId) {
        notifyWhatsAppAssignment(req.user!.workspaceId, rest.assignedToId, 'contact', contact.id).catch(() => {});
      }
    }

    res.json(contact);
  } catch (e) { next(e); }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.json({ message: 'Contacto eliminado' });
  } catch (e) { next(e); }
});

// POST /api/contacts/bulk-delete
router.post('/bulk-delete', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw new AppError('Lista vazia', 400);
    const result = await prisma.contact.deleteMany({
      where: { id: { in: ids }, workspaceId: req.user!.workspaceId },
    });
    res.json({ deleted: result.count });
  } catch (e) { next(e); }
});

// POST /api/contacts/:id/tags - adicionar tag
router.post('/:id/tags', async (req: AuthRequest, res: Response, next) => {
  try {
    const { tagId } = req.body;
    if (!tagId) throw new AppError('tagId obrigatorio', 400);
    await prisma.tagOnContact.create({ data: { contactId: req.params.id, tagId } }).catch(() => {});
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: contactInclude,
    });
    res.json(contact);
  } catch (e) { next(e); }
});

// DELETE /api/contacts/:id/tags/:tagId - remover tag
router.delete('/:id/tags/:tagId', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.tagOnContact.deleteMany({
      where: { contactId: req.params.id, tagId: req.params.tagId },
    });
    res.json({ message: 'Tag removida' });
  } catch (e) { next(e); }
});

// POST /api/contacts/bulk-tag - atribuir tag a varios
router.post('/bulk-tag', async (req: AuthRequest, res: Response, next) => {
  try {
    const { ids, tagId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !tagId) throw new AppError('ids e tagId obrigatorios', 400);
    let added = 0;
    for (const id of ids) {
      try {
        await prisma.tagOnContact.create({ data: { contactId: id, tagId } });
        added++;
      } catch {
        // ja existe ou contacto nao existe
      }
    }
    res.json({ added });
  } catch (e) { next(e); }
});

export default router;
