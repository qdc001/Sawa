import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, ExternalLink,
  ArrowUpDown, ArrowUp, ArrowDown, RotateCcw,
  User as UserIcon, Building2, Mail, Phone, MapPin, Globe, FileText, Download,
  MessageCircle, PhoneCall,
} from 'lucide-react';
import api, { Contact, Lead } from '../lib/api';
import toast from 'react-hot-toast';
import { useUIStore } from '../store';

type SortKey = 'firstName' | 'company' | 'createdAt';
type SortDir = 'asc' | 'desc';

interface ContactWithMeta extends Contact {
  // o backend devolve _count.leads na lista
}

// Forma extendida do detalhe (com leads) — o backend GET /:id devolve isto
interface ContactDetail extends Contact {
  leads?: Array<Lead & { stage?: any; pipeline?: any }>;
}

// =============== Modal: Criar/Editar Contacto ===============
function ContactFormModal({
  contact,
  onClose,
  onSaved,
}: {
  contact?: ContactDetail | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
}) {
  const isEdit = !!contact?.id;
  const [type, setType] = useState<'PERSON' | 'COMPANY'>(contact?.type || 'PERSON');
  const [firstName, setFirstName] = useState(contact?.firstName || '');
  const [lastName, setLastName] = useState(contact?.lastName || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [position, setPosition] = useState(contact?.position || '');
  const [website, setWebsite] = useState((contact as any)?.website || '');
  const [address, setAddress] = useState(contact?.address || '');
  const [city, setCity] = useState(contact?.city || '');
  const [country, setCountry] = useState(contact?.country || 'Mocambique');
  const [notes, setNotes] = useState((contact as any)?.notes || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      toast.error('Nome obrigatorio');
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        type, firstName, lastName, email, phone, whatsapp, company, position,
        website, address, city, country, notes,
      };
      // Limpar strings vazias
      Object.keys(payload).forEach((k) => { if (payload[k] === '') delete payload[k]; });

      let saved: Contact;
      if (isEdit) {
        const { data } = await api.patch(`/contacts/${contact!.id}`, payload);
        saved = data;
        toast.success('Contacto actualizado');
      } else {
        const { data } = await api.post('/contacts', payload);
        saved = data;
        toast.success('Contacto criado');
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a guardar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Editar Contacto' : 'Novo Contacto'}
          </h3>
          <button onClick={onClose}>
            <X size={20} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Tipo */}
          <div className="flex gap-2">
            {(['PERSON', 'COMPANY'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className="btn flex-1 py-2"
                style={{
                  background: type === t ? 'var(--primary)' : 'var(--surface-3)',
                  color: type === t ? '#fff' : 'var(--text-primary)',
                }}
              >
                {t === 'PERSON' ? <UserIcon size={14} /> : <Building2 size={14} />}
                {t === 'PERSON' ? 'Pessoa' : 'Empresa'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                {type === 'PERSON' ? 'Primeiro nome *' : 'Nome da empresa *'}
              </label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-base" required autoFocus />
            </div>
            {type === 'PERSON' && (
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  Apelido
                </label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input-base" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base" placeholder="+258 84..." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>WhatsApp</label>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="input-base" placeholder="+258 84..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Website</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} className="input-base" placeholder="https://" />
            </div>
          </div>

          {type === 'PERSON' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Empresa</label>
                <input value={company} onChange={(e) => setCompany(e.target.value)} className="input-base" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Cargo</label>
                <input value={position} onChange={(e) => setPosition(e.target.value)} className="input-base" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Endereco</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Cidade</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Pais</label>
              <input value={country} onChange={(e) => setCountry(e.target.value)} className="input-base" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Notas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" rows={3} />
          </div>

          {/* Leads associados (apenas em modo edicao) */}
          {isEdit && contact?.leads && contact.leads.length > 0 && (
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Leads associados ({contact.leads.length})
              </p>
              <div className="space-y-1">
                {contact.leads.map((lead) => (
                  <a
                    key={lead.id}
                    href={`/pipeline?leadId=${lead.id}`}
                    className="flex items-center justify-between p-2 rounded hover:bg-slate-100 text-sm"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div>
                      <div style={{ color: 'var(--text-primary)' }}>{lead.title}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {lead.pipeline?.name} · {lead.stage?.name}
                      </div>
                    </div>
                    <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : isEdit ? 'Guardar' : 'Criar Contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============== Pagina principal ===============
export default function ContactsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();

  const [contacts, setContacts] = useState<ContactWithMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(globalSearchQuery || '');
  const [typeFilter, setTypeFilter] = useState<'' | 'PERSON' | 'COMPANY'>('');
  const [sortKey, setSortKey] = useState<SortKey>('firstName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ContactDetail | null>(null);

  // Sincronizar pesquisa global
  useEffect(() => {
    setSearch(globalSearchQuery || '');
  }, [globalSearchQuery]);

  // Carregar lista
  const loadContacts = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '100');
    setLoading(true);
    api.get(`/contacts?${params.toString()}`)
      .then(({ data }) => {
        let list: ContactWithMeta[] = data.contacts || [];
        if (typeFilter) list = list.filter((c) => c.type === typeFilter);
        setContacts(list);
        setTotal(data.total || list.length);
      })
      .catch(() => toast.error('Erro a carregar contactos'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  // Suporte ao query param ?contactId=... vindo da pesquisa global
  const queryContactId = searchParams.get('contactId');
  useEffect(() => {
    if (!queryContactId) return;
    api.get(`/contacts/${queryContactId}`)
      .then(({ data }) => setEditing(data))
      .catch(() => toast.error('Contacto nao encontrado'))
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('contactId');
        setSearchParams(next, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryContactId]);

  const sortedContacts = useMemo(() => {
    const arr = [...contacts];
    arr.sort((a: any, b: any) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'createdAt') {
        av = new Date(av || 0).getTime();
        bv = new Date(bv || 0).getTime();
      } else {
        av = String(av || '').toLowerCase();
        bv = String(bv || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [contacts, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={12} />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const resetFilters = () => {
    setSearch('');
    setGlobalSearchQuery('');
    setTypeFilter('');
  };

  const openEdit = async (contact: Contact) => {
    try {
      const { data } = await api.get(`/contacts/${contact.id}`);
      setEditing(data);
    } catch {
      toast.error('Erro a abrir contacto');
    }
  };

  // Exportar para CSV (respeita filtros e ordenacao)
  const handleExportCSV = () => {
    if (sortedContacts.length === 0) {
      toast.error('Nada para exportar');
      return;
    }
    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const headers = [
      'Tipo', 'Nome', 'Apelido', 'Empresa', 'Cargo',
      'Email', 'Telefone', 'WhatsApp', 'Website',
      'Endereco', 'Cidade', 'Pais', 'Notas', 'Nr Leads', 'Criado em',
    ];
    const rows = sortedContacts.map((c: any) => [
      c.type === 'COMPANY' ? 'Empresa' : 'Pessoa',
      c.firstName || '',
      c.lastName || '',
      c.company || '',
      c.position || '',
      c.email || '',
      c.phone || '',
      c.whatsapp || '',
      c.website || '',
      c.address || '',
      c.city || '',
      c.country || '',
      c.notes || '',
      c._count?.leads || 0,
      c.createdAt ? new Date(c.createdAt).toLocaleString('pt-PT') : '',
    ].map(escape).join(','));

    // BOM UTF-8 para Excel reconhecer acentos
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `contactos-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${sortedContacts.length} contactos exportados`);
  };

  const cleanPhone = (p?: string) => (p || '').replace(/[^0-9+]/g, '');

  const handleDelete = async (contact: Contact) => {
    const leadCount = (contact as any)._count?.leads || 0;
    const confirmMsg = leadCount > 0
      ? `Eliminar "${contact.firstName} ${contact.lastName || ''}"? Tem ${leadCount} lead(s) associado(s).`
      : `Eliminar "${contact.firstName} ${contact.lastName || ''}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      await api.delete(`/contacts/${contact.id}`);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success('Contacto eliminado');
    } catch {
      toast.error('Erro a eliminar');
    }
  };

  const hasFilters = !!(search || typeFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Contactos</h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
          {total} total
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="btn py-2 px-3"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            title="Exportar para CSV (respeita filtros)"
          >
            <Download size={14} /> Exportar CSV
          </button>
          <button
            onClick={() => setAdding(true)}
            className="btn btn-primary py-2 px-3"
          >
            <Plus size={14} /> Novo Contacto
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="relative" style={{ minWidth: 240, flex: '1 1 240px' }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome, email, telefone..."
            className="input-base"
            style={{ paddingLeft: 32 }}
          />
        </div>

        <div className="flex items-center gap-1">
          {(['', 'PERSON', 'COMPANY'] as const).map((t) => (
            <button
              key={t || 'all'}
              onClick={() => setTypeFilter(t)}
              className="btn py-2 px-3"
              style={{
                background: typeFilter === t ? 'var(--primary)' : 'var(--surface-3)',
                color: typeFilter === t ? '#fff' : 'var(--text-primary)',
              }}
            >
              {t === '' ? 'Todos' : t === 'PERSON' ? <><UserIcon size={12} /> Pessoas</> : <><Building2 size={12} /> Empresas</>}
            </button>
          ))}
        </div>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="btn py-2 px-3"
            style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
          >
            <RotateCcw size={14} /> Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : sortedContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <UserIcon size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {hasFilters ? 'Nenhum contacto corresponde aos filtros' : 'Sem contactos ainda'}
            </p>
            {!hasFilters && (
              <button onClick={() => setAdding(true)} className="btn btn-primary mt-3 py-2 px-4">
                <Plus size={14} /> Criar primeiro contacto
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('firstName')} className="flex items-center gap-1 text-xs uppercase">
                    Nome {sortIcon('firstName')}
                  </button>
                </th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('company')} className="flex items-center gap-1 text-xs uppercase">
                    Empresa {sortIcon('company')}
                  </button>
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Email</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Telefone</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Cidade</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Leads</th>
                <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <button onClick={() => toggleSort('createdAt')} className="flex items-center gap-1 text-xs uppercase">
                    Criado {sortIcon('createdAt')}
                  </button>
                </th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Accoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedContacts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50" style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-3 py-2">
                    <button onClick={() => openEdit(c)} className="flex items-center gap-2 hover:underline text-left">
                      {c.type === 'COMPANY' ? <Building2 size={14} style={{ color: 'var(--text-muted)' }} /> : <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />}
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {c.firstName} {c.lastName || ''}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {c.company || (c.type === 'COMPANY' ? c.firstName : '—')}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {c.phone || c.whatsapp || '—'}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                    {c.city || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                      {(c as any)._count?.leads || 0}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(c.createdAt).toLocaleDateString('pt-PT')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {c.whatsapp && (
                        <a
                          href={`https://wa.me/${cleanPhone(c.whatsapp)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded hover:bg-green-50"
                          title="Abrir WhatsApp"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageCircle size={14} style={{ color: '#25D366' }} />
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={`tel:${cleanPhone(c.phone)}`}
                          className="p-1.5 rounded hover:bg-slate-100"
                          title="Telefonar"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PhoneCall size={14} style={{ color: 'var(--text-secondary)' }} />
                        </a>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="p-1.5 rounded hover:bg-slate-100"
                          title="Enviar email"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail size={14} style={{ color: 'var(--text-secondary)' }} />
                        </a>
                      )}
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-slate-100" title="Editar">
                        <Edit3 size={14} style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="p-1.5 rounded hover:bg-red-50"
                        title="Eliminar"
                      >
                        <Trash2 size={14} style={{ color: '#EF4444' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modais */}
      {adding && (
        <ContactFormModal
          onClose={() => setAdding(false)}
          onSaved={(contact) => {
            setContacts((prev) => [contact, ...prev]);
            setTotal((t) => t + 1);
          }}
        />
      )}
      {editing && (
        <ContactFormModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={(contact) => {
            setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, ...contact } as ContactWithMeta : c)));
          }}
        />
      )}
    </div>
  );
}
