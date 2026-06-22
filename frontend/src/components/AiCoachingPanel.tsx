// Painel "Treinar IA" da aba IA Vendedora.
//
// Tem duas zonas:
//  - Chat com o coach (esquerda): conversa que cria/edita regras estruturadas
//  - Lista de regras (direita): activar/desactivar, editar, apagar, ver origem
//
// Modo confianca: regras auto-aprendidas pelo job nocturno aparecem com
// badge laranja e podem ser desactivadas em massa se o admin quiser rever.

import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Sparkles, Trash2, Power, RefreshCw, GraduationCap, Bot, User as UserIcon, Plus, Wand2, MessageCircle } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

type RuleSource = 'coach_chat' | 'auto_learned' | 'manual';

interface CoachingRule {
  id: string;
  situation: string;
  recommendedAction: string;
  examples: Array<{ leadMessage: string; aiResponse: string }>;
  tone: string | null;
  category: string | null;
  keywords: string[];
  source: RuleSource;
  confidence: number;
  isActive: boolean;
  priority: number;
  timesApplied: number;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  rulesCreated?: string[];
  rulesUpdated?: string[];
}

interface Stats {
  total: number;
  active: number;
  autoLearned: number;
  coachTaught: number;
  manual: number;
  mostUsed: Array<{ id: string; situation: string; timesApplied: number; lastAppliedAt: string | null }>;
}

const SOURCE_LABEL: Record<RuleSource, string> = {
  coach_chat: 'Ensinada',
  auto_learned: 'Auto-aprendida',
  manual: 'Manual',
};

const SOURCE_COLOR: Record<RuleSource, { bg: string; fg: string }> = {
  coach_chat: { bg: '#DBEAFE', fg: '#1E40AF' },
  auto_learned: { bg: '#FED7AA', fg: '#9A3412' },
  manual: { bg: '#E5E7EB', fg: '#374151' },
};

export default function AiCoachingPanel() {
  const [rules, setRules] = useState<CoachingRule[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | RuleSource>('all');
  const [filterActive, setFilterActive] = useState<'all' | 'true' | 'false'>('all');
  const [loadingRules, setLoadingRules] = useState(true);

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [autoLearning, setAutoLearning] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const loadRules = async () => {
    setLoadingRules(true);
    try {
      const params: any = {};
      if (filterSource !== 'all') params.source = filterSource;
      if (filterActive !== 'all') params.active = filterActive;
      const { data } = await api.get('/ai-coaching/rules', { params });
      setRules(data.rules || []);
    } catch {
      toast.error('Erro ao carregar regras');
    } finally { setLoadingRules(false); }
  };

  const loadStats = async () => {
    try {
      const { data } = await api.get('/ai-coaching/stats');
      setStats(data);
    } catch { /* nao bloqueia */ }
  };

  useEffect(() => { loadRules(); }, [filterSource, filterActive]);
  useEffect(() => { loadStats(); }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const next: ChatMessage[] = [...chat, { role: 'user', content: text }];
    setChat(next);
    setInput('');
    try {
      const { data } = await api.post('/ai-coaching/chat', {
        conversationId,
        message: text,
      });
      setConversationId(data.conversationId);
      setChat(data.messages || next);
      if ((data.newRules || []).length > 0) {
        toast.success(`${data.newRules.length} regra(s) criada(s)`);
        loadRules();
        loadStats();
      } else if ((data.actionsApplied || []).some((a: any) => a.ok)) {
        loadRules();
        loadStats();
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'O coach nao respondeu');
      // remove a mensagem do user para o utilizador tentar de novo
      setChat(chat);
      setInput(text);
    } finally { setSending(false); }
  };

  const newSession = () => {
    setChat([]);
    setConversationId(null);
    setInput('');
  };

  const toggleRule = async (rule: CoachingRule) => {
    try {
      await api.patch(`/ai-coaching/rules/${rule.id}`, { isActive: !rule.isActive });
      setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
      loadStats();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao alternar regra');
    }
  };

  const deleteRule = async (rule: CoachingRule) => {
    if (!confirm('Apagar esta regra? Esta accao nao se desfaz.')) return;
    try {
      await api.delete(`/ai-coaching/rules/${rule.id}`);
      setRules((rs) => rs.filter((r) => r.id !== rule.id));
      loadStats();
      toast.success('Regra apagada');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao apagar');
    }
  };

  const runAutoLearn = async () => {
    setAutoLearning(true);
    try {
      const { data } = await api.post('/ai-coaching/auto-learn/run', {});
      if (data.created > 0) {
        toast.success(`${data.created} regra(s) aprendida(s) automaticamente`);
        loadRules();
        loadStats();
      } else {
        toast(data.reason || 'Sem padroes claros nas ultimas 24h', { icon: 'i' });
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro no auto-learning');
    } finally { setAutoLearning(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* Chat com o coach */}
      <div className="card p-0 lg:col-span-3 flex flex-col" style={{ minHeight: 560, maxHeight: 720 }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <GraduationCap size={18} style={{ color: 'var(--primary)' }} />
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Treinar a IA</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Conversa com o coach. Descreve uma situacao e ele cria a regra contigo.
              </p>
            </div>
          </div>
          <button
            onClick={newSession}
            className="text-xs px-2 py-1 rounded hover:bg-black/5 flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Plus size={12} /> Nova sessao
          </button>
        </div>

        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: 'var(--surface-2)' }}>
          {chat.length === 0 && (
            <div className="text-center py-10">
              <Sparkles size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Comeca a treinar a tua IA.</p>
              <p className="text-xs mt-2 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
                Exemplos do que podes dizer:
              </p>
              <div className="mt-3 space-y-1.5 max-w-md mx-auto text-left">
                {[
                  'Quando o lead pergunta o preco antes de ver o produto, responde primeiro com uma pergunta de descoberta',
                  'Sempre que mencionarem "demo" ou "demonstracao", oferece marcar uma chamada de 15 minutos',
                  'Se o lead disser que e da S2S, mostra solidariedade e oferece desconto de 20%',
                ].map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(s)}
                    className="block w-full text-left text-xs px-3 py-2 rounded hover:bg-black/5"
                    style={{ color: 'var(--text-secondary)', border: '1px dashed var(--border)' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: m.role === 'user' ? 'var(--primary)' : 'var(--surface)' }}
              >
                {m.role === 'user'
                  ? <UserIcon size={14} color="#fff" />
                  : <Bot size={14} style={{ color: 'var(--primary)' }} />}
              </div>
              <div
                className="max-w-[75%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap"
                style={{
                  background: m.role === 'user' ? 'var(--primary)' : 'var(--surface)',
                  color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                }}
              >
                {m.content}
                {(m.rulesCreated && m.rulesCreated.length > 0) && (
                  <div className="mt-2 pt-2 border-t border-white/20 text-[11px] flex items-center gap-1" style={{ color: m.role === 'user' ? '#fff' : 'var(--primary)' }}>
                    <Wand2 size={11} /> {m.rulesCreated.length} regra(s) gravada(s)
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex gap-2">
              <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--surface)' }}>
                <Bot size={14} style={{ color: 'var(--primary)' }} />
              </div>
              <div className="px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <Loader2 size={12} className="animate-spin" /> a pensar
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex gap-2">
            <textarea
              className="input-base flex-1 resize-none"
              rows={2}
              placeholder="Descreve uma situacao e como queres que a IA reaja..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              disabled={sending}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="btn btn-primary px-3"
              title="Enviar (Enter)"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de regras */}
      <div className="lg:col-span-2 space-y-3">
        {stats && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Regras gravadas</p>
              <button
                onClick={runAutoLearn}
                disabled={autoLearning}
                className="text-[11px] px-2 py-1 rounded hover:bg-black/5 flex items-center gap-1"
                style={{ color: 'var(--text-secondary)' }}
                title="Forca o job de auto-aprendizagem a correr agora"
              >
                {autoLearning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Auto-aprender agora
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--primary)' }}>{stats.active}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>activas</p>
              </div>
              <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stats.coachTaught}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>ensinadas</p>
              </div>
              <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                <p className="text-lg font-bold" style={{ color: '#F97316' }}>{stats.autoLearned}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>auto-aprend.</p>
              </div>
              <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stats.total}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>total</p>
              </div>
            </div>
          </div>
        )}

        <div className="card p-3">
          <div className="flex gap-2 flex-wrap mb-3">
            {(['all', 'coach_chat', 'auto_learned', 'manual'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSource(s)}
                className="text-[11px] px-2 py-1 rounded"
                style={{
                  background: filterSource === s ? 'var(--primary)' : 'var(--surface-2)',
                  color: filterSource === s ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {s === 'all' ? 'Todas' : SOURCE_LABEL[s as RuleSource]}
              </button>
            ))}
            <span className="mx-1" style={{ color: 'var(--border)' }}>|</span>
            {(['all', 'true', 'false'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterActive(s)}
                className="text-[11px] px-2 py-1 rounded"
                style={{
                  background: filterActive === s ? 'var(--primary)' : 'var(--surface-2)',
                  color: filterActive === s ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {s === 'all' ? 'Estado' : s === 'true' ? 'Activas' : 'Inactivas'}
              </button>
            ))}
          </div>

          {loadingRules ? (
            <div className="py-8 text-center"><Loader2 className="animate-spin inline" size={16} style={{ color: 'var(--text-muted)' }} /></div>
          ) : rules.length === 0 ? (
            <div className="py-8 text-center">
              <MessageCircle size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem regras ainda. Comeca a treinar a IA no chat ao lado.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {rules.map((r) => {
                const c = SOURCE_COLOR[r.source];
                return (
                  <div
                    key={r.id}
                    className="rounded-lg p-3 text-sm"
                    style={{
                      background: r.isActive ? 'var(--surface)' : 'var(--surface-2)',
                      border: `1px solid ${r.isActive ? 'var(--border)' : 'var(--border)'}`,
                      opacity: r.isActive ? 1 : 0.6,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold"
                        style={{ background: c.bg, color: c.fg }}
                      >
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleRule(r)}
                          title={r.isActive ? 'Desactivar' : 'Activar'}
                          className="p-1 rounded hover:bg-black/5"
                          style={{ color: r.isActive ? '#16A34A' : 'var(--text-muted)' }}
                        >
                          <Power size={13} />
                        </button>
                        <button
                          onClick={() => deleteRule(r)}
                          title="Apagar"
                          className="p-1 rounded hover:bg-black/5"
                          style={{ color: '#DC2626' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                      Quando {r.situation}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.recommendedAction}
                    </p>
                    {r.keywords && r.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.keywords.slice(0, 6).map((k) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>{k}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {r.category && <span>cat: {r.category}</span>}
                      <span>usada {r.timesApplied}x</span>
                      {r.source === 'auto_learned' && <span>conf {(r.confidence * 100).toFixed(0)}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
