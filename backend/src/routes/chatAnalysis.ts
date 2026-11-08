import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { analyzeConversation, ChatMsg, Issue } from '../lib/chatAnalysis';
import { callLlmJson } from '../lib/llmProvider';
import { AiQuotaExceededError } from '../lib/aiUsage';

const router = Router();
const ALLOWED_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];
const MAX_AI_CHATS = 8;
const MAX_MESSAGES = 50000;

type AiSummary = { resumo: string; risco: 'baixo' | 'medio' | 'alto'; problemas: string[]; accao_sugerida: string };

function displayName(c: { firstName: string; lastName: string | null } | null): string {
  if (!c) return 'Contacto';
  return `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`.trim();
}

function transcript(msgs: ChatMsg[]): string {
  return msgs.slice(-30).map((m) => {
    const who = m.direction === 'INBOUND' ? 'Cliente' : 'Equipa';
    const text = (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 300) || `[${m.type || 'anexo'}]`;
    return `${who}: ${text}`;
  }).join('\n');
}

// GET /api/chat-analysis?days=7&ai=true
// Analisa as conversas com actividade nos ultimos N dias e devolve as que
// tem sinais de problema, ordenadas por gravidade. OWNER/ADMIN/MANAGER.
router.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!req.user || !ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: 'Sem permissão para analisar conversas.' });
    }
    const workspaceId = req.user.workspaceId;
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const useAi = req.query.ai === 'true';
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 3600 * 1000);

    const rows = await prisma.message.findMany({
      where: {
        contact: {
          workspaceId,
          OR: [{ whatsapp: null }, { NOT: { whatsapp: { endsWith: '@g.us' } } }],
        },
        isInternal: false,
        type: { not: 'SYSTEM' },
        createdAt: { gte: since },
      },
      select: {
        contactId: true, direction: true, content: true, type: true, createdAt: true, reactions: true,
        contact: {
          select: {
            id: true, firstName: true, lastName: true, assigneeCode: true, assignedToId: true,
            assignedTo: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_MESSAGES,
    });

    const byContact = new Map<string, { contact: (typeof rows)[number]['contact']; msgs: ChatMsg[] }>();
    for (const r of rows) {
      if (!r.contactId || !r.contact) continue;
      let g = byContact.get(r.contactId);
      if (!g) { g = { contact: r.contact, msgs: [] }; byContact.set(r.contactId, g); }
      g.msgs.push({ direction: r.direction as any, content: r.content, type: r.type, createdAt: r.createdAt, reactions: r.reactions });
    }

    const flagged: Array<{
      contactId: string; name: string; code: string | null; owner: string | null;
      score: number; level: 'alto' | 'medio' | 'baixo'; waitingHours: number | null;
      issues: Issue[]; lastMessage: { direction: string; content: string; at: Date } | null;
      ai?: AiSummary | null;
    }> = [];
    const msgsByContact = new Map<string, ChatMsg[]>();

    for (const [contactId, g] of byContact) {
      const a = analyzeConversation(g.msgs, now, { hasOwner: !!g.contact!.assignedToId });
      if (a.issues.length === 0) continue;
      const last = g.msgs[g.msgs.length - 1];
      flagged.push({
        contactId,
        name: displayName(g.contact),
        code: g.contact!.assigneeCode,
        owner: g.contact!.assignedTo?.name || null,
        score: a.score,
        level: a.score >= 10 ? 'alto' : a.score >= 5 ? 'medio' : 'baixo',
        waitingHours: a.waitingHours,
        issues: a.issues,
        lastMessage: last ? { direction: last.direction, content: (last.content || '').slice(0, 120), at: last.createdAt } : null,
      });
      msgsByContact.set(contactId, g.msgs);
    }
    flagged.sort((x, y) => y.score - x.score);

    let aiNote: string | null = null;
    if (useAi && flagged.length > 0) {
      for (const f of flagged.slice(0, MAX_AI_CHATS)) {
        try {
          const { json } = await callLlmJson<AiSummary>(
            null,
            [
              {
                role: 'system',
                content:
                  'És um analista de qualidade de atendimento de uma empresa em Moçambique. Recebes a parte final de uma conversa de WhatsApp entre "Cliente" e "Equipa". ' +
                  'Responde SEMPRE em português de Portugal, em JSON com as chaves: ' +
                  '"resumo" (1-2 frases sobre o que o cliente quer e em que ponto está), ' +
                  '"risco" ("baixo", "medio" ou "alto" de perder o cliente ou ter reclamação), ' +
                  '"problemas" (lista curta, máx. 3, de problemas concretos que vês, vazia se não houver), ' +
                  '"accao_sugerida" (1 frase: o que a equipa deve fazer agora). Sê concreto e não inventes factos que não estejam na conversa.',
              },
              { role: 'user', content: `Problemas já detectados: ${f.issues.map((i) => i.label).join(', ')}.\n\nConversa:\n${transcript(msgsByContact.get(f.contactId) || [])}` },
            ],
            600, 0.2,
            { workspaceId, feature: 'other' },
          );
          f.ai = json && typeof json.resumo === 'string' ? json : null;
        } catch (e: any) {
          f.ai = null;
          if (e instanceof AiQuotaExceededError) { aiNote = e.message; break; }
          aiNote = 'A IA não conseguiu analisar algumas conversas. Mostro só a análise automática.';
        }
      }
    }

    res.json({
      days,
      analysed: byContact.size,
      truncated: rows.length >= MAX_MESSAGES,
      flaggedCount: flagged.length,
      aiNote,
      conversations: flagged.slice(0, 100),
    });
  } catch (e) { next(e); }
});

export default router;
