import { Lead } from './api';

// Pontuação de lead (0-100) calculada a partir de sinais sempre presentes:
// prioridade, valor, estado e recência. Mantém consistência entre o pipeline
// e a lista (não depende da etapa, que nem sempre vem nos dois sítios).
export interface LeadScoreResult { score: number; label: string; color: string; bg: string; }

const PRIORITY: Record<string, number> = { LOW: 8, MEDIUM: 18, HIGH: 30, URGENT: 40 };

export function computeLeadScore(lead: Partial<Lead>): LeadScoreResult {
  if (lead.status === 'WON') return { score: 100, label: 'Ganho', color: '#2D4A3E', bg: 'rgba(45,74,62,0.16)' };
  if (lead.status === 'LOST') return { score: 0, label: 'Frio', color: '#6B7280', bg: 'var(--surface-3)' };

  let s = PRIORITY[lead.priority as string] ?? 12;

  const v = Number(lead.value) || 0;
  if (v > 0) s += Math.min(Math.round(Math.log10(v + 1) * 8), 30);

  const ref = lead.updatedAt || lead.createdAt;
  if (ref) {
    const days = (Date.now() - new Date(ref).getTime()) / 86400000;
    if (days <= 2) s += 20; else if (days <= 7) s += 14; else if (days <= 30) s += 6;
  }

  s = Math.max(0, Math.min(100, Math.round(s)));
  if (s >= 60) return { score: s, label: 'Quente', color: '#C8553D', bg: 'rgba(200,85,61,0.15)' };
  if (s >= 35) return { score: s, label: 'Morno', color: '#B45309', bg: 'rgba(229,143,101,0.18)' };
  return { score: s, label: 'Frio', color: '#6B7280', bg: 'var(--surface-3)' };
}

export function LeadScoreBadge({ lead, compact }: { lead: Partial<Lead>; compact?: boolean }) {
  const r = computeLeadScore(lead);
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{ background: r.bg, color: r.color }}
      title={`Pontuação ${r.score}/100 · ${r.label}`}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, display: 'inline-block' }} />
      {r.score}{compact ? '' : ` · ${r.label}`}
    </span>
  );
}
