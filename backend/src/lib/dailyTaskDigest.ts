// Digest diário de tarefas — envia WhatsApp a cada responsável às HH:MM
// definidas no Workspace. Lista tarefas atrasadas, de hoje e de amanhã.
//
// O cron corre a cada minuto (em server.ts). Aqui filtra-se quais workspaces
// devem disparar agora e processa-se cada um.



import prisma from './prisma';
import { getCreds, encryptForStore } from './integrationCrypto';
interface MaputoTime { hour: number; minute: number; ymd: string; weekday: number; }
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
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  // Calcular o dia da semana a partir da data local Maputo (0=Dom...6=Sáb)
  const [y, m, d] = ymd.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getDay();
  return { hour: Number(get('hour')), minute: Number(get('minute')), ymd, weekday };
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
  taskSeparator: '\n\n',
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

// Devolve um array de até 3 mensagens (fragmentadas para não ficarem grandes no WhatsApp):
//   Parte 1: Saudação + Atrasadas (se houver)
//   Parte 2: Hoje (omitida se vazio)
//   Parte 3: Amanhã (se houver) + Rodapé
// Se não houver tarefas em nenhum bucket, devolve null (não envia nada).
function buildMessageParts(userName: string, buckets: DigestBuckets, template?: Partial<DigestTemplate>): string[] | null {
  const total = buckets.overdue.length + buckets.today.length + buckets.tomorrow.length;
  if (total === 0) return null;

  const t: DigestTemplate = { ...DEFAULT_DIGEST_TEMPLATE, ...(template || {}) };
  const firstName = userName.split(' ')[0] || userName;
  const dateStr = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit' }).format(new Date());

  const baseVars = { firstName, fullName: userName, date: dateStr };

  const sep = t.taskSeparator ?? '\n\n';

  // Parte 1: saudação + atrasadas
  const part1Lines: string[] = [renderStr(t.header, baseVars)];
  if (buckets.overdue.length) {
    const list = buckets.overdue.map((task) => formatTaskLine(t.taskLine, task)).join(sep);
    part1Lines.push('', renderStr(t.overdueHeader, { ...baseVars, count: String(buckets.overdue.length), list }));
  }

  // Parte 2: hoje
  let part2: string | null = null;
  if (buckets.today.length) {
    const list = buckets.today.map((task) => formatTaskLine(t.taskLine, task)).join(sep);
    part2 = renderStr(t.todayHeader, { ...baseVars, count: String(buckets.today.length), list });
  }

  // Parte 3: amanhã + rodapé
  const part3Lines: string[] = [];
  if (buckets.tomorrow.length) {
    const list = buckets.tomorrow.map((task) => formatTaskLine(t.taskLine, task)).join(sep);
    part3Lines.push(renderStr(t.tomorrowHeader, { ...baseVars, count: String(buckets.tomorrow.length), list }), '');
  }
  part3Lines.push(renderStr(t.footer, baseVars));

  const out: string[] = [part1Lines.join('\n')];
  if (part2) out.push(part2);
  out.push(part3Lines.join('\n'));
  return out;
}

// Compat: alguns sítios ainda esperam uma string única. Junta com separador legível.
function buildMessage(userName: string, buckets: DigestBuckets, template?: Partial<DigestTemplate>): string | null {
  const parts = buildMessageParts(userName, buckets, template);
  if (!parts) return null;
  if (parts.length === 1) return parts[0];
  return parts.map((p, i) => `${p}\n\n─── parte ${i + 1}/${parts.length} ───`).join('\n\n').replace(/\n\n─── parte \d+\/\d+ ───$/, '');
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
  const creds: any = getCreds(evo);
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

// Envia múltiplas mensagens em sequência com pequeno atraso entre cada,
// para o WhatsApp não as agrupar e a ordem ser respeitada.
// Devolve true se pelo menos a 1ª parte foi entregue.
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
async function sendDigestParts(workspace: any, destination: string, parts: string[]): Promise<boolean> {
  if (parts.length === 0) return false;
  const firstOk = await sendWhatsAppToDestination(workspace, destination, parts[0]);
  for (let i = 1; i < parts.length; i++) {
    await sleep(900);
    await sendWhatsAppToDestination(workspace, destination, parts[i]);
  }
  return firstOk;
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
      const parts = buildMessageParts(u.name, buckets, template);
      if (!parts) continue;
      const ok = await sendDigestParts(workspace, destination, parts);
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
      // Verificar se hoje é um dos dias seleccionados (default: todos os dias)
      const weekdays: number[] = Array.isArray(ws.dailyDigestWeekdays)
        ? ws.dailyDigestWeekdays as number[]
        : [0, 1, 2, 3, 4, 5, 6];
      if (!weekdays.includes(t.weekday)) continue;

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

// Notificação imediata via WhatsApp quando um contacto ou lead é atribuído a um utilizador.
// Envia para digestGroupJid (grupo) ou phone (fallback), tal como o digest diário.
export async function notifyWhatsAppAssignment(
  workspaceId: string,
  assignedToId: string,
  entityType: 'contact' | 'lead',
  entityId: string,
): Promise<void> {
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: assignedToId }, select: { name: true, digestGroupJid: true, phone: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  if (!user || !workspace) return;
  if (!(workspace as any).assignmentNotifyEnabled) return;

  const destination = (user.digestGroupJid && user.digestGroupJid.trim()) || (user.phone && user.phone.trim()) || '';
  if (!destination) return;

  let message = '';
  const firstName = user.name.split(' ')[0];

  if (entityType === 'contact') {
    const contact = await prisma.contact.findUnique({
      where: { id: entityId },
      select: { firstName: true, lastName: true, phone: true },
    });
    if (!contact) return;
    const name = `${contact.firstName} ${contact.lastName || ''}`.trim();
    message = `👤 *${firstName}*, foi-te atribuído um contacto:\n*${name}*${contact.phone ? `\n📞 ${contact.phone}` : ''}`;
  } else {
    const lead = await prisma.lead.findUnique({
      where: { id: entityId },
      include: {
        contact: { select: { firstName: true, lastName: true } },
        stage: { select: { name: true } },
        pipeline: { select: { name: true } },
      },
    });
    if (!lead) return;
    const contactLine = lead.contact ? `\n👤 ${`${lead.contact.firstName} ${lead.contact.lastName || ''}`.trim()}` : '';
    const stageLine = lead.pipeline && lead.stage ? `\n📋 ${lead.pipeline.name} › ${lead.stage.name}` : '';
    message = `🎯 *${firstName}*, foi-te atribuído um lead:\n*${lead.title}*${contactLine}${stageLine}`;
  }

  await sendWhatsAppToDestination(workspace, destination, message);
}

// Envia uma mensagem de exemplo de atribuição ao próprio utilizador (para testar a configuração).
export async function testAssignmentNotifyForUser(workspaceId: string, userId: string): Promise<{ ok: boolean; reason?: string }> {
  const [user, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, digestGroupJid: true, phone: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId } }),
  ]);
  if (!user || !workspace) return { ok: false, reason: 'Utilizador ou workspace não encontrado.' };

  const destination = (user.digestGroupJid && user.digestGroupJid.trim()) || (user.phone && user.phone.trim()) || '';
  if (!destination) return { ok: false, reason: 'Utilizador sem grupo WhatsApp nem telefone configurado no perfil.' };

  const firstName = user.name.split(' ')[0];
  const message = `🔔 *Teste de notificação de atribuição*\n\n🎯 *${firstName}*, foi-te atribuído um lead:\n*Proposta de Exemplo*\n👤 Cliente Teste\n📋 Pipeline Principal › Proposta Enviada`;

  const ok = await sendWhatsAppToDestination(workspace, destination, message);
  return ok ? { ok: true } : { ok: false, reason: 'Falha ao enviar via Evolution. Verifica se a instância está ligada.' };
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
    const parts = buildMessageParts(u.name, buckets, template);
    if (!parts) continue;
    const ok = await sendDigestParts(workspace, destination, parts);
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
