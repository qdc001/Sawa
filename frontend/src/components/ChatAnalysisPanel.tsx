import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Search, AlertTriangle, Sparkles, MessageCircle } from 'lucide-react';
import api from '../lib/api';

type Issue = { type: string; severity: 1 | 2 | 3; label: string; detail: string };
type AiSummary = { resumo: string; risco: 'baixo' | 'medio' | 'alto'; problemas: string[]; accao_sugerida: string };
type FlaggedChat = {
  contactId: string; name: string; code: string | null; owner: string | null;
  score: number; level: 'alto' | 'medio' | 'baixo'; waitingHours: number | null;
  issues: Issue[]; lastMessage: { direction: string; content: string; at: string } | null;
  ai?: AiSummary | null;
};
type Result = {
  days: number; analysed: number; truncated: boolean; flaggedCount: number; aiNote: string | null;
  conversations: FlaggedChat[];
};

const LEVEL_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  alto: { bg: '#FEE2E2', fg: '#991B1B', label: 'Alto' },
  medio: { bg: '#FEF3C7', fg: '#92400E', label: 'Médio' },
  baixo: { bg: '#E0F2FE', fg: '#075985', label: 'Baixo' },
};
const SEV_COLOR: Record<number, { bg: string; fg: string }> = {
  1: { bg: '#E0F2FE', fg: '#075985' },
  2: { bg: '#FEF3C7', fg: '#92400E' },
  3: { bg: '#FEE2E2', fg: '#991B1B' },
};
const RANGES = [
  { v: 1, label: 'Últimas 24h' },
  { v: 2, label: 'Últimas 48h' },
  { v: 7, label: 'Últimos 7 dias' },
  { v: 14, label: 'Últimos 14 dias' },
  { v: 30, label: 'Últimos 30 dias' },
];

export default function ChatAnalysisPanel() {
  const navigate = useNavigate();
  const [days, setDays] = useState(2);
  const [useAi, setUseAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const analyse = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/chat-analysis?days=${days}${useAi ? '&ai=true' : ''}`);
      setResult(data);
      if (data.aiNote) toast(data.aiNote, { icon: '⚠️', duration: 6000 });
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a analisar as conversas');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle size={16} style={{ color: '#F59E0B' }} /> Análise de conversas</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Procura sinais de problema nas conversas com actividade no período: clientes sem resposta, a insistir, com reclamações, promessas por cumprir e respostas lentas. Grupos de WhatsApp ficam de fora.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input-base" style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}>
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Envia o fim das conversas mais graves ao serviço de IA para um resumo e uma acção sugerida. Gasta tokens de IA.">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            <Sparkles size={12} /> Resumo com IA (até 8 conversas)
          </label>
          <button onClick={analyse} disabled={loading} className="text-sm px-3 py-1.5 rounded font-medium flex items-center gap-1.5" style={{ background: 'var(--primary)', color: '#fff' }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Analisar
          </button>
        </div>
      </div>

      {result && (
        <>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            <b>{result.analysed}</b> conversas analisadas · <b style={{ color: result.flaggedCount ? '#B45309' : '#047857' }}>{result.flaggedCount}</b> com possíveis problemas
            {result.truncated && ' (período muito grande: só foram lidas as mensagens mais antigas)'}
          </p>
          {result.conversations.length === 0 && (
            <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Nenhum problema detectado neste período.</div>
          )}
          {result.conversations.map((c) => {
            const lv = LEVEL_STYLE[c.level];
            return (
              <div key={c.contactId} className="card p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{c.name}</span>
                      {c.code && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>{c.code}</span>}
                      <span className="text-[11px] px-2 py-0.5 rounded font-medium" style={{ background: lv.bg, color: lv.fg }}>Gravidade {lv.label}</span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Responsável: {c.owner || 'sem responsável'}</p>
                  </div>
                  <button onClick={() => navigate(`/inbox?contactId=${c.contactId}`)} className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                    <MessageCircle size={12} /> Abrir conversa
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {c.issues.map((i, idx) => (
                    <span key={idx} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: SEV_COLOR[i.severity].bg, color: SEV_COLOR[i.severity].fg }} title={i.detail}>{i.label}</span>
                  ))}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {c.issues.map((i, idx) => <li key={idx}>• {i.detail}</li>)}
                </ul>

                {c.lastMessage && (
                  <p className="text-xs mt-2 truncate" style={{ color: 'var(--text-muted)' }}>
                    Última mensagem ({c.lastMessage.direction === 'INBOUND' ? 'cliente' : 'nós'}, {new Date(c.lastMessage.at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}): "{c.lastMessage.content}"
                  </p>
                )}

                {c.ai && (
                  <div className="mt-3 p-3 rounded text-xs space-y-1" style={{ background: 'var(--surface-2)' }}>
                    <p className="font-semibold flex items-center gap-1"><Sparkles size={12} /> IA · risco {c.ai.risco}</p>
                    <p>{c.ai.resumo}</p>
                    {c.ai.problemas?.length > 0 && <p><b>Problemas:</b> {c.ai.problemas.join('; ')}</p>}
                    <p><b>Sugestão:</b> {c.ai.accao_sugerida}</p>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
