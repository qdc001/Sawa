import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Sparkles, MessageCircle, Cpu, Clock, History } from 'lucide-react';
import api from '../lib/api';

type Item = {
  contactId: string; name: string; code: string | null; owner: string | null;
  level: 'alto' | 'medio' | 'baixo'; waitingHours: number | null;
  categories: string[]; summary: string; action: string; source: 'ia' | 'regras';
  lastMessage: { direction: string; content: string; at: string } | null;
};
type Result = {
  days: number; eligible: number; analysed: number; aiAnalysed: number; fallback: number;
  okCount: number; truncated: boolean; conversations: Item[];
};
type RunSummary = { id: string; days: number; analysed: number; attention: number; createdByName: string | null; createdAt: string };
type Viewing = { id: string; days: number; createdByName: string | null; createdAt: string };

const LEVEL_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  alto: { bg: '#FEE2E2', fg: '#991B1B', label: 'Alta' },
  medio: { bg: '#FEF3C7', fg: '#92400E', label: 'Média' },
  baixo: { bg: '#E0F2FE', fg: '#075985', label: 'Baixa' },
};
const RANGES = [
  { v: 1, label: 'Últimas 24h' },
  { v: 2, label: 'Últimas 48h' },
  { v: 7, label: 'Últimos 7 dias' },
  { v: 14, label: 'Últimos 14 dias' },
  { v: 30, label: 'Últimos 30 dias' },
];

function fmtWait(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} dias`;
}

const fmtDate = (d: string) => new Date(d).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
const rangeLabel = (d: number) => RANGES.find((r) => r.v === d)?.label || `Últimos ${d} dias`;

export default function ChatAnalysisPanel() {
  const navigate = useNavigate();
  const [days, setDays] = useState(2);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Sobe a cada pedido de abertura: uma resposta atrasada nao substitui a escolha mais recente.
  const openToken = useRef(0);

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } setRunning(false); };

  const loadHistory = async () => {
    const { data } = await api.get<RunSummary[]>('/chat-analysis/history');
    setHistory(data);
    return data;
  };

  const openRun = async (id: string) => {
    const token = ++openToken.current;
    try {
      const { data } = await api.get(`/chat-analysis/history/${id}`);
      if (token !== openToken.current) return;
      setResult(data.result);
      setViewing({ id: data.id, days: data.days, createdByName: data.createdByName, createdAt: data.createdAt });
    } catch (e: any) {
      if (token === openToken.current) toast.error(e.response?.data?.message || 'Erro a abrir a análise');
    }
  };

  const follow = (jobId: string) => {
    if (timer.current) clearInterval(timer.current);
    setRunning(true);
    timer.current = setInterval(async () => {
      try {
        const { data: j } = await api.get(`/chat-analysis/job/${jobId}`);
        setProgress({ done: j.done, total: j.total });
        if (j.status === 'done') {
          stop();
          if (j.aiNote) toast(j.aiNote, { icon: '⚠️', duration: 7000 });
          if (j.runId) {
            await openRun(j.runId);
            await loadHistory();
          } else {
            setViewing(null);
            setResult(j.result);
          }
        } else if (j.status === 'error') {
          stop();
          toast.error(j.error || 'Erro a analisar as conversas');
        }
      } catch (e: any) {
        stop();
        toast.error(e.response?.data?.message || 'Erro a ler o progresso da análise');
      }
    }, 2000);
  };

  // Ao entrar: mostra a ultima analise guardada ou retoma a que ainda esta a correr.
  useEffect(() => {
    let alive = true;
    const token = openToken.current;
    (async () => {
      try {
        const [runs, { data: current }] = await Promise.all([loadHistory(), api.get('/chat-analysis/running')]);
        if (!alive || token !== openToken.current) return;
        if (current.jobId) follow(current.jobId);
        else if (runs[0]) await openRun(runs[0].id);
      } catch (e: any) {
        if (alive) toast.error(e.response?.data?.message || 'Erro a carregar o histórico de análises');
      }
    })();
    return () => { alive = false; if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyse = async () => {
    openToken.current++;
    setRunning(true);
    setResult(null);
    setViewing(null);
    setProgress({ done: 0, total: 0 });
    try {
      const { data } = await api.post('/chat-analysis/start', { days });
      follow(data.jobId as string);
    } catch (e: any) {
      stop();
      toast.error(e.response?.data?.message || 'Erro a iniciar a análise');
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Sparkles size={16} style={{ color: '#8B5CF6' }} /> Análise de conversas por IA</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          A IA lê as conversas com actividade no período (até 40, primeiro as com mais sinais de problema, sem grupos de WhatsApp) e aponta as que precisam de atenção: clientes sem resposta, a insistir ou insatisfeitos, promessas por cumprir, falhas da equipa e oportunidades em risco. Envia o fim de cada conversa ao serviço de IA e gasta tokens.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={running} className="input-base" style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}>
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <button onClick={analyse} disabled={running} className="text-sm px-3 py-1.5 rounded font-medium flex items-center gap-1.5" style={{ background: 'var(--primary)', color: '#fff', opacity: running ? 0.7 : 1 }}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {running ? 'A analisar...' : 'Analisar com IA'}
          </button>
          {running && progress.total > 0 && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div style={{ width: 140, height: 6, borderRadius: 3, background: 'var(--surface-3)' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--primary)', transition: 'width .3s' }} />
              </div>
              {progress.done}/{progress.total} conversas
            </div>
          )}
        </div>
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}><History size={13} /> Histórico</span>
            <select
              value={viewing?.id || ''}
              onChange={(e) => { if (e.target.value) openRun(e.target.value); }}
              disabled={running}
              className="input-base"
              style={{ width: 'auto', maxWidth: '100%', padding: '4px 8px', fontSize: 13 }}
            >
              {!viewing && <option value="">Escolher análise anterior...</option>}
              {history.map((h) => (
                <option key={h.id} value={h.id}>{fmtDate(h.createdAt)} · {rangeLabel(h.days)} · {h.attention} a precisar de atenção</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {result && (
        <>
          {viewing && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Análise de {fmtDate(viewing.createdAt)} · {rangeLabel(viewing.days)}{viewing.createdByName && ` · feita por ${viewing.createdByName}`}. Mostra a situação nesse momento.
            </p>
          )}
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            <b>{result.analysed}</b> conversas analisadas{result.eligible > result.analysed && ` (de ${result.eligible} com actividade; primeiro as com mais sinais de problema)`} ·{' '}
            <b style={{ color: result.conversations.length ? '#B45309' : '#047857' }}>{result.conversations.length}</b> precisam de atenção · {result.okCount} sem problemas
            {result.fallback > 0 && ` · ${result.fallback} analisadas por regras (a IA falhou)`}
          </p>
          {result.conversations.length === 0 && (
            <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>A IA não encontrou problemas neste período.</div>
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
                      {c.source === 'regras' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }} title="A IA não conseguiu analisar esta conversa; é uma análise automática por regras.">
                          <Cpu size={10} /> regras
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                      <span>Responsável: {c.owner || 'sem responsável'}</span>
                      {c.waitingHours !== null && c.waitingHours >= 1 && <span className="flex items-center gap-0.5"><Clock size={11} /> cliente à espera há {fmtWait(c.waitingHours)}</span>}
                    </p>
                  </div>
                  <button onClick={() => navigate(`/inbox?contactId=${c.contactId}`)} className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                    <MessageCircle size={12} /> Abrir conversa
                  </button>
                </div>

                {c.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {c.categories.map((k, idx) => (
                      <span key={idx} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: lv.bg, color: lv.fg }}>{k}</span>
                    ))}
                  </div>
                )}
                <p className="text-sm mt-2">{c.summary}</p>
                {c.action && <p className="text-xs mt-1.5 p-2 rounded" style={{ background: 'var(--surface-2)' }}><b>Sugestão:</b> {c.action}</p>}

                {c.lastMessage && (
                  <p className="text-xs mt-2 truncate" style={{ color: 'var(--text-muted)' }}>
                    Última mensagem ({c.lastMessage.direction === 'INBOUND' ? 'cliente' : 'nós'}, {new Date(c.lastMessage.at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}): "{c.lastMessage.content}"
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
