import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, Search, Loader2, Video, MessageCircle } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface Call {
  id: string;
  content: string;
  createdAt: string;
  contact: {
    id: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    whatsapp?: string;
    avatar?: string;
  } | null;
}

function callIcon(content: string) {
  if (content.includes('atendida')) return <PhoneIncoming size={14} style={{ color: '#10B981' }} />;
  if (content.includes('rejeitada')) return <PhoneOff size={14} style={{ color: '#EF4444' }} />;
  if (content.includes('perdida')) return <PhoneMissed size={14} style={{ color: '#F59E0B' }} />;
  return <Phone size={14} style={{ color: 'var(--text-muted)' }} />;
}

function callLabel(content: string): string {
  if (content.includes('vídeo')) return 'Chamada de vídeo';
  if (content.includes('voz')) return 'Chamada de voz';
  return 'Chamada';
}

function callStatus(content: string): { label: string; color: string } {
  if (content.includes('atendida')) return { label: 'Atendida', color: '#10B981' };
  if (content.includes('rejeitada')) return { label: 'Rejeitada', color: '#EF4444' };
  if (content.includes('perdida')) return { label: 'Perdida', color: '#F59E0B' };
  if (content.includes('recebida')) return { label: 'Recebida', color: 'var(--primary)' };
  return { label: 'Chamada', color: 'var(--text-muted)' };
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missed' | 'answered' | 'rejected'>('all');
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/messages/calls?search=${encodeURIComponent(search)}&limit=200`);
      setCalls(data.calls || []);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a carregar chamadas');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [search]);

  const filtered = calls.filter((c) => {
    if (filter === 'missed') return c.content.includes('perdida');
    if (filter === 'answered') return c.content.includes('atendida');
    if (filter === 'rejected') return c.content.includes('rejeitada');
    return true;
  });

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Chamadas</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Histórico de chamadas WhatsApp recebidas e perdidas.
          </p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome ou telefone..."
              className="input-base text-sm"
              style={{ paddingLeft: 32 }}
            />
          </div>
          <div className="flex gap-1">
            {([
              { v: 'all', label: 'Todas' },
              { v: 'missed', label: 'Perdidas' },
              { v: 'answered', label: 'Atendidas' },
              { v: 'rejected', label: 'Rejeitadas' },
            ] as const).map((f) => (
              <button key={f.v} onClick={() => setFilter(f.v)} className="text-xs px-3 py-1.5 rounded font-medium"
                style={{ background: filter === f.v ? 'var(--primary)' : 'var(--surface-3)', color: filter === f.v ? '#fff' : 'var(--text-secondary)' }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin" size={24} /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
            <Phone size={28} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Sem chamadas ainda</h3>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Quando alguém te ligar no WhatsApp ligado ao CRM, aparece aqui. Não podes atender via CRM; é só registo.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th className="text-left py-2 px-4 text-xs font-semibold">Contacto</th>
                <th className="text-left py-2 px-4 text-xs font-semibold">Tipo</th>
                <th className="text-left py-2 px-4 text-xs font-semibold">Estado</th>
                <th className="text-left py-2 px-4 text-xs font-semibold">Data</th>
                <th className="text-right py-2 px-4 text-xs font-semibold">Acções</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const st = callStatus(c.content);
                const name = c.contact ? `${c.contact.firstName} ${c.contact.lastName || ''}`.trim() : '(sem contacto)';
                const phone = c.contact?.whatsapp || c.contact?.phone;
                return (
                  <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2">
                        {c.contact?.avatar ? (
                          <img src={c.contact.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                            {(c.contact?.firstName?.[0] || '?').toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{name}</p>
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{phone || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <span className="flex items-center gap-1.5 text-xs">
                        {c.content.includes('vídeo') ? <Video size={12} /> : <Phone size={12} />}
                        {callLabel(c.content)}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full" style={{ background: `${st.color}15`, color: st.color, display: 'inline-flex' }}>
                        {callIcon(c.content)}
                        {st.label}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(c.createdAt).toLocaleString('pt-PT')}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {c.contact?.id && (
                          <button
                            onClick={() => navigate(`/inbox?contactId=${c.contact!.id}`)}
                            className="p-1.5 rounded hover:bg-slate-100"
                            title="Abrir conversa"
                          >
                            <MessageCircle size={14} style={{ color: 'var(--primary)' }} />
                          </button>
                        )}
                        {phone && (
                          <a
                            href={`https://wa.me/${phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded hover:bg-green-50"
                            title="Abrir no WhatsApp"
                          >
                            <Phone size={14} style={{ color: '#25D366' }} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
