// Digest diário de tarefas — envia WhatsApp a cada responsável às HH:MM
// definidas no Workspace. Lista tarefas atrasadas, de hoje e de amanhã.
//
// O cron corre a cada minuto (em server.ts). Aqui filtra-se quais workspaces
// devem disparar agora e processa-se cada um.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MaputoTime { hour: number; minute: number; ymd: string; }
function nowInMaputo(): MaputoTime {
  // Africa/Maputo = UTC+2 (sem DST). Usamos Intl para extrair partes em qualquer timezone.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// Range "início do dia" e "fim do dia" no fuso Maputo, devolve Date UTC equivalentes.
function maputoDayRange(offsetDays: number = 0): { from: Date; to: Date } {
  const t = nowInMaputo();
  const [y, m, d] = t.ymd.split('-').map(Number);
  // Construir Date em UTC representando 00:00 e 23:59:59 Maputo (UTC+2 → subtrair 2h da meia-noite local)
  const fromUtc = new Date(Date.UTC(y, m - 1, d + offsetDays, 0 - 2, 0, 0));
  const toUtc = new Date(Date.UTC(y, m - 1, d + offsetDays, 23 - 2, 59, 59, 999));
  return { from: fromUtc, to: toUtc };
}

function formatDueLocal(dt: Date): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(dt);
}

function daysOverdue(dueAt: Date): number {
  const today = maputoDayRange(0).from.getTime();
  return Math.max(1, Math.floor((today - dueAt.getTime()) / 86400000));
}

interface DigestBuckets {
  overdue: any[];
  today: any[];
  tomorrow: any[];
}

async function buildBucketsForUser(userId: string, workspaceId: string): Promise<DigestBuckets> {
  const today = maputoDayRange(0);
  const tomorrow = maputoDayRange(1);

  const baseWhere: any = {
    assignedToId: userId,
    status: { in: ['PENDING', 'IN_PROGRESS'] },
    parentTaskId: null,
    assignedTo: { workspaceId },
  };

  const [overdue, todayTasks, tomorrowTasks] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, dueAt: { lt: today.from, not: null } },
      orderBy: { dueAt: 'asc' },
      take: 30,
      include: { contact: { select: { firstName: true, lastName: true } } },
    }),
    prisma.task.findMany({
      where: { ...baseWhere, dueAt: { gte: today.from, lte: today.to } },
      orderBy: { dueAt: 'asc' },
      take: 30,
      include: { contact: { select: { firstName: true, lastName: true } } },
    }),
    prisma.task.findMany({
      where: { ...baseWhere, dueAt: { gte: tomorrow.from, lte: tomorrow.to } },
      orderBy: { dueAt: 'asc' },
      take: 30,
      include: { contact: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  return { overdue, today: todayTasks, tomorrow: tomorrowTasks };
}

// Template default da mensagem do digest. Editável em Definições.
// Placeholders disponíveis em cada parte:
//   {firstName} {fullName} {date} — sempre
//   {count} {list} — só em *Header
//   {title} {contact} {contactDash} {due} {dueParen} {overdueDays} {overdueSuffix} — só em taskLine
export const DEFAULT_DIGEST_TEMPLATE = {
  header: 'Bom dia, {firstName}! ☀️',
  overdueHeader: '📋 Atrasadas ({count}):\n{list}',
  todayHeader: '📅 Hoje ({count}):\n{list}',
  tomorrowHeader: '🔜 Amanhã ({count}):\n{list}',
  taskLine: '• {title}{contactDash}{dueParen}{overdueSuffix}',
  footer: 'Bom trabalho!',
};
export type DigestTemplate = typeof DEFAULT_DIGEST_TEMPLATE;

function renderStr(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

function formatTaskLine(tpl: string, t: any): string {
  const contactName = t.contact ? `${t.contact.firstName} ${t.contact.lastName || ''}`.trim() : '';
  const due = t.dueAt ? formatDueLocal(new Date(t.dueAt)) : '';
  const title = (t.title || '').trim() || 'Tarefa';
  let overdueDays = 0;
  let overdueSuffix = '';
  if (t.dueAt) {
    const todayStart = maputoDayRange(0).from.getTime();
    if (new Date(t.dueAt).getTime() < todayStart) {
      overdueDays = daysOverdue(new Date(t.dueAt));
      overdueSuffix = ` — atrasada ${overdueDays} ${overdueDays === 1 ? 'dia' : 'dias'}`;
    }
  }
  return renderStr(tpl, {
    title,
    contact: contactName,
    contactDash: contactName ? ` — ${contactName}` : '',
    due,
    dueParen: due ? ` (${due})` : '',
    overdueDays: String(overdueDays),
    overdueSuffix,
  });
}

function buildMessage(userName: string, buckets: DigestBuckets, template?: Partial<DigestTemplate>): string | null {
  const total = buckets.overdue.length + buckets.today.length + buckets.tomorrow.length;
  if (total === 0) return null;

  const t: DigestTemplate = { ...DEFAULT_DIGEST_TEMPLATE, ...(template || {}) };
  const firstName = userName.split(' ')[0] || userName;
  const dateStr = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit' }).format(new Date());

  const baseVars = { firstName, fullName: userName, date: dateStr };

  const parts: string[] = [renderStr(t.header, baseVars), ''];

  if (buckets.overdue.length) {
    const list = buckets.overdue.map((task) => formatTaskLine(t.taskLine, task)).join('\n');
    parts.push(renderStr(t.overdueHeader, { ...baseVars, count: String(buckets.overdue.length), list }));
    parts.push('');
  }
  if (buckets.today.length) {
    const list = buckets.today.map((task) => formatTaskLine(t.taskLine, task)).join('\n');
    parts.push(renderStr(t.todayHeader, { ...baseVars, count: String(buckets.today.length), list }));
    parts.push('');
  }
  if (buckets.tomorrow.length) {
    const list = buckets.tomorrow.map((task) => formatTaskLine(t.taskLine, task)).join('\n');
    parts.push(renderStr(t.tomorrowHeader, { ...baseVars, count: String(buckets.tomorrow.length), list }));
    parts.push('');
  }

  parts.push(renderStr(t.footer, baseVars));
  return parts.join('\n');
}

// Envia mensagem WhatsApp para um destino (JID de grupo ou número individual).
// - JID acabado em @g.us → enviado tal como está (grupo).
// - JID acabado em @s.whatsapp.net → tal como está.
// - Caso contrário → dígitos do telefone.
async function sendWhatsAppToDestination(workspace: any, destination: string, body: string): Promise<boolean> {
  const evo = await prisma.integration.findFirst({
    where: { workspaceId: workspace.id, type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
  });
  if (!evo) return false;
  const creds: any = evo.credentials || {};
  if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) return false;

  const isJid = destination.includes('@g.us') || destination.includes('@s.whatsapp.net');
  const number = isJid ? destination : destination.replace(/\D/g, '');
  if (!number || (!isJid && number.length < 7)) return false;

  try {
    const url = `${creds.baseUrl.replace(/\/$/, '')}/message/sendText/${creds.instanceName}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: JSON.stringify({ number, text: body }),
    });
    return r.ok;
  } catch (e: any) {
    console.error('digest sendWhatsApp error:', e.message);
    return false;
  }
}

async function processWorkspace(workspace: any): Promise<void> {
  // Carregar utilizadores activos. Prioridade: digestGroupJid (grupo) > phone.
  const users = await prisma.user.findMany({
    where: { workspaceId: workspace.id, isActive: true },
    select: { id: true, name: true, phone: true, digestGroupJid: true },
  });

  const template = (workspace.dailyDigestTemplate as Partial<DigestTemplate>) || {};
  let sent = 0;
  for (const u of users) {
    try {
      const destination = (u.digestGroupJid && u.digestGroupJid.trim()) || (u.phone && u.phone.trim()) || '';
      if (!destination) continue;
      const buckets = await buildBucketsForUser(u.id, workspace.id);
      const message = buildMessage(u.name, buckets, template);
      if (!message) continue;
      const ok = await sendWhatsAppToDestination(workspace, destination, message);
      if (ok) sent++;
    } catch (e: any) {
      console.error(`digest user ${u.id} error:`, e.message);
    }
  }

  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { dailyDigestLastRunAt: new Date() },
  });

  console.log(`[digest] workspace ${workspace.name}: enviado a ${sent}/${users.length} utilizadores`);
}

// Função principal chamada pelo cron a cada minuto
export async function runDailyDigests(): Promise<void> {
  const t = nowInMaputo();
  try {
    const workspaces = await prisma.workspace.findMany({
      where: {
        dailyDigestEnabled: true,
        dailyDigestHour: t.hour,
        dailyDigestMinute: t.minute,
      },
    });

    for (const ws of workspaces) {
      // Idempotência: não correr 2x no mesmo dia
      if (ws.dailyDigestLastRunAt) {
        const lastRunYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Maputo',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(ws.dailyDigestLastRunAt));
        if (lastRunYmd === t.ymd) continue;
      }
      await processWorkspace(ws);
    }
  } catch (e: any) {
    console.error('runDailyDigests fatal:', e.message);
  }
}

// Permite disparar manualmente para um workspace (ex. via endpoint de teste)
export async function runDigestForWorkspace(workspaceId: string): Promise<{ users: number; sent: number }> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return { users: 0, sent: 0 };
  const template = (workspace.dailyDigestTemplate as Partial<DigestTemplate>) || {};
  const users = await prisma.user.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, phone: true, digestGroupJid: true },
  });
  let sent = 0;
  for (const u of users) {
    const destination = (u.digestGroupJid && u.digestGroupJid.trim()) || (u.phone && u.phone.trim()) || '';
    if (!destination) continue;
    const buckets = await buildBucketsForUser(u.id, workspaceId);
    const message = buildMessage(u.name, buckets, template);
    if (!message) continue;
    const ok = await sendWhatsAppToDestination(workspace, destination, message);
    if (ok) sent++;
  }
  return { users: users.length, sent };
}

// Gera preview da mensagem (sem enviar) para mostrar nas Definições.
// Usa dados reais do utilizador autenticado quando possível.
export async function previewDigestForUser(workspaceId: string, userId: string, template?: Partial<DigestTemplate>): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return '';
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const tpl = template !== undefined ? template : ((workspace?.dailyDigestTemplate as Partial<DigestTemplate>) || {});
  const buckets = await buildBucketsForUser(userId, workspaceId);
  // Se não há tarefas reais, criar exemplos fictícios para mostrar formato
  if (buckets.overdue.length + buckets.today.length + buckets.tomorrow.length === 0) {
    const fake = (title: string, when: Date, contact: string) => ({
      title, dueAt: when, contact: { firstName: contact, lastName: '' },
    });
    const now = new Date();
    buckets.overdue = [fake('Exemplo de tarefa atrasada', new Date(now.getTime() - 2 * 86400000), 'Cliente A')];
    buckets.today = [fake('Exemplo de tarefa de hoje', now, 'Cliente B')];
    buckets.tomorrow = [fake('Exemplo de tarefa de amanhã', new Date(now.getTime() + 86400000), 'Cliente C')];
  }
  return buildMessage(user.name, buckets, tpl) || '';
}
