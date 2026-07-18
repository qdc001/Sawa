// Contexto do paciente para injectar no prompt da Leizy (Sprint 1 do
// cumprimento do manual).
//
// Consolida numa string curta e accionavel:
//   - Dados basicos (idade, plano de saude, alergias)
//   - Historico de consultas (numero, ultima, proxima)
//   - Volume de comunicacao (mensagens totais)
//
// Alergias e outros custom fields "criticos" ficam destacados (LIMITE
// CLINICO) para a Leizy nao ignorar. O peso computacional deste bloco
// e negligenciavel: 1 query ao Contact + 1 ao Appointment + 1 ao
// CustomFieldValue.

import prisma from './prisma';

// Chaves de custom fields que devem aparecer com destaque no prompt.
// Sao os do preset de clinica em workspacePresets.ts.
const CRITICAL_FIELDS = new Set(['allergies', 'medication', 'emergency_contact']);
const INFO_FIELDS = new Set(['birth_date', 'gender', 'health_plan', 'nuit']);

interface PatientContext {
  block: string;         // texto pronto para injectar no prompt
  hasCriticalInfo: boolean; // true se ha alergias ou medicacao registada
  pipelineInstructions?: string; // instrucao especifica do pipeline (se houver)
}

export async function buildPatientContextBlock(
  workspaceId: string,
  contactId: string,
  leadId?: string | null,
): Promise<PatientContext> {
  // Se leadId nao dado, tenta encontrar o lead OPEN mais recente deste contacto.
  // Assim a Leizy sempre "sabe" em que pipeline o contacto esta a ser tratado.
  let activeLead: {
    id: string;
    title: string;
    status: string;
    pipeline: { id: string; name: string; aiInstructions: string | null };
    stage: { id: string; name: string; type: string };
  } | null = null;

  if (leadId) {
    activeLead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId },
      select: {
        id: true, title: true, status: true,
        pipeline: { select: { id: true, name: true, aiInstructions: true } },
        stage: { select: { id: true, name: true, type: true } },
      },
    });
  }
  if (!activeLead) {
    // fallback: lead OPEN mais recente deste contacto neste workspace
    activeLead = await prisma.lead.findFirst({
      where: { workspaceId, contactId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, status: true,
        pipeline: { select: { id: true, name: true, aiInstructions: true } },
        stage: { select: { id: true, name: true, type: true } },
      },
    });
  }

  const [contact, cfValues, appts, msgCount] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { firstName: true, lastName: true, city: true, notes: true, createdAt: true },
    }),
    prisma.customFieldValue.findMany({
      where: { contactId, field: { workspaceId, entity: 'contact' } },
      include: { field: { select: { key: true, name: true, type: true } } },
    }),
    prisma.appointment.findMany({
      where: { workspaceId, contactId },
      orderBy: { startsAt: 'desc' },
      take: 20,
      select: { id: true, title: true, startsAt: true, status: true, notes: true },
    }),
    prisma.message.count({ where: { contactId, contact: { workspaceId } } }),
  ]);

  if (!contact) {
    return { block: '', hasCriticalInfo: false };
  }

  const parts: string[] = [];
  const contactName = `${contact.firstName}${contact.lastName ? ' ' + contact.lastName : ''}`;
  parts.push(`Paciente: ${contactName}`);

  // Pipeline e fase actual do lead (util para adaptar tom/prioridade a fase).
  if (activeLead) {
    parts.push(
      `Estado comercial:\n` +
      `- Lead: "${activeLead.title}" (${activeLead.status})\n` +
      `- Pipeline: ${activeLead.pipeline.name}\n` +
      `- Fase actual: ${activeLead.stage.name}${activeLead.stage.type !== 'REGULAR' ? ` (${activeLead.stage.type})` : ''}`
    );
  }

  // Custom fields criticos (destacados)
  const criticalLines: string[] = [];
  const infoLines: string[] = [];
  let hasCritical = false;

  for (const v of cfValues) {
    const key = v.field.key;
    const value = String(v.value || '').trim();
    if (!value) continue;

    if (CRITICAL_FIELDS.has(key)) {
      criticalLines.push(`- ${v.field.name.toUpperCase()}: ${value}`);
      hasCritical = true;
    } else if (INFO_FIELDS.has(key)) {
      // Idade: se e birth_date, calcular
      if (key === 'birth_date') {
        const age = calcAge(value);
        if (age !== null) {
          infoLines.push(`- Idade: ${age} anos`);
        }
      } else {
        infoLines.push(`- ${v.field.name}: ${value}`);
      }
    }
  }

  if (criticalLines.length > 0) {
    parts.push('AVISO CLINICO (referir ao medico, nunca tratar directamente):\n' + criticalLines.join('\n'));
  }
  if (infoLines.length > 0) {
    parts.push('Dados do paciente:\n' + infoLines.join('\n'));
  }

  // Historico de consultas
  if (appts.length > 0) {
    const past = appts.filter((a) => a.status === 'COMPLETED');
    const future = appts.filter((a) => a.startsAt.getTime() > Date.now() && (a.status === 'SCHEDULED' || a.status === 'CONFIRMED'));
    const totalConsultas = past.length;
    const historyLines: string[] = [];
    historyLines.push(`- Total de consultas realizadas: ${totalConsultas}`);

    if (past.length > 0) {
      const last = past[0];
      const daysAgo = Math.floor((Date.now() - last.startsAt.getTime()) / (1000 * 60 * 60 * 24));
      historyLines.push(`- Ultima consulta: "${last.title}" ha ${daysAgo} dia(s)${last.notes ? ` (nota do medico: "${last.notes.slice(0, 200)}")` : ''}`);
    }
    if (future.length > 0) {
      const next = future[future.length - 1]; // future is desc, so last is closest
      const daysFrom = Math.floor((next.startsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      historyLines.push(`- Proxima consulta: "${next.title}" em ${daysFrom} dia(s) (${next.status})`);
    }
    parts.push('Historico clinico:\n' + historyLines.join('\n'));
  } else {
    const daysSinceRegistered = Math.floor((Date.now() - contact.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceRegistered <= 1) {
      parts.push('Historico clinico:\n- Primeiro contacto com a clinica (sem consultas ainda)');
    } else {
      parts.push(`Historico clinico:\n- Sem consultas registadas. Contacto criado ha ${daysSinceRegistered} dia(s)`);
    }
  }

  // Volume de comunicacao
  parts.push(`Volume de comunicacao: ${msgCount} mensagem(ns) trocadas ao longo do relacionamento.`);

  // Notas manuais gerais do contacto (se admin escreveu algo)
  if (contact.notes && contact.notes.trim().length > 0) {
    parts.push(`Notas internas sobre o paciente:\n${contact.notes.trim().slice(0, 500)}`);
  }

  return {
    block: parts.join('\n\n'),
    hasCriticalInfo: hasCritical,
    pipelineInstructions: activeLead?.pipeline.aiInstructions?.trim() || undefined,
  };
}

function calcAge(birthDateStr: string): number | null {
  const d = new Date(birthDateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
