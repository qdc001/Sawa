import { useEffect, useState } from 'react';
import { Sparkles, Loader2, Save, RefreshCw, BookOpen, Building2, MessageSquare, Brain, ChevronRight, GraduationCap } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import AiCoachingPanel from '../components/AiCoachingPanel';
import AiUsageBars from '../components/AiUsageBars';
import { useAuthStore } from '../store';

type SectorKey = 'imobiliaria' | 'clinica' | 'escola' | 'consultoria' | 'outro';

interface AgentConfig {
  sector: SectorKey;
  aiAgentName: string | null;
  aiAgentRole: string | null;
  aiBrandVoice: string | null;
  aiAgentInstructions: string | null;
  aiLearnedMemory: string | null;
}

interface SectorInfo {
  key: SectorKey;
  label: string;
  objections: number;
  discoveryQuestions: number;
  closingTactics: number;
}

interface Principle {
  key: string;
  book: string;
  author: string;
  title: string;
  summary: string;
}

interface KnowledgePreview {
  sector: { key: SectorKey; label: string };
  activePrinciples: Principle[];
  sourceBooks: { book: string; author: string }[];
  systemPrompt: string;
  stats: { principlesAvailable: number; principlesActive: number; sectorsAvailable: number };
}

type Tab = 'persona' | 'sector' | 'instructions' | 'coach' | 'memory';

export default function SalesAgentPage() {
  const [tab, setTab] = useState<Tab>('persona');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [sectors, setSectors] = useState<SectorInfo[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgePreview | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const workspace = useAuthStore((s) => s.workspace) as any;
  const isClinic = workspace?.sector === 'clinica';

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: cfg }, { data: secs }, { data: kn }] = await Promise.all([
        api.get('/sales-agent/config'),
        api.get('/sales-agent/sectors'),
        api.get('/sales-agent/knowledge'),
      ]);
      setConfig(cfg);
      setSectors(secs);
      setKnowledge(kn);
    } catch {
      toast.error('Erro ao carregar configuração da Leizy');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const update = (patch: Partial<AgentConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...patch });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const { data } = await api.patch('/sales-agent/config', {
        sector: config.sector,
        aiAgentName: config.aiAgentName,
        aiAgentRole: config.aiAgentRole,
        aiBrandVoice: config.aiBrandVoice,
        aiAgentInstructions: config.aiAgentInstructions,
      });
      setConfig(data);
      toast.success('Configuração guardada');
      // Recarregar preview com a nova config
      const { data: kn } = await api.get('/sales-agent/knowledge');
      setKnowledge(kn);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao guardar');
    } finally { setSaving(false); }
  };

  if (loading || !config) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>
            <Sparkles size={22} style={{ color: 'var(--primary)' }} /> Leizy
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            A assistente inteligente do Klaru. Compreende cada conversa, aprende com o teu tom e ajuda a equipa a comunicar melhor com pacientes. Configura a personalidade, o contexto em que opera, instruções específicas e vê a memória que ela vai construindo com o tempo.
          </p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Guardar alterações
        </button>
      </div>

      <AiUsageBars />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        {(([
          { id: 'persona', label: 'Persona', icon: Sparkles },
          // Tab "Sector" so aparece se nao for uma clinica: em clinicas o
          // preset ja fixou o sector e nao ha valor em mudar aqui.
          !isClinic && { id: 'sector' as Tab, label: 'Sector', icon: Building2 },
          { id: 'instructions', label: 'Instruções', icon: MessageSquare },
          { id: 'coach', label: 'Treinar Leizy', icon: GraduationCap },
          { id: 'memory', label: 'Memória aprendida', icon: Brain },
        ].filter(Boolean)) as { id: Tab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="px-3 py-2 text-sm font-medium whitespace-nowrap flex items-center gap-1.5"
            style={{
              color: tab === id ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === id ? 'var(--primary)' : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'coach' ? (
        <AiCoachingPanel />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {tab === 'persona' && (
            <div className="card p-5">
              <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Quem é a Leizy</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Dá-lhe nome e papel. Em conversas, ela apresenta-se desta forma quando faz sentido. Recomendado: recepcionista virtual, assistente de agendamento, apoio ao paciente.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Nome</label>
                  <input
                    className="input-base w-full mt-1"
                    placeholder="Ex: Sandra, Klaru, António"
                    value={config.aiAgentName || ''}
                    onChange={(e) => update({ aiAgentName: e.target.value })}
                    maxLength={60}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Papel</label>
                  <input
                    className="input-base w-full mt-1"
                    placeholder="Ex: recepcionista virtual, assistente de agendamento, apoio ao paciente"
                    value={config.aiAgentRole || ''}
                    onChange={(e) => update({ aiAgentRole: e.target.value })}
                    maxLength={60}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Voz da marca e tom</label>
                <textarea
                  className="input-base w-full mt-1"
                  rows={4}
                  placeholder="Descreve em poucas linhas o tom: caloroso, directo, profissional, informal, etc. Ex: Trato sempre o cliente por você. Uso linguagem simples e clara. Evito jargão técnico."
                  value={config.aiBrandVoice || ''}
                  onChange={(e) => update({ aiBrandVoice: e.target.value })}
                  maxLength={2000}
                />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Aplica-se também ao Copilot e à sugestão de resposta.</p>
              </div>
            </div>
          )}

          {tab === 'sector' && (
            <div className="card p-5">
              <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sector de actividade</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                O sector escolhido determina vocabulário, tom e conhecimento contextual que a Leizy usa nas respostas. Para clínicas, ela reencaminha automaticamente sintomas ou pedidos de diagnóstico à equipa clínica.
              </p>
              <div className="space-y-2">
                {sectors.map((s) => {
                  const selected = config.sector === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => update({ sector: s.key })}
                      className="w-full text-left rounded-lg p-3 flex items-center gap-3 transition-colors"
                      style={{
                        background: selected ? 'var(--primary-light)' : 'var(--surface)',
                        border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                      }}
                    >
                      <Building2 size={18} style={{ color: selected ? 'var(--primary)' : 'var(--text-muted)' }} />
                      <div className="flex-1">
                        <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.label}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {s.objections} objecções, {s.discoveryQuestions} perguntas, {s.closingTactics} tácticas de fecho
                        </p>
                      </div>
                      {selected && <ChevronRight size={16} style={{ color: 'var(--primary)' }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'instructions' && (
            <div className="card p-5">
              <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Instruções específicas</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Escreve aqui regras que a Leizy deve cumprir sempre. Tudo o que estiver aqui é injectado no prompt e tem prioridade alta.
                A Leizy tem acesso ao <b>histórico</b> das últimas 30 mensagens, às <b>notas internas</b> da equipa, aos <b>ficheiros</b> anexados, e ao <b>estado</b> do paciente. Podes escrever regras condicionais.
              </p>
              <textarea
                className="input-base w-full"
                rows={12}
                placeholder={`Ex:\n- Nunca dês diagnóstico. Se o paciente descrever sintomas, responde com empatia e reencaminha "vou passar a sua mensagem à equipa clínica".\n- Se o paciente pedir marcação, verifica disponibilidade e propõe 2 horários.\n- Se o paciente perguntar preço, envia a tabela geral e sugere avaliação para orçamento personalizado.\n- Confirmações de consulta: sempre com data, hora e endereço.\n- Nunca escrevas em tom informal com pacientes idosos; usa "você".`}
                value={config.aiAgentInstructions || ''}
                onChange={(e) => update({ aiAgentInstructions: e.target.value })}
                maxLength={8000}
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {(config.aiAgentInstructions || '').length} / 8000 caracteres
              </p>
            </div>
          )}

          {tab === 'memory' && (
            <div className="card p-5">
              <h2 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Memória aprendida</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Aqui aparecem padrões que a Leizy aprendeu sozinha a partir das tuas correcções e das conversas bem sucedidas. Este texto é gerado pelo job nocturno.
              </p>
              {config.aiLearnedMemory ? (
                <div className="rounded-lg p-4 text-sm whitespace-pre-wrap" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {config.aiLearnedMemory}
                </div>
              ) : (
                <div className="rounded-lg p-6 text-center" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
                  <Brain size={28} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Ainda sem memória aprendida.</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Vai aparecer depois das primeiras conversas em modo Supervisionado.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Painel lateral: conhecimento activo. Em clinicas, escondemos o
            conteudo de "bibliotecas de vendas" (principios Cialdini, Voss,
            Rackham) que nao faz sentido para uma assistente de relacionamento
            com pacientes. A Leizy continua a receber esses principios como
            referencia interna no prompt do sistema. */}
        <aside className="space-y-4">
          {!isClinic && knowledge && (
            <>
              <div className="card p-4">
                <p className="text-xs uppercase font-semibold tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Conhecimento activo</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                    <p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{knowledge.stats.principlesActive}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>princípios activos</p>
                  </div>
                  <div className="rounded p-2 text-center" style={{ background: 'var(--surface-2)' }}>
                    <p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{knowledge.stats.principlesAvailable}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>disponíveis</p>
                  </div>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Sector: <strong>{knowledge.sector.label}</strong>
                </p>
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Bibliotecas</p>
                  <BookOpen size={13} style={{ color: 'var(--text-muted)' }} />
                </div>
                <ul className="space-y-1.5">
                  {knowledge.sourceBooks.map((b) => (
                    <li key={b.book} className="text-xs">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{b.book}</p>
                      <p style={{ color: 'var(--text-muted)' }}>{b.author}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card p-4">
                <p className="text-xs uppercase font-semibold tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Princípios activos agora</p>
                <ul className="space-y-2">
                  {knowledge.activePrinciples.map((p) => (
                    <li key={p.key} className="text-xs">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.title}</p>
                      <p style={{ color: 'var(--text-muted)' }}>{p.author}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                className="text-xs flex items-center gap-1.5 px-3 py-2 rounded hover:bg-black/5 w-full"
                style={{ color: 'var(--text-secondary)' }}
              >
                <RefreshCw size={12} /> {showSystemPrompt ? 'Esconder' : 'Ver'} prompt completo (debug)
              </button>
              {showSystemPrompt && (
                <pre className="card p-3 text-[10px] overflow-auto max-h-80 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', background: 'var(--surface-2)' }}>
                  {knowledge.systemPrompt}
                </pre>
              )}
            </>
          )}
        </aside>
      </div>
      )}
    </div>
  );
}
