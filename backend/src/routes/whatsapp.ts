import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';

import prisma from '../lib/prisma';
import { getCreds, encryptForStore } from '../lib/integrationCrypto';
import { allClouds, fetchTemplateBody, getCloud, invalidateCloudCache, listTemplates, phoneInfo, sendCloud, verifySignature, verifyYcloudSignature, ycloudCreateWebhook } from '../lib/metaCloud';
import { handleCloudWebhook, handleYcloudWebhook } from '../lib/metaCloudWebhook';
const router = Router();

// ── Helpers ──────────────────────────────────────────
async function sendWhatsAppMessage(to: string, body: string, token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Erro ao enviar mensagem WhatsApp');
  }
  return res.json();
}

async function sendWhatsAppTemplate(to: string, templateName: string, langCode: string, components: any[], token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: langCode }, components },
    }),
  });
  if (!res.ok) throw new Error('Erro ao enviar template WhatsApp');
  return res.json();
}

async function sendWhatsAppMedia(to: string, type: string, mediaUrl: string, caption: string | undefined, token: string, phoneId: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type,
      [type]: { link: mediaUrl, caption },
    }),
  });
  if (!res.ok) throw new Error('Erro ao enviar media WhatsApp');
  return res.json();
}

// ── Webhook verification (GET) ────────────────────────
// URL a colar na app da Meta: <API>/api/whatsapp/webhook. O token de
// verificacao e o WHATSAPP_VERIFY_TOKEN da env ou o guardado na integracao.
router.get('/webhook', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = req.query['hub.challenge'];
  const known = [process.env.WHATSAPP_VERIFY_TOKEN, ...(await allClouds()).map((c) => c.verifyToken)].filter(Boolean);
  if (mode === 'subscribe' && token && known.includes(token)) {
    console.log('WhatsApp webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Webhook receive (POST) ────────────────────────────
// Responde logo 200 (a Meta repete o envio se demorarmos) e processa a seguir.
router.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body;
  if (body?.object !== 'whatsapp_business_account') return res.sendStatus(404);
  const secrets = [process.env.META_APP_SECRET, ...(await allClouds()).filter((c) => c.provider === 'meta').map((c) => c.appSecret)].filter(Boolean) as string[];
  if (!verifySignature((req as any).rawBody, req.get('x-hub-signature-256'), secrets)) {
    console.warn('[cloud] webhook com assinatura invalida (ip=' + (req.ip || '?') + ')');
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  handleCloudWebhook(body, (global as any).io || req.app.get('io')).catch((e) => console.error('WhatsApp webhook error:', e));
});

// ── Send message (authenticated) ─────────────────────
router.post('/send', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, content, leadId, contactId, type = 'text', mediaUrl, templateName, langCode, components } = req.body;

    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP', isActive: true },
    });
    if (!integration) return res.status(400).json({ message: 'Integração WhatsApp não configurada' });

    const creds: any = getCreds(integration);
    let externalId: string | undefined;

    if (type === 'text') {
      const result = await sendWhatsAppMessage(to, content, creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    } else if (type === 'template') {
      const result = await sendWhatsAppTemplate(to, templateName, langCode || 'pt_BR', components || [], creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    } else if (['image', 'video', 'audio', 'document'].includes(type)) {
      const result = await sendWhatsAppMedia(to, type, mediaUrl, content, creds.token, creds.phoneId);
      externalId = result.messages?.[0]?.id;
    }

    const message = await prisma.message.create({
      data: {
        content: content || `[${type}]`,
        type: type.toUpperCase() as any,
        direction: 'OUTBOUND',
        channel: 'WHATSAPP',
        status: 'SENT',
        externalId,
        mediaUrl,
        leadId,
        contactId,
        sentById: req.user!.id,
      },
      include: { sentBy: { select: { id: true, name: true, avatar: true } } },
    });

    const io = req.app.get('io');
    if (leadId) io.to(`lead:${leadId}`).emit('message:new', message);
    io.to(`workspace:${req.user!.workspaceId}`).emit('message:new', message);

    res.json(message);
  } catch (error) {
    next(error);
  }
});

// ── Webhook da YCloud (parceiro, coexistencia) ────────
router.post('/ycloud-webhook', async (req: Request, res: Response) => {
  const secrets = (await allClouds()).filter((c) => c.provider === 'ycloud').map((c) => c.appSecret).filter(Boolean) as string[];
  if (!verifyYcloudSignature((req as any).rawBody, req.get('ycloud-signature'), secrets)) {
    console.warn('[ycloud] webhook com assinatura invalida (ip=' + (req.ip || '?') + ')');
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  handleYcloudWebhook(req.body, (global as any).io || req.app.get('io')).catch((e) => console.error('YCloud webhook error:', e));
});

// ── Configure integration ─────────────────────────────
// Campos vazios mantem o valor guardado (o token nao volta ao frontend).
router.post('/configure', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { token, phoneId, businessAccountId, verifyToken, appSecret, primary, fallbackEvolution, templateName, templateLang, isActive } = req.body;
    const existing = await prisma.integration.findFirst({ where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP' } });
    const old: any = existing ? getCreds(existing) : {};
    const provider = (req.body.provider || old.provider || 'meta') === 'ycloud' ? 'ycloud' : 'meta';
    const switched = (old.provider || 'meta') !== provider;
    const creds: any = {
      provider,
      token: token || (switched ? '' : old.token || old.accessToken),
      phoneId: provider === 'ycloud' ? String(phoneId || (switched ? '' : old.phoneId) || '').replace(/\D/g, '') : (phoneId || old.phoneId || old.phoneNumberId),
      businessAccountId: businessAccountId || (switched ? '' : old.businessAccountId),
      verifyToken: verifyToken || old.verifyToken,
      appSecret: appSecret || (switched ? '' : old.appSecret),
      ycloudWebhookId: switched ? null : old.ycloudWebhookId || null,
    };
    if (!creds.token || !creds.phoneId) {
      return res.status(400).json({ message: provider === 'ycloud' ? 'API key e número da empresa são obrigatórios' : 'Token e Phone Number ID são obrigatórios' });
    }
    // YCloud: o CRM cria sozinho o webhook la e guarda o segredo.
    if (provider === 'ycloud' && !creds.appSecret) {
      const base = (process.env.PUBLIC_API_URL || `https://${req.get('host')}`).replace(/\/$/, '');
      try {
        const w = await ycloudCreateWebhook(creds.token, `${base}/api/whatsapp/ycloud-webhook`);
        creds.appSecret = w.secret; creds.ycloudWebhookId = w.id;
      } catch (e: any) {
        return res.status(400).json({ message: `Não consegui criar o webhook na YCloud: ${e.message}` });
      }
    }
    const prev: any = existing?.settings || {};
    const settings: any = {
      ...prev,
      primary: primary === undefined ? !!prev.primary : !!primary,
      fallbackEvolution: fallbackEvolution === undefined ? !!prev.fallbackEvolution : !!fallbackEvolution,
    };
    if (templateName !== undefined) {
      settings.followupTemplate = templateName ? { name: String(templateName).trim(), lang: String(templateLang || 'pt_PT').trim(), body: null } : null;
    }
    const data = {
      type: 'WHATSAPP' as const, name: 'WhatsApp Business (oficial)',
      isActive: isActive === undefined ? true : !!isActive,
      credentials: encryptForStore(creds) as any, settings, workspaceId: req.user!.workspaceId,
    };
    let integration = existing
      ? await prisma.integration.update({ where: { id: existing.id }, data })
      : await prisma.integration.create({ data });
    invalidateCloudCache();
    // Texto do modelo (para o CRM mostrar o que o contacto recebe).
    let template: any = null;
    let c = await getCloud(req.user!.workspaceId);
    // YCloud: o WABA vem da lista de numeros da conta.
    if (c && c.provider === 'ycloud' && !c.wabaId) {
      const info = await phoneInfo(c).catch(() => null);
      if (info?.wabaId) {
        creds.businessAccountId = info.wabaId;
        integration = await prisma.integration.update({ where: { id: integration.id }, data: { credentials: encryptForStore(creds) as any } });
        invalidateCloudCache();
        c = await getCloud(req.user!.workspaceId);
      }
    }
    if (c && settings.followupTemplate?.name) {
      template = await fetchTemplateBody(c, settings.followupTemplate.name, settings.followupTemplate.lang).catch(() => null);
      if (template?.body) {
        settings.followupTemplate.body = template.body;
        integration = await prisma.integration.update({ where: { id: integration.id }, data: { settings } });
        invalidateCloudCache();
      }
    }
    res.json({ message: 'WhatsApp oficial guardado', integration: { id: integration.id, isActive: integration.isActive }, template });
  } catch (error) { next(error); }
});

// ── Estado (para o painel) ────────────────────────────
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const existing = await prisma.integration.findFirst({ where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP' } });
    const base = (process.env.PUBLIC_API_URL || `https://${req.get('host')}`).replace(/\/$/, '');
    const webhookUrl = `${base}/api/whatsapp/webhook`;
    if (!existing) return res.json({ configured: false, webhookUrl, provider: 'meta' });
    const cr: any = getCreds(existing);
    const settings: any = existing.settings || {};
    const out: any = {
      configured: true, isActive: existing.isActive, provider: cr.provider === 'ycloud' ? 'ycloud' : 'meta',
      webhookUrl: cr.provider === 'ycloud' ? `${base}/api/whatsapp/ycloud-webhook` : webhookUrl,
      ycloudWebhookCreated: !!cr.ycloudWebhookId,
      phoneId: cr.phoneId || cr.phoneNumberId || '', businessAccountId: cr.businessAccountId || '',
      hasToken: !!(cr.token || cr.accessToken), hasAppSecret: !!cr.appSecret, hasVerifyToken: !!(cr.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN),
      primary: !!settings.primary, fallbackEvolution: !!settings.fallbackEvolution,
      followupTemplate: settings.followupTemplate || null,
    };
    const c = await getCloud(req.user!.workspaceId);
    if (c) {
      try { out.phone = await phoneInfo(c); } catch (e: any) { out.phoneError = e.message; }
      try { out.templates = await listTemplates(c); } catch { out.templates = []; }
    }
    res.json(out);
  } catch (error) { next(error); }
});

// ── Teste de envio ────────────────────────────────────
router.post('/test', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const { to, text } = req.body;
    const c = await getCloud(req.user!.workspaceId);
    if (!c) return res.status(400).json({ message: 'WhatsApp oficial não configurado' });
    const r = await sendCloud(c, String(to || ''), String(text || 'Teste do CRM (API oficial)'), 'TEXT');
    res.json(r);
  } catch (error) { next(error); }
});

// ── Get phone numbers from Meta ───────────────────────
router.get('/phone-numbers', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId: req.user!.workspaceId, type: 'WHATSAPP', isActive: true },
    });
    if (!integration) return res.status(404).json({ message: 'Integração não encontrada' });

    const creds: any = getCreds(integration);
    const result = await fetch(
      `https://graph.facebook.com/v19.0/${creds.businessAccountId}/phone_numbers?access_token=${creds.token}`
    );
    const data = await result.json();
    res.json(data);
  } catch (error) { next(error); }
});

export default router;
