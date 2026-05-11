import { Router, Response, Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';
import { runChatbotForMessage } from '../lib/chatbotEngine';
import { triggerAutomations } from '../lib/automationEngine';
import { notifyNewMessage } from '../lib/notify';

const router = Router();
const prisma = new PrismaClient();

// ============= Helpers Evolution =============
function evolutionUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
}

async function evolutionFetch(creds: any, path: string, init: any = {}): Promise<any> {
  if (!creds?.baseUrl || !creds?.apiKey) throw new AppError('Configuração Evolution incompleta (baseUrl + apiKey)', 400);
  const res = await fetch(evolutionUrl(creds.baseUrl, path), {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: creds.apiKey, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Erro ${res.status}`;
    throw new AppError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status === 401 ? 401 : 502);
  }
  return data;
}

// GET /api/integrations
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const integrations = await prisma.integration.findMany({
      where: { workspaceId: req.user!.workspaceId },
    });
    // ocultar tokens sensiveis nas listagens
    const safe = integrations.map((i) => ({
      ...i,
      credentials: i.credentials ? { configured: true } : null,
    }));
    res.json(safe);
  } catch (e) { next(e); }
});

// GET /api/integrations/:id
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { id: req.params.id, workspaceId: req.user!.workspaceId },
    });
    if (!integration) throw new AppError('Integracao nao encontrada', 404);
    res.json(integration);
  } catch (e) { next(e); }
});

// POST /api/integrations
router.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const { type, name, credentials, settings, isActive } = req.body;
    if (!type || !name) throw new AppError('Tipo e nome obrigatorios', 400);
    const integration = await prisma.integration.create({
      data: {
        type, name,
        credentials: credentials || {},
        settings: settings || {},
        isActive: isActive ?? true,
        workspaceId: req.user!.workspaceId,
      },
    });
    res.status(201).json(integration);
  } catch (e) { next(e); }
});

// PATCH /api/integrations/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const { name, credentials, settings, isActive } = req.body;
    const integration = await prisma.integration.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(credentials && { credentials }),
        ...(settings && { settings }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(integration);
  } catch (e) { next(e); }
});

// DELETE /api/integrations/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.integration.delete({ where: { id: req.params.id } });
    res.json({ message: 'Integracao eliminada' });
  } catch (e) { next(e); }
});

// =============== Envio de mensagens via integracoes ===============

// Helper: encontrar integracao activa de um tipo
async function findActiveIntegration(workspaceId: string, type: string) {
  return prisma.integration.findFirst({
    where: { workspaceId, type: type as any, isActive: true },
  });
}

// POST /api/integrations/whatsapp-cloud/send
// credentials: { accessToken, phoneNumberId }
router.post('/whatsapp-cloud/send', async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, message, contactId, leadId } = req.body;
    if (!to || !message) throw new AppError('to e message obrigatorios', 400);

    const integration = await findActiveIntegration(req.user!.workspaceId, 'WHATSAPP');
    const creds: any = integration?.credentials || {};
    if (!creds.accessToken || !creds.phoneNumberId) {
      throw new AppError('Configura WhatsApp Cloud nas Integracoes (accessToken + phoneNumberId)', 400);
    }

    const url = `https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^0-9]/g, ''),
        type: 'text',
        text: { body: message },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new AppError(data.error?.message || 'Erro WhatsApp Cloud', 502);

    // Guardar mensagem
    const stored = await prisma.message.create({
      data: {
        content: message, channel: 'WHATSAPP', type: 'TEXT',
        direction: 'OUTBOUND', status: 'SENT',
        contactId: contactId || null, leadId: leadId || null,
        sentById: req.user!.id,
        externalId: data.messages?.[0]?.id || null,
      },
    });
    res.json({ stored, providerResponse: data });
  } catch (e) { next(e); }
});

// ============= Evolution API: gestão de instância via QR =============

// Helper: encontra/cria a integração Evolution para o workspace
async function getOrCreateEvolutionIntegration(workspaceId: string, fields?: { baseUrl?: string; apiKey?: string }) {
  const existing = await prisma.integration.findFirst({
    where: { workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
  });
  if (existing) {
    if (fields?.baseUrl || fields?.apiKey) {
      const creds: any = existing.credentials || {};
      return prisma.integration.update({
        where: { id: existing.id },
        data: { credentials: { ...creds, ...(fields.baseUrl && { baseUrl: fields.baseUrl }), ...(fields.apiKey && { apiKey: fields.apiKey }) } },
      });
    }
    return existing;
  }
  return prisma.integration.create({
    data: {
      type: 'WEBHOOK', name: 'Evolution',
      credentials: { baseUrl: fields?.baseUrl || '', apiKey: fields?.apiKey || '', instanceName: '' },
      isActive: false,
      workspaceId,
    },
  });
}

// POST /api/integrations/evolution/configure - guarda baseUrl e apiKey
router.post('/evolution/configure', async (req: AuthRequest, res: Response, next) => {
  try {
    const { baseUrl, apiKey } = req.body;
    if (!baseUrl || !apiKey) throw new AppError('baseUrl e apiKey obrigatórios', 400);
    const integration = await getOrCreateEvolutionIntegration(req.user!.workspaceId, { baseUrl, apiKey });
    res.json({ id: integration.id, configured: true });
  } catch (e) { next(e); }
});

// POST /api/integrations/evolution/connect - cria instância e devolve QR
router.post('/evolution/connect', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    if (!integration) throw new AppError('Configura primeiro o servidor Evolution (baseUrl + apiKey)', 400);
    const creds: any = integration.credentials || {};
    if (!creds.baseUrl || !creds.apiKey) throw new AppError('baseUrl e apiKey em falta', 400);

    const instanceName = creds.instanceName || `meta_${req.user!.workspaceId.substring(0, 8)}`;
    const webhookUrl = `${process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`}/api/webhooks/evolution`;

    // 1) Verificar se já existe instância com este nome
    let exists = false;
    try {
      const list = await evolutionFetch(creds, `/instance/fetchInstances?instanceName=${instanceName}`);
      const arr = Array.isArray(list) ? list : (list?.instances || []);
      exists = arr.some((x: any) => (x?.instance?.instanceName || x?.name || x?.instanceName) === instanceName);
    } catch { /* silent */ }

    // 2) Criar se não existir (formato Evolution v2)
    if (!exists) {
      try {
        await evolutionFetch(creds, '/instance/create', {
          method: 'POST',
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
          }),
        });
      } catch (e: any) {
        const msg = String(e.message).toLowerCase();
        // Se já existe, não é problema; outros erros sim
        if (!msg.includes('already') && !msg.includes('exists')) {
          console.error('Evolution create error:', e.message);
        }
      }
    }

    // 3) Configurar webhook (Evolution v2: /webhook/set/{instance} com body { webhook: {...} })
    const webhookEvents = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'PRESENCE_UPDATE', 'CALL', 'QRCODE_UPDATED'];
    try {
      await evolutionFetch(creds, `/webhook/set/${instanceName}`, {
        method: 'POST',
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: webhookEvents,
          },
        }),
      });
    } catch (e: any) {
      // fallback formato legado
      try {
        await evolutionFetch(creds, `/webhook/set/${instanceName}`, {
          method: 'POST',
          body: JSON.stringify({
            url: webhookUrl, enabled: true,
            events: webhookEvents,
          }),
        });
      } catch { /* silent */ }
    }

    // 4) Pedir QR
    let qr: any = null;
    try {
      qr = await evolutionFetch(creds, `/instance/connect/${instanceName}`);
    } catch (e: any) {
      console.error('Evolution connect error:', e.message);
      throw new AppError(`Erro a ligar a instância: ${e.message}`, 502);
    }

    // 5) Persistir instanceName + webhook
    await prisma.integration.update({
      where: { id: integration.id },
      data: { credentials: { ...creds, instanceName, webhookUrl }, isActive: true },
    });

    // 6) Extrair base64 do QR (formato Evolution v2: { pairingCode, code, base64, count })
    const base64 = qr?.base64 || qr?.qrcode?.base64 || qr?.qr?.base64 || null;
    const code = qr?.code || qr?.qrcode?.code || qr?.pairingCode || null;

    res.json({ instanceName, base64, code, raw: qr });
  } catch (e) { next(e); }
});

// GET /api/integrations/evolution/status - ver estado da ligação
router.get('/evolution/status', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    if (!integration) return res.json({ configured: false });
    const creds: any = integration.credentials || {};
    if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) {
      return res.json({ configured: !!(creds.baseUrl && creds.apiKey), instanceName: creds.instanceName || null, state: 'unknown' });
    }
    try {
      const data = await evolutionFetch(creds, `/instance/connectionState/${creds.instanceName}`);
      // Evolution v2: { instance: { instanceName, state } }
      const state = data?.instance?.state || data?.state || data?.status || 'unknown';
      res.json({ configured: true, instanceName: creds.instanceName, state, raw: data });
    } catch (e: any) {
      res.json({ configured: true, instanceName: creds.instanceName, state: 'error', error: e.message });
    }
  } catch (e) { next(e); }
});

// GET /api/integrations/evolution/qr - rebusca o QR (caso expire)
router.get('/evolution/qr', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    if (!integration) throw new AppError('Evolution não configurada', 400);
    const creds: any = integration.credentials || {};
    if (!creds.instanceName) throw new AppError('Sem instância criada', 400);

    let qr: any = null;
    try { qr = await evolutionFetch(creds, `/instance/connect/${creds.instanceName}`); }
    catch (e: any) { console.error('Evolution /qr connect error:', e.message); }

    // Fallback se v2 mudou path
    if (!qr || (!qr.base64 && !qr.qrcode)) {
      try { qr = await evolutionFetch(creds, `/instance/qrcode/${creds.instanceName}`); } catch {}
    }

    const base64 = qr?.base64 || qr?.qrcode?.base64 || qr?.qr?.base64 || null;
    const code = qr?.code || qr?.qrcode?.code || qr?.pairingCode || null;
    res.json({ base64, code, raw: qr });
  } catch (e) { next(e); }
});

// POST /api/integrations/evolution/presence - enviar presence ao destinatário (composing/recording/paused)
router.post('/evolution/presence', async (req: AuthRequest, res: Response, next) => {
  try {
    const { phone, presence } = req.body; // presence: 'composing' | 'recording' | 'paused' | 'available'
    if (!phone || !presence) throw new AppError('phone e presence obrigatórios', 400);
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
    });
    if (!integration) return res.json({ ok: false, reason: 'sem integração' });
    const creds: any = integration.credentials || {};
    if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) return res.json({ ok: false, reason: 'incompleta' });

    try {
      await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/sendPresence/${creds.instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
        body: JSON.stringify({
          number: String(phone).replace(/\D/g, ''),
          presence,
          delay: 1200,
        }),
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  } catch (e) { next(e); }
});

// POST /api/integrations/evolution/disconnect - logout / desliga a sessão
router.post('/evolution/disconnect', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    if (!integration) return res.json({ message: 'Não havia ligação' });
    const creds: any = integration.credentials || {};
    if (creds.instanceName) {
      try { await evolutionFetch(creds, `/instance/logout/${creds.instanceName}`, { method: 'DELETE' }); } catch {}
    }
    await prisma.integration.update({ where: { id: integration.id }, data: { isActive: false } });
    res.json({ message: 'Desligado' });
  } catch (e) { next(e); }
});

// DELETE /api/integrations/evolution - apagar instância completa do servidor
router.delete('/evolution', async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
    });
    if (!integration) return res.json({ message: 'Nada para apagar' });
    const creds: any = integration.credentials || {};
    if (creds.instanceName) {
      try { await evolutionFetch(creds, `/instance/delete/${creds.instanceName}`, { method: 'DELETE' }); } catch {}
    }
    await prisma.integration.delete({ where: { id: integration.id } });
    res.json({ message: 'Instância removida' });
  } catch (e) { next(e); }
});

// POST /api/integrations/evolution/send
// credentials: { baseUrl, apiKey, instanceName }
router.post('/evolution/send', async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, message, contactId, leadId } = req.body;
    if (!to || !message) throw new AppError('to e message obrigatorios', 400);

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
    });
    const creds: any = integration?.credentials || {};
    if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) {
      throw new AppError('Configura Evolution nas Integracoes (baseUrl + apiKey + instanceName)', 400);
    }

    const url = `${creds.baseUrl.replace(/\/$/, '')}/message/sendText/${creds.instanceName}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: creds.apiKey,
      },
      body: JSON.stringify({
        number: to.replace(/[^0-9]/g, ''),
        text: message,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new AppError(data?.message || 'Erro Evolution', 502);

    const stored = await prisma.message.create({
      data: {
        content: message, channel: 'WHATSAPP', type: 'TEXT',
        direction: 'OUTBOUND', status: 'SENT',
        contactId: contactId || null, leadId: leadId || null,
        sentById: req.user!.id,
        externalId: data.key?.id || null,
      },
    });
    res.json({ stored, providerResponse: data });
  } catch (e) { next(e); }
});

// POST /api/integrations/email/send
// credentials: { host, port, secure, user, pass, fromName, fromEmail }
router.post('/email/send', async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, subject, html, text, contactId, leadId } = req.body;
    if (!to || !subject || (!html && !text)) {
      throw new AppError('to, subject e (html ou text) obrigatorios', 400);
    }
    const integration = await findActiveIntegration(req.user!.workspaceId, 'EMAIL_SMTP');
    const creds: any = integration?.credentials || {};
    if (!creds.host || !creds.user || !creds.pass) {
      throw new AppError('Configura SMTP nas Integracoes (host + user + pass)', 400);
    }
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: Number(creds.port || 587),
      secure: !!creds.secure,
      auth: { user: creds.user, pass: creds.pass },
    });
    const info = await transporter.sendMail({
      from: creds.fromName ? `"${creds.fromName}" <${creds.fromEmail || creds.user}>` : (creds.fromEmail || creds.user),
      to, subject, html, text,
    });
    const stored = await prisma.message.create({
      data: {
        content: text || html || '', channel: 'EMAIL', type: 'TEXT',
        direction: 'OUTBOUND', status: 'SENT',
        contactId: contactId || null, leadId: leadId || null,
        sentById: req.user!.id,
        externalId: info.messageId,
      },
    });
    res.json({ stored, providerResponse: { messageId: info.messageId } });
  } catch (e) { next(e); }
});

export default router;
