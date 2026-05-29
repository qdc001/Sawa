import { useState, useEffect } from 'react';
import {
  Plus, Send, Users, Loader2, X, Radio, Trash2, BarChart3, MessageCircle, Mail, AlertCircle, Check,
} from 'lucide-react';
import api, { Broadcast, Tag as TagType } from '../lib/api';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  DRAFT: { bg: '#F1F5F9', color: '#64748B', label: 'Rascunho' },
  SCHEDULED: { bg: '#F6E3DC', color: '#C8553D', label: 'Agendado' },
  SENDING: { bg: '#FEF3C7', color: '#92400E', label: 'A enviar...' },
  COMPLETED: { bg: '#D1FAE5', color: '#065F46', label: 'Concluido' },
  FAILED: { bg: '#FEE2E2', color: '#991B1B', label: 'Falhou' },
  CANCELLED: { bg: '#F3F4F6', color: '#374151', label: 'Cancelado' },
};

const CHANNEL_ICONS: Record<string, any> = { WHATSAPP: MessageCircle, EMAIL: Mail, SMS: Radio };
const CHANNEL_COLORS: Record<string, string> = { WHATSAPP: '#25D366', EMAIL: '#C8553D', SMS: '#F59E0B' };

function NewBroadcastModal({ onClose, onCreated, allTags }: {
  onClose: () => void;
  onCreated: () => void;
  allTags: TagType[];
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('WHATSAPP');
  const [message, setMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name || !message) { toast.error('Preenche todos os campos obrigatorios'); return; }
    setLoading(true);
    try {
      const tagNames = allTags.filter((t) => tagIds.includes(t.id)).map((t) => t.name);
      await api.post('/broadcasts', {
        name, channel, message,
        scheduledAt: scheduledAt || undefined,
        filters: { tags: tagNames },
      });
      toast.success('Broadcast criado!');
      onCreated();
      onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2"><Radio size={16} /> Novo Broadcast</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        <div className="flex gap-2 mb-4">
          {['Configuracao', 'Mensagem', 'Audiencia'].map((s, i) => (
            <div key={s} className="flex-1">
              <div className="h-1 rounded-full mb-1" style={{ background: i + 1 <= step ? 'var(--primary)' : 'var(--border)' }} />
              <p className="text-xs" style={{ color: i + 1 === step ? 'var(--primary)' : 'var(--text-muted)' }}>{s}</p>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nome do Broadcast *</label>
              <input className="input-base" placeholder="Ex: Promocao Marco 2026" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Canal *</label>
              <div className="grid grid-cols-3 gap-2">
                {['WHATSAPP', 'EMAIL', 'SMS'].map((ch) => {
                  const Icon = CHANNEL_ICONS[ch];
                  return (
                    <button key={ch} onClick={() => setChannel(ch)}
                      className="py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1"
                      style={{
                        background: channel === ch ? CHANNEL_COLORS[ch] : 'var(--surface-3)',
                        color: channel === ch ? '#fff' : 'var(--text-secondary)',
                      }}>
                      <Icon size={14} /> {ch}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Agendamento (opcional)</label>
              <input type="datetime-local" className="input-base" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Se deixares vazio, fica em rascunho. Tens de clicar Enviar manualmente.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <label className="block text-sm font-medium mb-1">Mensagem *</label>
            <textarea className="input-base" rows={6}
              placeholder="Ola {{nome}}, temos uma promocao especial para si!"
              value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Variaveis suportadas (substituidas no envio): {'{{nome}}'} (do contacto)
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm">Filtra por tags (opcional). Sem filtros: envia para todos os contactos com {channel === 'WHATSAPP' ? 'WhatsApp' : channel === 'EMAIL' ? 'email' : 'numero'}.</p>
            <div className="flex flex-wrap gap-1.5 p-2 rounded" style={{ background: 'var(--surface-2)', minHeight: 40 }}>
              {allTags.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem tags. Cria nos Contactos.</span>}
              {allTags.map((t) => {
                const sel = tagIds.includes(t.id);
                return (
                  <button key={t.id} onClick={() => setTagIds((p) => sel ? p.filter((x) => x !== t.id) : [...p, t.id])}
                    className="text-xs px-2 py-1 rounded font-medium"
                    style={{
                      background: sel ? t.color : t.color + '22',
                      color: sel ? '#fff' : t.color,
                      border: `1px solid ${t.color}`,
                    }}>
                    {t.name}
                  </button>
                );
              })}
            </div>
            <div className="p-3 rounded text-xs" style={{ background: '#FEF3C7', color: '#92400E' }}>
              <p className="font-semibold mb-1 flex items-center gap-1"><AlertCircle size={12} /> Atencao</p>
              <p>Confirma que os destinatarios consentiram receber mensagens. WhatsApp pode banir numeros que enviam spam.</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {step > 1 && (
            <button onClick={() => setStep((s) => s - 1)} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Anterior</button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep((s) => s + 1)} className="btn btn-primary flex-1 py-2">Proximo</button>
          ) : (
            <button onClick={handleCreate} disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : 'Criar Broadcast'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsModal({ broadcastId, onClose }: { broadcastId: string; onClose: () => void }) {
  const [data, setData] = useState<Broadcast | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all([
      api.get(`/broadcasts/${broadcastId}`),
      api.get(`/broadcasts/${broadcastId}/stats`),
    ]).then(([d, s]) => { setData(d.data); setStats(s.data); });
  }, [broadcastId]);

  if (!data) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold"><BarChart3 size={16} className="inline mr-2" /> {data.name}</h2>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total', value: data.totalRecipients, color: '#C8553D' },
            { label: 'Enviadas', value: stats.SENT || 0, color: '#10B981' },
            { label: 'Falharam', value: stats.FAILED || 0, color: '#EF4444' },
            { label: 'Pendentes', value: stats.PENDING || 0, color: '#F59E0B' },
          ].map((s) => (
            <div key={s.label} className="card p-3 text-center">
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>
        <h3 className="text-sm font-medium mb-2">Destinatarios (ultimos 100)</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {(data.recipients || []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 p-2 rounded text-xs" style={{ background: 'var(--surface-2)' }}>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{r.contact ? `${r.contact.firstName} ${r.contact.lastName || ''}` : r.phone}</p>
                <p style={{ color: 'var(--text-muted)' }}>{r.phone}</p>
              </div>
              <span className="px-2 py-0.5 rounded font-medium"
                style={{
                  background: r.status === 'SENT' ? '#D1FAE5' : r.status === 'FAILED' ? '#FEE2E2' : 'var(--surface-3)',
                  color: r.status === 'SENT' ? '#065F46' : r.status === 'FAILED' ? '#991B1B' : 'var(--text-muted)',
                }}>
                {r.status}
              </span>
              {r.error && <span style={{ color: '#EF4444' }} title={r.error}>!</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [statsId, setStatsId] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<TagType[]>([]);

  const loadBroadcasts = async () => {
    try {
      const { data } = await api.get('/broadcasts');
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch { toast.error('Erro a carregar broadcasts'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadBroadcasts();
    api.get('/tags').then(({ data }) => setAllTags(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const handleSend = async (id: string) => {
    if (!confirm('Iniciar envio? Nao podes parar depois de comecar.')) return;
    setSending(id);
    try {
      await api.post(`/broadcasts/${id}/send`);
      toast.success('Broadcast iniciado');
      loadBroadcasts();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro'); }
    finally { setSending(null); }
  };

  const handleDelete = async (b: Broadcast) => {
    if (!confirm(`Eliminar "${b.name}"?`)) return;
    try {
      await api.delete(`/broadcasts/${b.id}`);
      setBroadcasts((p) => p.filter((x) => x.id !== b.id));
      toast.success('Eliminado');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro'); }
  };

  const stats = {
    total: broadcasts.length,
    completed: broadcasts.filter((b) => b.status === 'COMPLETED').length,
    totalSent: broadcasts.reduce((a, b) => a + b.sentCount, 0),
    totalRecipients: broadcasts.reduce((a, b) => a + b.totalRecipients, 0),
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
            <Radio size={20} /> Broadcasts
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Envia mensagens em massa para os teus contactos.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn btn-primary py-2 px-3"><Plus size={14} /> Novo Broadcast</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: '#C8553D' },
          { label: 'Concluidos', value: stats.completed, color: '#10B981' },
          { label: 'Mensagens enviadas', value: stats.totalSent.toLocaleString(), color: '#0EA5E9' },
          { label: 'Destinatarios', value: stats.totalRecipients.toLocaleString(), color: '#F59E0B' },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xl font-bold" style={{ color: s.color, fontFamily: 'Manrope, sans-serif' }}>{s.value}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" /></div>
        ) : broadcasts.length === 0 ? (
          <div className="text-center py-12">
            <Radio size={32} className="mx-auto opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Sem broadcasts ainda</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Canal', 'Estado', 'Total', 'Enviado', 'Falhou', 'Data', 'Accoes'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => {
                const st = STATUS_COLORS[b.status] || STATUS_COLORS.DRAFT;
                const Icon = CHANNEL_ICONS[b.channel] || Radio;
                const delivRate = b.totalRecipients > 0 ? Math.round((b.sentCount / b.totalRecipients) * 100) : 0;
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--border)' }} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: CHANNEL_COLORS[b.channel] }}>
                        <Icon size={12} /> {b.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">{b.totalRecipients}</td>
                    <td className="px-4 py-3">
                      {b.sentCount > 0 ? (
                        <div>
                          <p className="text-xs font-medium" style={{ color: '#10B981' }}>{b.sentCount} ({delivRate}%)</p>
                          <div className="h-1 rounded-full mt-0.5" style={{ background: 'var(--surface-3)', width: 60 }}>
                            <div className="h-full rounded-full" style={{ width: `${delivRate}%`, background: '#10B981' }} />
                          </div>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                    </td>
                    <td className="px-4 py-3 text-center" style={{ color: b.failedCount > 0 ? '#EF4444' : 'var(--text-muted)' }}>
                      {b.failedCount || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {b.scheduledAt ? `Agendado ${new Date(b.scheduledAt).toLocaleString('pt-PT')}` : new Date(b.createdAt).toLocaleDateString('pt-PT')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {(b.status === 'DRAFT' || b.status === 'SCHEDULED') && (
                          <button onClick={() => handleSend(b.id)} disabled={!!sending} className="btn btn-primary text-xs py-1 px-2">
                            {sending === b.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Enviar
                          </button>
                        )}
                        <button onClick={() => setStatsId(b.id)} className="btn text-xs py-1 px-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                          <BarChart3 size={11} />
                        </button>
                        {b.status !== 'SENDING' && (
                          <button onClick={() => handleDelete(b)} className="btn text-xs py-1 px-2" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewBroadcastModal onClose={() => setShowNew(false)} onCreated={loadBroadcasts} allTags={allTags} />}
      {statsId && <StatsModal broadcastId={statsId} onClose={() => setStatsId(null)} />}
    </div>
  );
}
