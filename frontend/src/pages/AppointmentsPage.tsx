// Pagina de Marcacoes (Fase 3 da reconfiguracao). Vive dentro de Agenda,
// junto com as Tarefas, mas usa o modelo Appointment em vez de Task porque
// tem hora de inicio + duracao + estado com semantica de agendamento.

import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, X, CalendarClock, MapPin, User as UserIcon, Search } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { useTerminology } from '../lib/terminology';
import { useAuthStore } from '../store';

interface Contact {
  id: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  whatsapp?: string;
  avatar?: string;
}

interface Appointment {
  id: string;
  contactId: string;
  leadId: string | null;
  assignedToId: string | null;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  durationMin: number;
  status: 'SCHEDULED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW';
  reminderSentAt: string | null;
  notes: string | null;
  contact: Contact;
  assignedTo: { id: string; name: string; avatar?: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Realizada',
  CANCELED: 'Cancelada',
  NO_SHOW: 'Não compareceu',
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: '#3B82F6',
  CONFIRMED: '#10B981',
  COMPLETED: '#6B7280',
  CANCELED: '#EF4444',
  NO_SHOW: '#F59E0B',
};

export default function AppointmentsPage() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const terms = useTerminology();

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterFrom) params.set('from', new Date(filterFrom).toISOString());
    api.get(`/appointments?${params.toString()}`)
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast.error(`Erro a carregar ${terms.appointments.toLowerCase()}`))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filterStatus, filterFrom]);

  const grouped = useMemo(() => {
    const g: Record<string, Appointment[]> = {};
    for (const a of items) {
      const key = a.startsAt.slice(0, 10);
      if (!g[key]) g[key] = [];
      g[key].push(a);
    }
    return Object.keys(g).sort().map((date) => ({ date, items: g[date] }));
  }, [items]);

  const del = async (a: Appointment) => {
    if (!confirm(`Eliminar ${terms.appointment.toLowerCase()} "${a.title}"?`)) return;
    try {
      await api.delete(`/appointments/${a.id}`);
      setItems((p) => p.filter((x) => x.id !== a.id));
      toast.success(`${terms.appointment} eliminada`);
    } catch { toast.error('Erro a eliminar'); }
  };

  const changeStatus = async (a: Appointment, status: string) => {
    try {
      const { data } = await api.patch(`/appointments/${a.id}`, { status });
      setItems((p) => p.map((x) => (x.id === a.id ? data : x)));
      toast.success(`Estado: ${STATUS_LABELS[status]}`);
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <CalendarClock size={18} style={{ color: 'var(--primary)' }} />
          {terms.appointments}
        </h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
          {items.length} {items.length === 1 ? terms.appointment.toLowerCase() : terms.appointments.toLowerCase()}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-base text-sm py-1.5"
          >
            <option value="">Todos os estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="input-base text-sm py-1.5"
            title="A partir de"
          />
          <button
            onClick={() => setCreating(true)}
            className="btn btn-primary flex items-center gap-1.5"
          >
            <Plus size={14} /> Nova {terms.appointment.toLowerCase()}
          </button>
        </div>
      </div>

      {/* Lista agrupada por dia */}
      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="animate-spin" size={20} style={{ color: 'var(--text-muted)' }} /></div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <CalendarClock size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sem {terms.appointments.toLowerCase()}. Cria {terms.appointment === 'Consulta' ? 'a primeira' : 'a primeira'} para começar.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ date, items: dayItems }) => (
            <div key={date}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                {new Date(date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              <div className="space-y-2">
                {dayItems.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setEditing(a)}
                    className="w-full text-left card p-3 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 text-center" style={{ minWidth: 60 }}>
                        <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                          {new Date(a.startsAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {a.durationMin} min
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: STATUS_COLORS[a.status] + '22', color: STATUS_COLORS[a.status] }}
                          >
                            {STATUS_LABELS[a.status]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <span className="flex items-center gap-1 truncate">
                            <UserIcon size={11} />
                            {a.contact.firstName} {a.contact.lastName || ''}
                          </span>
                          {a.location && (
                            <span className="flex items-center gap-1 truncate">
                              <MapPin size={11} />
                              {a.location}
                            </span>
                          )}
                          {a.assignedTo?.name && (
                            <span className="truncate">· {a.assignedTo.name}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {a.status === 'SCHEDULED' && (
                          <button
                            onClick={() => changeStatus(a, 'CONFIRMED')}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: '#D1FAE5', color: '#065F46' }}
                            title="Marcar como confirmada"
                          >
                            Confirmar
                          </button>
                        )}
                        {(a.status === 'SCHEDULED' || a.status === 'CONFIRMED') && (
                          <button
                            onClick={() => changeStatus(a, 'COMPLETED')}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
                            title="Marcar como realizada"
                          >
                            Realizada
                          </button>
                        )}
                        <button
                          onClick={() => del(a)}
                          className="p-1 rounded hover:bg-red-50"
                          title="Eliminar"
                        >
                          <Trash2 size={13} style={{ color: '#DC2626' }} />
                        </button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <AppointmentModal
          appointment={editing}
          contactLabel={terms.contact}
          appointmentLabel={terms.appointment}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(saved) => {
            if (editing) {
              setItems((p) => p.map((x) => (x.id === saved.id ? saved : x)));
            } else {
              setItems((p) => [...p, saved]);
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ============ Modal de criacao/edicao ============
function AppointmentModal({
  appointment, contactLabel, appointmentLabel, onClose, onSaved,
}: {
  appointment: Appointment | null;
  contactLabel: string;
  appointmentLabel: string;
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const isEdit = !!appointment?.id;
  const workspace = (useAuthStore((s) => s.workspace) as any);
  const appointmentTypes: Array<{ key: string; label: string; defaultDurationMin: number }> =
    Array.isArray(workspace?.appointmentTypes) ? workspace.appointmentTypes : [];
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [location, setLocation] = useState(appointment?.location || '');
  const [startsAt, setStartsAt] = useState(() => {
    if (appointment?.startsAt) return new Date(appointment.startsAt).toISOString().slice(0, 16);
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [durationMin, setDurationMin] = useState(appointment?.durationMin || 30);
  const [status, setStatus] = useState(appointment?.status || 'SCHEDULED');
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [contactId, setContactId] = useState(appointment?.contactId || '');
  const [contactSearch, setContactSearch] = useState(
    appointment?.contact ? `${appointment.contact.firstName} ${appointment.contact.lastName || ''}`.trim() : ''
  );
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contactSearch.trim() || contactSearch.length < 2) { setContactResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/contacts?search=${encodeURIComponent(contactSearch)}&limit=10`);
        setContactResults(data.contacts || []);
      } catch { setContactResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [contactSearch]);

  const submit = async () => {
    if (!contactId) { toast.error(`${contactLabel} obrigatório`); return; }
    if (!title.trim()) { toast.error('Título obrigatório'); return; }
    if (!startsAt) { toast.error('Data obrigatória'); return; }
    setSaving(true);
    try {
      const body = {
        contactId,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        startsAt: new Date(startsAt).toISOString(),
        durationMin: Number(durationMin) || 30,
        status,
        notes: notes.trim() || null,
      };
      const { data } = isEdit
        ? await api.patch(`/appointments/${appointment!.id}`, body)
        : await api.post('/appointments', body);
      onSaved(data);
      toast.success(isEdit ? `${appointmentLabel} actualizada` : `${appointmentLabel} criada`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
    } finally { setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-bold text-base">
            {isEdit ? `Editar ${appointmentLabel.toLowerCase()}` : `Nova ${appointmentLabel.toLowerCase()}`}
          </h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Contacto */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              {contactLabel} *
            </label>
            <div className="relative">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  className="input-base w-full pl-8"
                  placeholder={`Pesquisar ${contactLabel.toLowerCase()}...`}
                  value={contactSearch}
                  onChange={(e) => { setContactSearch(e.target.value); setShowContactPicker(true); }}
                  onFocus={() => setShowContactPicker(true)}
                />
              </div>
              {showContactPicker && contactResults.length > 0 && (
                <div
                  className="absolute z-10 left-0 right-0 top-full mt-1 card overflow-hidden max-h-60 overflow-y-auto"
                  style={{ background: 'var(--surface)' }}
                >
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setContactId(c.id);
                        setContactSearch(`${c.firstName} ${c.lastName || ''}`.trim());
                        setShowContactPicker(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {c.firstName} {c.lastName || ''}
                      {c.phone && <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>· {c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tipo de consulta (se o workspace tiver appointmentTypes configurados) */}
          {appointmentTypes.length > 0 && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Tipo</label>
              <div className="flex flex-wrap gap-1">
                {appointmentTypes.map((tp) => (
                  <button
                    key={tp.key}
                    type="button"
                    onClick={() => {
                      setTitle(tp.label);
                      setDurationMin(tp.defaultDurationMin);
                    }}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: title === tp.label ? 'var(--primary)' : 'var(--surface-3)',
                      color: title === tp.label ? 'white' : 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {tp.label} <span className="opacity-60">· {tp.defaultDurationMin}min</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Titulo */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Título *</label>
            <input
              className="input-base w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={appointmentTypes.length > 0 ? 'Escolhe um tipo acima ou escreve livre' : 'Consulta de rotina, reunião...'}
            />
          </div>

          {/* Data e duracao */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Data e hora *</label>
              <input
                type="datetime-local"
                className="input-base w-full"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Duração (min)</label>
              <input
                type="number"
                min={5}
                step={5}
                className="input-base w-full"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Localizacao */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Localização (opcional)</label>
            <input
              className="input-base w-full"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Sala 2, Zoom, escritório..."
            />
          </div>

          {/* Descricao */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Descrição (opcional)</label>
            <textarea
              className="input-base w-full"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Estado */}
          {isEdit && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Estado</label>
              <select
                className="input-base w-full"
                value={status}
                onChange={(e) => setStatus(e.target.value as Appointment['status'])}
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notas (apos a marcacao) */}
          {isEdit && (status === 'COMPLETED' || status === 'NO_SHOW') && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Notas pós-{appointmentLabel.toLowerCase()}</label>
              <textarea
                className="input-base w-full"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Relato, próximos passos, prescrição..."
              />
            </div>
          )}
        </div>

        <div className="p-4 flex gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            className="btn flex-1 py-2"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || !contactId || !title.trim()}
            className="btn btn-primary flex-1 py-2 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : (isEdit ? 'Guardar' : `Criar ${appointmentLabel.toLowerCase()}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
