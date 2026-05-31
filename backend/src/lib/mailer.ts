import nodemailer from 'nodemailer';


import prisma from './prisma';
import { getCreds, encryptForStore } from './integrationCrypto';
interface SendArgs {
  workspaceId: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

// Tenta enviar email usando integração SMTP da workspace.
// Devolve { sent: boolean, reason?: string } - nunca lanca para não bloquear fluxo.
export async function sendEmail({ workspaceId, to, subject, html, text }: SendArgs): Promise<{ sent: boolean; reason?: string }> {
  try {
    const integration = await prisma.integration.findFirst({
      where: { workspaceId, type: 'EMAIL_SMTP', isActive: true },
    });
    const creds: any = getCreds(integration);
    if (!creds.host || !creds.user || !creds.pass) {
      return { sent: false, reason: 'SMTP não configurado' };
    }
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: Number(creds.port || 587),
      secure: !!creds.secure,
      auth: { user: creds.user, pass: creds.pass },
    });
    await transporter.sendMail({
      from: creds.fromName ? `"${creds.fromName}" <${creds.fromEmail || creds.user}>` : (creds.fromEmail || creds.user),
      to, subject, html, text,
    });
    return { sent: true };
  } catch (e: any) {
    console.error('sendEmail error:', e?.message || e);
    return { sent: false, reason: e?.message || 'Erro' };
  }
}

// Renderiza template substituindo {{var}}
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

// Templates por defeito caso não haja override
export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  welcome: {
    subject: 'Bem-vindo a {{workspaceName}}',
    body: `<p>Ola {{name}},</p><p>A tua conta foi criada. Podes entrar em {{loginUrl}}.</p><p>Cumprimentos.</p>`,
  },
  password_reset: {
    subject: 'Reposicao de password',
    body: `<p>Ola {{name}},</p><p>Clica neste link para definir uma nova password (valido 1 hora):</p><p><a href="{{link}}">{{link}}</a></p><p>Se não foste tu, ignora este email.</p>`,
  },
  invite: {
    subject: 'Foste convidado para {{workspaceName}}',
    body: `<p>Ola {{name}},</p><p>Foste convidado a entrar para {{workspaceName}}. Clica no link para criar a tua password:</p><p><a href="{{link}}">{{link}}</a></p>`,
  },
  csat: {
    subject: 'Como foi o nosso atendimento?',
    body: `<p>Ola {{name}},</p><p>Avalia o atendimento aqui: <a href="{{link}}">{{link}}</a></p>`,
  },
  lead_assigned: {
    subject: 'Novo lead atribuido: {{leadTitle}}',
    body: `<p>Ola {{name}},</p><p>Foi-te atribuido o lead "{{leadTitle}}". Acede ao CRM para responder.</p>`,
  },
  task_overdue: {
    subject: 'Tarefa atrasada: {{taskTitle}}',
    body: `<p>Ola {{name}},</p><p>A tarefa "{{taskTitle}}" esta atrasada. Por favor verifica.</p>`,
  },
};

export async function sendSystemEmail(
  workspaceId: string,
  type: keyof typeof DEFAULT_TEMPLATES,
  to: string,
  vars: Record<string, string>
): Promise<{ sent: boolean; reason?: string }> {
  const override = await prisma.systemEmailTemplate.findFirst({
    where: { workspaceId, type, enabled: true },
  });
  const tpl = override || DEFAULT_TEMPLATES[type];
  if (!tpl) return { sent: false, reason: 'Template não encontrado' };
  const subject = renderTemplate(tpl.subject, vars);
  const html = renderTemplate(tpl.body, vars);
  return sendEmail({ workspaceId, to, subject, html });
}
