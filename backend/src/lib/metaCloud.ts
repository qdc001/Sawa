// WhatsApp Cloud API (Meta, oficial).
//
// Canal principal quando a integracao WHATSAPP tem settings.primary=true; a
// Evolution (QR) fica de reserva (settings.fallbackEvolution) ou desligada.
//
// Regras da Meta que este modulo trata:
// - Texto livre, ficheiros e PDFs so dentro da janela de 24 h (a contar da
//   ultima mensagem do contacto). Fora dela, so modelos aprovados: o texto vai
//   dentro do modelo de follow-up (settings.followupTemplate), com o nome no
//   {{1}} e o texto no {{2}}. Os parametros nao aceitam quebras de linha.
// - Ficheiros locais (/uploads) sobem primeiro para a Meta (/media) e vao por id.
// - Media recebida chega so com um id: descarrega-se com o token para /uploads.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from './prisma';
import { getCreds } from './integrationCrypto';
import { publicMediaUrl } from './evolutionMedia';

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;
const UPLOADS = path.join(__dirname, '../../uploads');
const WINDOW_MS = 24 * 3600_000;

export type CloudSettings = {
  primary?: boolean;
  fallbackEvolution?: boolean;
  followupTemplate?: { name: string; lang: string; body?: string | null } | null;
};

// provider 'meta': Graph API directa (token + phone_number_id).
// provider 'ycloud': parceiro YCloud (coexistencia com a app do telemovel);
//   token = API key, phoneId = numero da empresa (so digitos), appSecret =
//   segredo do webhook (whsec_...).
export type Cloud = {
  integrationId: string;
  workspaceId: string;
  provider: 'meta' | 'ycloud';
  token: string;
  phoneId: string;
  wabaId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  settings: CloudSettings;
};

const YC = 'https://api.ycloud.com/v2';

function toCloud(i: any): Cloud | null {
  const c: any = getCreds(i);
  const provider = c.provider === 'ycloud' ? 'ycloud' : 'meta';
  const token = c.accessToken || c.token || c.apiKey;
  const phoneId = provider === 'ycloud' ? String(c.phoneId || c.fromNumber || '').replace(/\D/g, '') : (c.phoneNumberId || c.phoneId);
  if (!token || !phoneId) return null;
  return {
    integrationId: i.id, workspaceId: i.workspaceId, provider, token, phoneId: String(phoneId),
    wabaId: c.businessAccountId || c.wabaId || null, appSecret: c.appSecret || null,
    verifyToken: c.verifyToken || null, settings: (i.settings || {}) as CloudSettings,
  };
}

const cache = new Map<string, { v: Cloud | null; at: number }>();
export function invalidateCloudCache(): void { cache.clear(); }

export async function getCloud(workspaceId: string): Promise<Cloud | null> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const i = await prisma.integration.findFirst({ where: { workspaceId, type: 'WHATSAPP', isActive: true } });
  const v = i ? toCloud(i) : null;
  cache.set(workspaceId, { v, at: Date.now() });
  return v;
}

// Webhook: a Meta identifica o numero pelo phone_number_id.
export async function cloudByPhoneId(phoneId: string): Promise<Cloud | null> {
  const all = await prisma.integration.findMany({ where: { type: 'WHATSAPP', isActive: true } });
  for (const i of all) {
    const c = toCloud(i);
    if (c && c.phoneId === String(phoneId)) return c;
  }
  return null;
}

export async function allClouds(): Promise<Cloud[]> {
  const all = await prisma.integration.findMany({ where: { type: 'WHATSAPP', isActive: true } });
  return all.map(toCloud).filter(Boolean) as Cloud[];
}

// Sincrono para o ritmo de envio (waitSendSlot): ultimo valor conhecido.
const primaryFlag = new Map<string, boolean>();
export function cloudPrimaryKnown(workspaceId: string): boolean { return primaryFlag.get(workspaceId) === true; }

export async function cloudPrimary(workspaceId: string): Promise<Cloud | null> {
  const c = await getCloud(workspaceId);
  const on = !!c?.settings.primary;
  primaryFlag.set(workspaceId, on);
  return on ? c : null;
}

export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secrets: string[]): boolean {
  if (!secrets.length) return true; // sem App Secret configurado: nao se valida
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const got = Buffer.from(header.slice(7), 'hex');
  return secrets.some((s) => {
    const exp = crypto.createHmac('sha256', s).update(rawBody).digest();
    return exp.length === got.length && crypto.timingSafeEqual(exp, got);
  });
}

// ---------- Janela de 24 h ----------

export async function contactForPhone(workspaceId: string, phone: string): Promise<{ id: string; firstName: string | null; whatsappLid: string | null } | null> {
  const digits = String(phone).split('@')[0].replace(/\D/g, '');
  if (!digits) return null;
  return prisma.contact.findFirst({
    where: { workspaceId, OR: [{ whatsapp: digits }, { whatsappLid: digits }] },
    select: { id: true, firstName: true, whatsappLid: true },
  });
}

export async function windowOpenFor(contactId: string): Promise<boolean> {
  const last = await prisma.message.findFirst({
    where: { contactId, direction: 'INBOUND', isInternal: false, channel: 'WHATSAPP' },
    orderBy: { createdAt: 'desc' }, select: { createdAt: true },
  });
  return !!last && Date.now() - last.createdAt.getTime() < WINDOW_MS;
}

// ---------- Envio ----------

type GraphResult = { ok: boolean; id?: string; code?: number; error?: string };

async function graphSend(c: Cloud, body: any): Promise<GraphResult> {
  if (c.provider === 'ycloud') {
    // Mesmo conteudo da Meta, mas from/to em E.164 e sem messaging_product.
    const r = await fetch(`${YC}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': c.token },
      body: JSON.stringify({ ...body, from: `+${c.phoneId}`, to: `+${String(body.to).replace(/\D/g, '')}` }),
    });
    const data: any = await r.json().catch(() => ({}));
    const code = Number(data?.whatsappApiError?.code || data?.error?.whatsappApiError?.code) || undefined;
    if (r.ok && data?.status !== 'failed') return { ok: true, id: data?.wamid || data?.id };
    const msg = data?.whatsappApiError?.error_data?.details || data?.errorMessage || data?.error?.message || data?.message || `HTTP ${r.status}`;
    return { ok: false, code, error: explainError(code, msg) };
  }
  const r = await fetch(`${GRAPH}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
  });
  const data: any = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, id: data?.messages?.[0]?.id };
  const e = data?.error || {};
  return { ok: false, code: e.code, error: explainError(e.code, e.error_data?.details || e.message || `HTTP ${r.status}`) };
}

export function explainError(code: number | undefined, fallback: string): string {
  switch (code) {
    case 131047: return 'Passaram mais de 24 h desde a última mensagem do contacto: só se pode enviar um modelo aprovado.';
    case 131026: return 'A mensagem não pôde ser entregue (o número pode não ter WhatsApp ou ter uma versão antiga).';
    case 131049: return 'A Meta não entregou para não saturar este contacto com mensagens de marketing. Tenta mais tarde.';
    case 131050: return 'O contacto pediu para não receber mensagens de marketing.';
    case 131056: return 'Demasiadas mensagens seguidas para este contacto. Espera um pouco.';
    case 132001: return 'O modelo de mensagem não existe ou ainda não foi aprovado.';
    case 132000: return 'O número de variáveis do modelo não bate certo com o modelo aprovado.';
    case 190: return 'O token da Meta expirou ou é inválido. Gera um token permanente novo.';
    case 131042: return 'Problema de pagamento na conta WhatsApp Business (método de pagamento).';
    case 368: return 'A conta foi temporariamente bloqueada pela Meta por violar políticas.';
    default: return fallback;
  }
}

function mimeFor(file: string, type: string): string {
  const ext = file.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    mp4: 'video/mp4', '3gp': 'video/3gpp', ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', amr: 'audio/amr',
  };
  return map[ext] || (type === 'IMAGE' ? 'image/jpeg' : type === 'VIDEO' ? 'video/mp4' : type === 'AUDIO' ? 'audio/ogg' : 'application/octet-stream');
}

function localFile(mediaUrl: string): string | null {
  const idx = mediaUrl.indexOf('/uploads/');
  if (idx < 0) return null;
  const p = path.join(UPLOADS, path.basename(mediaUrl.slice(idx + '/uploads/'.length).split('?')[0]));
  return fs.existsSync(p) ? p : null;
}

async function uploadMedia(c: Cloud, filePath: string, mime: string): Promise<string> {
  if (c.provider === 'ycloud') {
    const f = new FormData();
    f.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
    const r = await fetch(`${YC}/whatsapp/media/${encodeURIComponent('+' + c.phoneId)}/upload`, { method: 'POST', headers: { 'X-API-Key': c.token }, body: f });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.id) throw new Error(data?.error?.message || data?.message || `upload HTTP ${r.status}`);
    return data.id;
  }
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
  const r = await fetch(`${GRAPH}/${c.phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}` }, body: form });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !data.id) throw new Error(explainError(data?.error?.code, data?.error?.message || `upload HTTP ${r.status}`));
  return data.id;
}

// Texto para dentro de um parametro de modelo: sem quebras de linha, tabs ou
// mais de 4 espacos seguidos.
export function templateParam(text: string, max = 900): string {
  const flat = String(text || '').replace(/[\t\r]/g, ' ').replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

// "Ola Ana, tudo bem?" -> "tudo bem?" (o modelo ja cumprimenta com o nome).
// Divide o texto do guia nos 2 parametros do modelo "Ola, {{1}} {{2}}\n\nSherone, Znerd."
// {{1}} leva o nome com a pontuacao do guia ("Ana! 😊", "Ana.", "Ana, tudo bem? 😊");
// {{2}} o resto. "Bom dia/Boa tarde, Ana!" passa a "Ola, Ana!" e "Ana, o teu
// acesso..." passa a "Ola, Ana! O teu acesso...".
const EMOJI_RUN = /^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/u;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function splitForTemplate(text: string, firstName: string | null): [string, string] {
  const name = (firstName || '').trim().split(/\s+/)[0] || '';
  const fallback1 = name ? `${name}!` : 'tudo bem?';
  let t = String(text || '').trim();
  const g = t.match(/^(ol[aá]|oi|bom dia|boa tarde|boa noite)(?=[\s,!.])\s*,?\s*/iu);
  if (g) {
    t = t.slice(g[0].length);
    {
      // Nome (o que estiver no texto) + pontuacao, ate 30 caracteres:
      // "Ana!", "Ana.", "Ana, tudo bem?".
      const m = t.match(/^[^,!.?\n]{1,30}?(?:\s*,\s*tudo bem\?|[!.?])/iu);
      if (m && !/^\s/.test(t)) {
        let rest = t.slice(m[0].length);
        const emo = rest.match(EMOJI_RUN)?.[0] || '';
        rest = rest.slice(emo.length);
        const p1 = (m[0].trim() + (/[!.?]$/.test(m[0]) ? '' : '!') + (emo.trim() ? ' ' + emo.trim() : '')).trim();
        return [p1, cap(rest.replace(/^[,\s]+/, '').trim())];
      }
    }
    // Cumprimento sem o nome ("Ola! Estou..."): tira a pontuacao e os emojis.
    t = t.replace(/^[!.,]+/, '');
    t = t.replace(EMOJI_RUN, '');
    return [fallback1, cap(t.trim())];
  }
  // Comeca pelo nome: "Ana, o teu acesso termina hoje."
  if (name) {
    const m = t.match(new RegExp(`^${escRe(name)}\\s*[,!.]\\s*`, 'iu'));
    if (m) return [`${name}!`, cap(t.slice(m[0].length).trim())];
  }
  return [fallback1, t];
}

export function renderTemplate(body: string | null | undefined, params: string[]): string {
  if (!body) return params.join(' ');
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? '');
}

export async function sendFollowupTemplate(c: Cloud, to: string, firstName: string | null, text: string): Promise<GraphResult & { rendered?: string }> {
  const t = c.settings.followupTemplate;
  if (!t?.name) return { ok: false, error: 'Janela de 24 h fechada e não há modelo de follow-up configurado (Integrações > WhatsApp oficial).' };
  const [p1, p2] = splitForTemplate(text, firstName);
  // Modelo com 1 variavel ("Ola, {{1}}"): nome e texto vao juntos no {{1}}.
  const vars = new Set((t.body || '').match(/\{\{\d+\}\}/g) || []).size;
  const params = vars === 1
    ? [templateParam(`${p1} ${p2}`.trim()) || 'tudo bem?']
    : [templateParam(p1, 60) || 'tudo bem?', templateParam(p2) || '😊'];
  const r = await graphSend(c, {
    to, type: 'template',
    template: { name: t.name, language: { code: t.lang || 'pt_PT', policy: 'deterministic' }, components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] },
  });
  return { ...r, rendered: renderTemplate(t.body, params) };
}

export type CloudSendResult = { ok: boolean; externalId?: string; via?: string; error?: string; renderedText?: string; windowClosed?: boolean };

export async function sendCloud(
  c: Cloud, phone: string, content: string, type: string, mediaUrl?: string, fileName?: string,
): Promise<CloudSendResult> {
  const raw = String(phone);
  if (raw.endsWith('@lid')) return { ok: false, error: 'Este contacto só tem o identificador interno (LID): a API oficial precisa do número real.' };
  if (raw.includes('@g.us')) return { ok: false, error: 'A API oficial da Meta não envia para grupos.' };
  const to = raw.replace(/\D/g, '');
  if (to.length < 8 || to.length > 15) return { ok: false, error: `Número de telefone inválido: "${phone}".` };

  const contact = await contactForPhone(c.workspaceId, to);
  if (contact?.whatsappLid === to) return { ok: false, error: 'Este contacto só tem o identificador interno (LID): a API oficial precisa do número real.' };
  const open = contact ? await windowOpenFor(contact.id) : false;

  if (!open) {
    if (type !== 'TEXT' && mediaUrl) {
      return { ok: false, windowClosed: true, error: 'Passaram mais de 24 h desde a última mensagem do contacto: ficheiros só depois de ele responder.' };
    }
    const r = await sendFollowupTemplate(c, to, contact?.firstName || null, content);
    console.log(`[cloud] modelo ${c.settings.followupTemplate?.name || '-'} to=${to.slice(-4)} ok=${r.ok}${r.ok ? '' : ' ' + r.error}`);
    return { ok: r.ok, externalId: r.id, via: 'cloud-template', error: r.error, renderedText: r.rendered, windowClosed: true };
  }

  let body: any;
  if (type === 'TEXT' || !mediaUrl) {
    body = { to, type: 'text', text: { body: content, preview_url: /https?:\/\//.test(content) } };
  } else {
    const kind = type === 'IMAGE' ? 'image' : type === 'VIDEO' ? 'video' : type === 'AUDIO' ? 'audio' : 'document';
    const local = localFile(mediaUrl);
    if (!local && !/^https?:\/\//i.test(mediaUrl)) return { ok: false, error: 'Ficheiro não encontrado no disco. Refaz o upload.' };
    const media: any = {};
    try {
      if (local) media.id = await uploadMedia(c, local, mimeFor(fileName || local, type));
      else media.link = mediaUrl;
    } catch (e: any) { return { ok: false, error: e.message }; }
    const caption = content && content !== 'Anexo' && content !== fileName ? content : '';
    if (kind !== 'audio' && caption) media.caption = caption;
    if (kind === 'document') media.filename = (fileName || path.basename(local || mediaUrl)).replace(/^\d+-[a-z0-9]+-/, '');
    body = { to, type: kind, [kind]: media };
  }
  let r = await graphSend(c, body);
  // A janela fechou entretanto (ou a contagem local falhou): tenta o modelo.
  if (!r.ok && r.code === 131047 && (type === 'TEXT' || !mediaUrl)) {
    const t = await sendFollowupTemplate(c, to, contact?.firstName || null, content);
    return { ok: t.ok, externalId: t.id, via: 'cloud-template', error: t.error, renderedText: t.rendered, windowClosed: true };
  }
  console.log(`[cloud] ${body.type} to=${to.slice(-4)} ok=${r.ok}${r.ok ? '' : ' ' + r.error}`);
  return { ok: r.ok, externalId: r.id, via: 'cloud', error: r.error };
}

export async function markRead(c: Cloud, messageId: string, typing = false): Promise<void> {
  if (c.provider === 'ycloud') return; // sem endpoint documentado para isto
  await fetch(`${GRAPH}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, ...(typing ? { typing_indicator: { type: 'text' } } : {}) }),
  }).catch(() => {});
}

// ---------- Media recebida ----------

// Meta: o webhook traz so o id (pede-se o URL a seguir). YCloud: traz o link,
// que se descarrega com a API key.
export async function downloadCloudMedia(c: Cloud, mediaId: string, fallbackExt: string, fileName?: string | null, link?: string | null): Promise<string | null> {
  try {
    let info: any;
    let bin: Response;
    if (c.provider === 'ycloud') {
      if (!link) return null;
      bin = await fetch(link, { headers: { 'X-API-Key': c.token } });
      info = { mime_type: bin.headers.get('content-type') || '' };
    } else {
      const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${c.token}` } });
      info = await meta.json();
      if (!meta.ok || !info.url) return null;
      bin = await fetch(info.url, { headers: { Authorization: `Bearer ${c.token}` } });
    }
    if (!bin.ok) return null;
    const buf = Buffer.from(await bin.arrayBuffer());
    const fromMime = String(info.mime_type || '').split(';')[0].split('/')[1];
    const ext = (fileName?.includes('.') ? fileName.split('.').pop() : null) || (fromMime === 'jpeg' ? 'jpg' : fromMime) || fallbackExt;
    if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
    const name = `wa_${Date.now()}_${mediaId.slice(-8)}.${String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 8) || fallbackExt}`;
    fs.writeFileSync(path.join(UPLOADS, name), buf);
    return publicMediaUrl(`/uploads/${name}`);
  } catch (e: any) {
    console.error('[cloud] download de media falhou:', e?.message || e);
    return null;
  }
}

// ---------- Modelos ----------

export async function listTemplates(c: Cloud): Promise<Array<{ name: string; language: string; status: string; category: string; body: string }>> {
  const map = (t: any) => ({
    name: t.name, language: t.language, status: t.status, category: t.category,
    body: (t.components || []).find((x: any) => String(x.type).toUpperCase() === 'BODY')?.text || '',
  });
  if (c.provider === 'ycloud') {
    const r = await fetch(`${YC}/whatsapp/templates?limit=100${c.wabaId ? `&filter.wabaId=${encodeURIComponent(c.wabaId)}` : ''}`, { headers: { 'X-API-Key': c.token } });
    const data: any = await r.json().catch(() => ({}));
    return (data?.items || []).map(map);
  }
  if (!c.wabaId) return [];
  const r = await fetch(`${GRAPH}/${c.wabaId}/message_templates?fields=name,language,status,category,components&limit=100`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  const data: any = await r.json().catch(() => ({}));
  return (data?.data || []).map(map);
}

export async function fetchTemplateBody(c: Cloud, name: string, lang: string): Promise<{ body: string | null; status: string | null; category: string | null }> {
  const all = (await listTemplates(c)).filter((t) => t.name === name);
  const t = all.find((x) => !lang || x.language === lang) || all[0];
  if (!t) return { body: null, status: null, category: null };
  return { body: t.body || null, status: t.status || null, category: t.category || null };
}

// Formato comum para o painel: display_phone_number, verified_name, quality_rating, messaging_limit_tier.
export async function phoneInfo(c: Cloud): Promise<any> {
  if (c.provider === 'ycloud') {
    const r = await fetch(`${YC}/whatsapp/phoneNumbers?limit=100`, { headers: { 'X-API-Key': c.token } });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${r.status} (confirma a API key da YCloud)`);
    const p = (data.items || []).find((x: any) => String(x.phoneNumber || '').replace(/\D/g, '') === c.phoneId);
    if (!p) throw new Error(`O número +${c.phoneId} não aparece na conta YCloud.`);
    return {
      display_phone_number: p.displayPhoneNumber || p.phoneNumber, verified_name: p.verifiedName,
      quality_rating: p.qualityRating, messaging_limit_tier: p.messagingLimit, status: p.status, wabaId: p.wabaId,
    };
  }
  const r = await fetch(`${GRAPH}/${c.phoneId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,platform_type,code_verification_status`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(explainError(data?.error?.code, data?.error?.message || `HTTP ${r.status}`));
  return data;
}

// ---------- YCloud: webhook ----------

// Cria o endpoint de webhook na YCloud e devolve o segredo (whsec_...).
export async function ycloudCreateWebhook(apiKey: string, url: string): Promise<{ id: string; secret: string }> {
  const r = await fetch(`${YC}/webhookEndpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      url, description: 'Klaru CRM',
      enabledEvents: ['whatsapp.inbound_message.received', 'whatsapp.message.updated', 'whatsapp.smb.message.echoes'],
    }),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !data.secret) throw new Error(data?.error?.message || data?.message || `Criar webhook na YCloud falhou (HTTP ${r.status})`);
  return { id: data.id, secret: data.secret };
}

// Cabecalho "YCloud-Signature: t=<segundos>,s=<hex>"; assina-se `${t}.${corpo}`.
export function verifyYcloudSignature(rawBody: Buffer | undefined, header: string | undefined, secrets: string[]): boolean {
  if (!secrets.length) return true;
  if (!rawBody || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = parts.t; const s = parts.s;
  if (!t || !s) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const got = Buffer.from(s, 'hex');
  return secrets.some((sec) => {
    const exp = crypto.createHmac('sha256', sec).update(`${t}.`).update(rawBody).digest();
    return exp.length === got.length && crypto.timingSafeEqual(exp, got);
  });
}
