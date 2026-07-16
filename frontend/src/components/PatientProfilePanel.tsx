// Ficha consolidada do paciente. Vista humana do mesmo contexto que a
// Leizy le em background. Aberta como modal a partir do avatar/nome no
// header da conversa, ou como aba no perfil do contacto.

import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, Calendar, MessageSquare, ClipboardList, Sparkles, Phone, Mail, Building2, MapPin, UserIcon } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useTerminology } from '../lib/terminology';

interface Props {
  contactId: string;
  onClose: () => void;
}

interface Profile {
  contact: {
    id: string;
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    avatar?: string;
    company?: string;
    city?: string;
    country?: string;
    notes?: string;
    assignedTo?: { id: string; name: string } | null;
    tags: Array<{ id: string; name: string; color: string }>;
    createdAt: string;
    age: number | null;
  };
  customFields: {
    critical: Array<{ key: string; name: string; value: string }>;
    info: Array<{ key: string; name: string; value: string; type: string }>;
  };
  appointments: {
    all: any[];
    stats: {
      total: number;
      completed: number;
      future: number;
      noShows: number;
      canceled: number;
      daysSinceLast: number | null;
    };
  };
  tasks: any[];
  messages: { recent: any[]; total: number };
  leizySuggestions: any[];
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: '#3B82F6',
  CONFIRMED: '#10B981',
  COMPLETED: '#6B7280',
  CANCELED: '#EF4444',
  NO_SHOW: '#F59E0B',
};
const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Realizada',
  CANCELED: 'Cancelada',
  NO_SHOW: 'Não compareceu',
};

export default function PatientProfilePanel({ contactId, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const terms = useTerminology();

  useEffect(() => {
    setLoading(true);
    api.get(`/patient-profile/${contactId}`)
      .then(({ data }) => setProfile(data))
      .catch(() => toast.error('Erro a carregar ficha'))
      .finally(() => setLoading(false));
  }, [contactId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface)' }}
      >
        {/* Header */}
        <div className="sticky top-0 p-4 flex items-center justify-between z-10" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: 'var(--primary)' }}>
              {profile?.contact?.avatar
                ? <img src={profile.contact.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                : (profile?.contact?.firstName?.[0] || '?').toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-base">
                Ficha do {terms.contact.toLowerCase()}
              </h3>
              {profile?.contact && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {profile.contact.firstName} {profile.contact.lastName || ''}
                  {profile.contact.age !== null && ` · ${profile.contact.age} anos`}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {loading || !profile ? (
          <div className="p-12 flex justify-center"><Loader2 className="animate-spin" size={20} style={{ color: 'var(--text-muted)' }} /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Alergias / medicacao / contacto emergencia */}
            {profile.customFields.critical.length > 0 && (
              <div
                className="rounded-lg p-3 flex items-start gap-3"
                style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}
              >
                <AlertTriangle size={18} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
                <div className="flex-1 space-y-1.5">
                  <p className="text-xs uppercase font-bold" style={{ color: '#991B1B' }}>Aviso clínico</p>
                  {profile.customFields.critical.map((c) => (
                    <p key={c.key} className="text-sm" style={{ color: '#991B1B' }}>
                      <strong>{c.name}:</strong> {c.value}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Estatisticas em cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatCard
                label="Consultas realizadas"
                value={String(profile.appointments.stats.completed)}
                sub={profile.appointments.stats.daysSinceLast !== null ? `última há ${profile.appointments.stats.daysSinceLast}d` : 'sem histórico'}
              />
              <StatCard
                label="Próximas marcações"
                value={String(profile.appointments.stats.future)}
                sub={profile.appointments.stats.future > 0 ? 'agendadas' : 'nenhuma'}
                color={profile.appointments.stats.future > 0 ? '#3B82F6' : undefined}
              />
              <StatCard
                label="Faltas"
                value={String(profile.appointments.stats.noShows)}
                sub="não compareceu"
                color={profile.appointments.stats.noShows > 0 ? '#F59E0B' : undefined}
              />
              <StatCard
                label="Mensagens"
                value={String(profile.messages.total)}
                sub="trocadas"
              />
            </div>

            {/* Dados de contacto e info clinica */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="card p-3 space-y-1.5">
                <p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Dados de contacto</p>
                {profile.contact.whatsapp && <div className="flex items-center gap-2 text-sm"><Phone size={13} style={{ color: '#25D366' }} />{profile.contact.whatsapp}</div>}
                {profile.contact.email && <div className="flex items-center gap-2 text-sm"><Mail size={13} />{profile.contact.email}</div>}
                {profile.contact.company && <div className="flex items-center gap-2 text-sm"><Building2 size={13} />{profile.contact.company}</div>}
                {profile.contact.city && <div className="flex items-center gap-2 text-sm"><MapPin size={13} />{profile.contact.city}{profile.contact.country ? `, ${profile.contact.country}` : ''}</div>}
                {profile.contact.assignedTo && <div className="flex items-center gap-2 text-sm"><UserIcon size={13} />Atribuído a {profile.contact.assignedTo.name}</div>}
              </div>

              <div className="card p-3 space-y-1.5">
                <p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Informação clínica</p>
                {profile.customFields.info.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem dados registados. Adiciona campos personalizados nas Definições.</p>
                )}
                {profile.customFields.info.map((c) => (
                  <div key={c.key} className="flex items-start gap-2 text-sm">
                    <span style={{ color: 'var(--text-muted)', minWidth: 100 }}>{c.name}:</span>
                    <span style={{ color: 'var(--text-primary)' }}>{c.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Notas gerais */}
            {profile.contact.notes && (
              <div className="card p-3">
                <p className="text-xs uppercase font-bold mb-1" style={{ color: 'var(--text-muted)' }}>Notas internas</p>
                <p className="text-sm whitespace-pre-wrap">{profile.contact.notes}</p>
              </div>
            )}

            {/* Sugestoes pendentes da Leizy */}
            {profile.leizySuggestions.length > 0 && (
              <div className="card p-3" style={{ background: 'linear-gradient(135deg, rgba(200,85,61,0.08), rgba(200,85,61,0.02))', border: '1px solid rgba(200,85,61,0.25)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={14} style={{ color: 'var(--primary)' }} />
                  <p className="text-xs uppercase font-bold" style={{ color: 'var(--primary)' }}>Leizy sugere ({profile.leizySuggestions.length})</p>
                </div>
                <div className="space-y-2">
                  {profile.leizySuggestions.map((s: any) => {
                    const parts = Array.isArray(s.parts) ? s.parts : [];
                    return (
                      <div key={s.id} className="text-sm">
                        <p className="text-[11px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{new Date(s.createdAt).toLocaleString('pt-PT')} · {s.action}</p>
                        <p style={{ color: 'var(--text-primary)' }}>{parts.join(' / ').slice(0, 300)}</p>
                        {s.reasoning && <p className="text-[11px] italic mt-1" style={{ color: 'var(--text-muted)' }}>"{s.reasoning.slice(0, 200)}"</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Historico de marcacoes */}
            <div className="card p-3">
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={14} style={{ color: 'var(--primary)' }} />
                <p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Histórico de {terms.appointments.toLowerCase()} ({profile.appointments.all.length})</p>
              </div>
              {profile.appointments.all.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem histórico.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {profile.appointments.all.map((a: any) => (
                    <div key={a.id} className="flex items-start gap-2 text-sm py-1" style={{ borderBottom: '1px solid var(--border)' }}>
                      <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: STATUS_COLORS[a.status] + '22', color: STATUS_COLORS[a.status] }}>
                        {STATUS_LABELS[a.status]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{a.title}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {new Date(a.startsAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {a.assignedTo?.name && ` · ${a.assignedTo.name}`}
                          {a.durationMin && ` · ${a.durationMin}min`}
                        </p>
                        {a.notes && <p className="text-[11px] italic mt-0.5" style={{ color: 'var(--text-secondary)' }}>{a.notes.slice(0, 200)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tarefas abertas */}
            {profile.tasks.length > 0 && (
              <div className="card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardList size={14} style={{ color: 'var(--primary)' }} />
                  <p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Tarefas abertas ({profile.tasks.length})</p>
                </div>
                <div className="space-y-1.5">
                  {profile.tasks.map((t: any) => (
                    <div key={t.id} className="text-sm py-1" style={{ borderBottom: '1px solid var(--border)' }}>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t.dueAt && `Prazo: ${new Date(t.dueAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                        {t.assignedTo?.name && ` · ${t.assignedTo.name}`}
                        {' · '}{t.priority}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ultimas mensagens */}
            <div className="card p-3">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare size={14} style={{ color: 'var(--primary)' }} />
                <p className="text-xs uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Últimas mensagens (30)</p>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {profile.messages.recent.slice().reverse().map((m: any) => (
                  <div key={m.id} className="text-xs py-0.5">
                    <span style={{ color: 'var(--text-muted)' }}>
                      [{new Date(m.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}]{' '}
                      {m.direction === 'INBOUND' ? '←' : '→'}{' '}
                      {m.sentBy?.name || (m.direction === 'INBOUND' ? 'paciente' : 'Leizy/sistema')}:{' '}
                    </span>
                    <span style={{ color: 'var(--text-primary)' }}>{String(m.content || '').slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card p-2 text-center">
      <p className="text-2xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {sub && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}
