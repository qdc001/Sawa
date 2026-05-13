import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, ExternalLink,
  ArrowUpDown, ArrowUp, ArrowDown, RotateCcw,
  User as UserIcon, Building2, Mail, Phone, MapPin, Globe, FileText, Download,
  MessageCircle, PhoneCall, Upload, TagIcon as Tag, Settings as SettingsIcon,
  Columns, Tags as TagsIcon, CheckSquare, Square, MinusSquare, Image as ImageIcon,
  GitBranch,
} from 'lucide-react';
import api, { Contact, Lead, Tag as TagType, CustomField, CustomFieldType, User } from '../lib/api';
import toast from 'react-hot-toast';
import { useUIStore } from '../store';
import { useTaskOptions } from '../lib/taskOptions';
import { CustomFieldInput, AddLeadModal } from './PipelinePage';

type SortKey = 'firstName' | 'company' | 'createdAt';
type SortDir = 'asc' | 'desc';

interface ContactWithMeta extends Contact {
  leads?: Array<Lead & { stage?: any; pipeline?: any }>;
  customValues?: Array<{ id: string; value: string; fieldId: string; field?: CustomField }>;
}

// ============== Hook config de colunas (localStorage) ==============
const COLS_KEY = 'kommo:contacts-columns';
const ALL_COLUMNS = [
  { key: 'name', label: 'Nome', default: true },
  { key: 'company', label: 'Empresa', default: true },
  { key: 'email', label: 'Email', default: true },
  { key: 'phone', label: 'Telefone', default: true },
  { key: 'whatsapp', label: 'WhatsApp', default: false },
  { key: 'city', label: 'Cidade', default: true },
  { key: 'country', label: 'Pais', default: false },
  { key: 'tags', label: 'Tags', default: true },
  { key: 'leadsCount', label: 'Nr Leads', default: true },
  { key: 'createdAt', label: 'Criado', default: true },
];

function loadColumnsConfig(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const defaults: Record<string, boolean> = {};
  ALL_COLUMNS.forEach((c) => { defaults[c.key] = c.default; });
  return defaults;
}

// ============== Modal: Gerir Tags ==============
function ManageTagsModal({
  tags,
  onClose,
  onChanged,
}: {
  tags: TagType[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<TagType[]>(tags);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366F1');
  useEffect(() => setList(tags), [tags]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      const { data } = await api.post('/tags', { name: newName.trim(), color: newColor });
      setList((prev) => [...prev, data]);
      setNewName('');
      setNewColor('#6366F1');
      toast.success('Tag criada');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro');
    }
  };

  const handleSave = async (tag: TagType) => {
    try {
      await api.patch(`/tags/${tag.id}`, { name: tag.name, color: tag.color });
      toast.success('Tag actualizada');
      onChanged();
    } catch {
      toast.error('Erro ao guardar');
    }
  };

  const handleDelete = async (tag: TagType) => {
    if (!confirm(`Eliminar a tag "${tag.name}"?`)) return;
    try {
      await api.delete(`/tags/${tag.id}`);
      setList((prev) => prev.filter((t) => t.id !== tag.id));
      toast.success('Tag eliminada');
      onChanged();
    } catch {
      toast.error('Erro ao eliminar');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Gerir Tags</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <div className="space-y-2 mb-4">
          {list.length === 0 && <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>Sem tags ainda</p>}
          {list.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
              <input
                type="color"
                value={tag.color}
                onChange={(e) => setList((p) => p.map((t) => (t.id === tag.id ? { ...t, color: e.target.value } : t)))}
                onBlur={() => handleSave(list.find((t) => t.id === tag.id)!)}
                className="w-8 h-8 rounded cursor-pointer border-0"
              />
              <input
                value={tag.name}
                onChange={(e) => setList((p) => p.map((t) => (t.id === tag.id ? { ...t, name: e.target.value } : t)))}
                onBlur={() => handleSave(list.find((t) => t.id === tag.id)!)}
                className="input-base flex-1"
              />
              <button onClick={() => handleDelete(tag)} className="p-2 rounded hover:bg-red-50">
                <Trash2 size={16} style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t pt-4 mb-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Nova tag</p>
          <div className="flex items-center gap-2">
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome (ex: VIP, Fornecedor)" className="input-base flex-1" />
            <button onClick={handleAdd} className="btn btn-primary py-2 px-3"><Plus size={16} /></button>
          </div>
        </div>

        <button onClick={onClose} className="btn w-full py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
      </div>
    </div>
  );
}

// ============== Modal: Gerir Campos Personalizados de Contactos ==============
const CFIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: 'Texto', NUMBER: 'Numero', DATE: 'Data', BOOLEAN: 'Sim/Nao',
  SELECT: 'Lista (uma)', MULTISELECT: 'Lista (multipla)', URL: 'URL', EMAIL: 'Email', PHONE: 'Telefone',
};
function ManageContactFieldsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CustomFieldType>('TEXT');
  const [newOptions, setNewOptions] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  useEffect(() => {
    api.get('/custom-fields?entity=contact')
      .then(({ data }) => setFields(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Erro a carregar campos'))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return toast.error('Indica o nome');
    const opts = (newType === 'SELECT' || newType === 'MULTISELECT')
      ? newOptions.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if ((newType === 'SELECT' || newType === 'MULTISELECT') && opts.length === 0) {
      return toast.error('Indica pelo menos uma opcao');
    }
    try {
      const { data } = await api.post('/custom-fields', {
        name: newName.trim(), type: newType, entity: 'contact',
        options: opts, isRequired: newRequired,
      });
      setFields((p) => [...p, data]);
      setNewName(''); setNewType('TEXT'); setNewOptions(''); setNewRequired(false);
      toast.success('Campo adicionado');
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const handleDelete = async (f: CustomField) => {
    if (!confirm(`Eliminar campo "${f.name}"?`)) return;
    try {
      await api.delete(`/custom-fields/${f.id}`);
      setFields((p) => p.filter((x) => x.id !== f.id));
      toast.success('Eliminado');
      onChanged();
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Campos personalizados de Contacto</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="space-y-2 mb-4">
            {fields.length === 0 && <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>Sem campos personalizados</p>}
            {fields.map((f) => (
              <div key={f.id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{f.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {CFIELD_TYPE_LABELS[f.type]}{f.options?.length > 0 && ` · ${f.options.join(', ')}`}
                  </p>
                </div>
                <button onClick={() => handleDelete(f)} className="p-2 rounded hover:bg-red-50">
                  <Trash2 size={16} style={{ color: '#EF4444' }} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4 mb-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Novo campo</p>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome (ex: NUIT)" className="input-base" />
          <select value={newType} onChange={(e) => setNewType(e.target.value as CustomFieldType)} className="input-base">
            {Object.entries(CFIELD_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {(newType === 'SELECT' || newType === 'MULTISELECT') && (
            <input value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="Opcoes separadas por virgula" className="input-base" />
          )}
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} /> Obrigatorio
          </label>
          <button onClick={handleAdd} className="btn btn-primary w-full py-2"><Plus size={16} /> Adicionar campo</button>
        </div>

        <button onClick={onClose} className="btn w-full py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
      </div>
    </div>
  );
}

// ============== Modal: Personalizar Colunas ==============
function ColumnsModal({
  columns,
  onChange,
  onClose,
}: {
  columns: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Colunas visiveis</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="space-y-2">
          {ALL_COLUMNS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={columns[c.key] !== false}
                onChange={(e) => onChange({ ...columns, [c.key]: e.target.checked })}
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{c.label}</span>
            </label>
          ))}
        </div>
        <button onClick={onClose} className="btn w-full py-2 mt-4" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
      </div>
    </div>
  );
}

// ============== Modal: Importar CSV ==============
function ImportCSVModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const TARGET_FIELDS = [
    { key: 'firstName', label: 'Nome *' },
    { key: 'lastName', label: 'Apelido' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Telefone' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'company', label: 'Empresa' },
    { key: 'position', label: 'Cargo' },
    { key: 'website', label: 'Website' },
    { key: 'address', label: 'Endereco' },
    { key: 'city', label: 'Cidade' },
    { key: 'country', label: 'Pais' },
    { key: 'notes', label: 'Notas' },
    { key: 'type', label: 'Tipo (PERSON/COMPANY)' },
  ];

  const parseCSV = (text: string): string[][] => {
    const result: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (cell !== '' || row.length > 0) { row.push(cell); result.push(row); row = []; cell = ''; }
          if (ch === '\r' && next === '\n') i++;
        } else cell += ch;
      }
    }
    if (cell !== '' || row.length > 0) { row.push(cell); result.push(row); }
    return result.filter((r) => r.some((c) => c.trim() !== ''));
  };

  const handleFile = async (f: File) => {
    setFile(f);
    let text = await f.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = parseCSV(text);
    if (parsed.length === 0) { toast.error('CSV vazio'); return; }
    const hdrs = parsed[0].map((h) => h.trim());
    setHeaders(hdrs);
    setRows(parsed.slice(1, 6)); // preview 5 linhas
    // auto-map
    const auto: Record<string, string> = {};
    TARGET_FIELDS.forEach(({ key, label }) => {
      const found = hdrs.find((h) => {
        const lower = h.toLowerCase();
        return lower === key.toLowerCase()
          || lower === label.toLowerCase().replace(/[* ]/g, '')
          || (key === 'firstName' && (lower.includes('nome') || lower === 'name'))
          || (key === 'lastName' && (lower.includes('apelido') || lower.includes('sobrenome') || lower === 'last'))
          || (key === 'phone' && lower.includes('telefone'))
          || (key === 'whatsapp' && lower.includes('whats'))
          || (key === 'company' && lower.includes('empres'))
          || (key === 'position' && (lower.includes('cargo') || lower.includes('position')))
          || (key === 'address' && (lower.includes('endere') || lower.includes('morada')))
          || (key === 'city' && lower.includes('cidade'))
          || (key === 'country' && (lower.includes('pais') || lower.includes('país')))
          || (key === 'notes' && (lower.includes('nota') || lower.includes('obs')));
      });
      if (found) auto[key] = found;
    });
    setMapping(auto);
  };

  const handleImport = async () => {
    if (!file) return;
    if (!mapping.firstName) { toast.error('Mapeia o campo Nome'); return; }
    setLoading(true);
    try {
      const text = await file.text();
      const parsed = parseCSV(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
      const allRows = parsed.slice(1);
      const idx: Record<string, number> = {};
      Object.keys(mapping).forEach((k) => {
        idx[k] = headers.indexOf(mapping[k]);
      });
      const contacts = allRows.map((r) => {
        const obj: any = {};
        Object.keys(idx).forEach((k) => {
          if (idx[k] >= 0) obj[k] = r[idx[k]];
        });
        return obj;
      }).filter((c) => c.firstName);

      const { data } = await api.post('/contacts/bulk', { contacts });
      const parts = [];
      if (data.created) parts.push(`${data.created} criados`);
      if (data.updated) parts.push(`${data.updated} actualizados`);
      if (data.skipped) parts.push(`${data.skipped} ignorados`);
      toast.success(`Importacao: ${parts.join(', ')} (total ${data.total})`);
      onImported();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a importar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Importar contactos (CSV)</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Formato: a primeira linha do CSV deve conter os cabecalhos (Nome, Email, Telefone, etc). O sistema tenta mapear automaticamente.
        </p>

        <div className="mb-4">
          <label
            className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg cursor-pointer transition-colors"
            style={{
              border: `2px dashed ${file ? 'var(--primary)' : 'var(--border)'}`,
              background: file ? 'var(--primary-light)' : 'var(--surface-2)',
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              className="hidden"
            />
            <Upload size={24} style={{ color: file ? 'var(--primary)' : 'var(--text-muted)' }} />
            <div className="text-center">
              {file ? (
                <>
                  <p className="text-sm font-medium" style={{ color: 'var(--primary)' }}>{file.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB · clica para mudar</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Clica para escolher um ficheiro CSV</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>ou arrasta o ficheiro para aqui</p>
                </>
              )}
            </div>
          </label>
        </div>

        {headers.length > 0 && (
          <>
            <div className="mb-4">
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Mapeamento de campos</p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto p-2 rounded" style={{ background: 'var(--surface-2)' }}>
                {TARGET_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                    <select
                      value={mapping[key] || ''}
                      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                      className="input-base"
                      style={{ flex: 2, padding: '4px 8px', fontSize: 13 }}
                    >
                      <option value="">— Nao mapear —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Preview (5 primeiras linhas)</p>
              <div className="overflow-x-auto rounded" style={{ background: 'var(--surface-2)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr>{headers.map((h) => <th key={h} className="px-2 py-1 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1" style={{ color: 'var(--text-primary)' }}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleImport} disabled={!file || loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== Modal: Criar/Editar Contacto ==============
function ContactFormModal({
  contact,
  allTags,
  onClose,
  onSaved,
  onCreateLead,
  onTagsChanged,
  onFieldsChanged,
}: {
  contact?: ContactWithMeta | null;
  allTags: TagType[];
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onCreateLead?: (contact: ContactWithMeta) => void;
  onTagsChanged: () => void;
  onFieldsChanged: () => void;
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
  const [avatar, setAvatar] = useState(contact?.avatar || '');
  const [address, setAddress] = useState(contact?.address || '');
  const [city, setCity] = useState(contact?.city || '');
  const [country, setCountry] = useState(contact?.country || 'Mocambique');
  const [notes, setNotes] = useState((contact as any)?.notes || '');
  const [assignedToId, setAssignedToId] = useState<string>((contact as any)?.assignedToId || (contact as any)?.assignedTo?.id || '');
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => { api.get('/users').then((r) => setUsers(r.data)).catch(() => {}); }, []);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    contact?.tags?.map((tc: any) => tc.tag?.id || tc.tagId).filter(Boolean) || []
  );
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    contact?.customValues?.forEach((cv: any) => { m[cv.fieldId] = cv.value; });
    return m;
  });
  const [showTagsManager, setShowTagsManager] = useState(false);
  const [showFieldsManager, setShowFieldsManager] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadFields = () => {
    api.get('/custom-fields?entity=contact')
      .then(({ data }) => setCustomFields(Array.isArray(data) ? data : []))
      .catch(() => setCustomFields([]));
  };
  useEffect(loadFields, []);

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) { toast.error('Nome obrigatorio'); return; }
    setLoading(true);
    try {
      const payload: any = {
        type, firstName, lastName, email, phone, whatsapp, company, position,
        website, avatar, address, city, country, notes,
        assignedToId: assignedToId || null,
        tags: selectedTagIds,
        customValues: customFields.map((f) => ({ fieldId: f.id, value: customValues[f.id] || '' })),
      };
      Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
      let saved: Contact;
      if (isEdit) {
        const { data } = await api.patch(`/contacts/${contact!.id}`, payload);
        saved = data; toast.success('Contacto actualizado');
      } else {
        const { data } = await api.post('/contacts', payload);
        saved = data; toast.success('Contacto criado');
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a guardar');
    } finally { setLoading(false); }
  };

  return (
    <>
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
        <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {isEdit ? 'Editar Contacto' : 'Novo Contacto'}
            </h3>
            <div className="flex items-center gap-1">
              {isEdit && onCreateLead && (
                <button
                  type="button"
                  onClick={() => onCreateLead(contact!)}
                  className="btn py-1.5 px-3"
                  style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                  title="Criar lead a partir deste contacto"
                >
                  <GitBranch size={14} /> Criar lead
                </button>
              )}
              <button type="button" onClick={() => setShowFieldsManager(true)} className="p-1.5 rounded hover:bg-slate-100" title="Gerir campos personalizados">
                <SettingsIcon size={16} style={{ color: 'var(--text-secondary)' }} />
              </button>
              <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-2">
              {(['PERSON', 'COMPANY'] as const).map((t) => (
                <button
                  key={t} type="button" onClick={() => setType(t)}
                  className="btn flex-1 py-2"
                  style={{ background: type === t ? 'var(--primary)' : 'var(--surface-3)', color: type === t ? '#fff' : 'var(--text-primary)' }}
                >
                  {t === 'PERSON' ? <UserIcon size={14} /> : <Building2 size={14} />}
                  {t === 'PERSON' ? 'Pessoa' : 'Empresa'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{type === 'PERSON' ? 'Primeiro nome *' : 'Nome da empresa *'}</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-base" required autoFocus />
              </div>
              {type === 'PERSON' && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Apelido</label>
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
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Responsável</label>
              <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="input-base">
                <option value="">— Sem responsável —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>URL da foto (avatar)</label>
              <div className="flex items-center gap-2">
                {avatar && (
                  <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                )}
                <input value={avatar} onChange={(e) => setAvatar(e.target.value)} className="input-base" placeholder="https://exemplo.com/foto.jpg" />
              </div>
            </div>

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

            {/* Tags */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Tags</label>
                <button type="button" onClick={() => setShowTagsManager(true)} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>
                  Gerir tags
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2 rounded" style={{ background: 'var(--surface-2)', minHeight: 40 }}>
                {allTags.length === 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Sem tags ainda. Cria uma em "Gerir tags".</span>}
                {allTags.map((tag) => {
                  const sel = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                      className="text-xs px-2 py-1 rounded font-medium"
                      style={{
                        background: sel ? tag.color : tag.color + '22',
                        color: sel ? '#fff' : tag.color,
                        border: `1px solid ${tag.color}`,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom fields */}
            {customFields.length > 0 && (
              <div className="border-t pt-3 space-y-3" style={{ borderColor: 'var(--border)' }}>
                {customFields.map((field) => (
                  <div key={field.id}>
                    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                      {field.name}{field.isRequired && ' *'}
                    </label>
                    <CustomFieldInput
                      field={field}
                      value={customValues[field.id] || ''}
                      onChange={(v) => setCustomValues((prev) => ({ ...prev, [field.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Leads associados */}
            {isEdit && contact?.leads && contact.leads.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                  Leads associados ({contact.leads.length})
                </p>
                <div className="space-y-1">
                  {contact.leads.map((lead) => (
                    <a key={lead.id} href={`/pipeline?leadId=${lead.id}`} className="flex items-center justify-between p-2 rounded hover:bg-slate-100 text-sm" style={{ background: 'var(--surface-2)' }}>
                      <div>
                        <div style={{ color: 'var(--text-primary)' }}>{lead.title}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{lead.pipeline?.name} · {lead.stage?.name}</div>
                      </div>
                      <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
              <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
                {loading ? <Loader2 size={16} className="animate-spin" /> : isEdit ? 'Guardar' : 'Criar Contacto'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showTagsManager && (
        <ManageTagsModal tags={allTags} onClose={() => setShowTagsManager(false)} onChanged={onTagsChanged} />
      )}
      {showFieldsManager && (
        <ManageContactFieldsModal onClose={() => setShowFieldsManager(false)} onChanged={() => { loadFields(); onFieldsChanged(); }} />
      )}
    </>
  );
}

// ============== Pagina principal ==============
export default function ContactsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();

  const [contacts, setContacts] = useState<ContactWithMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<TagType[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const [search, setSearch] = useState(globalSearchQuery || '');
  const [typeFilter, setTypeFilter] = useState<'' | 'PERSON' | 'COMPANY'>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('firstName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ContactWithMeta | null>(null);
  const [newTaskFor, setNewTaskFor] = useState<ContactWithMeta | null>(null);
  const [importing, setImporting] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showTagsManager, setShowTagsManager] = useState(false);
  const [columns, setColumns] = useState<Record<string, boolean>>(loadColumnsConfig);

  // Selecao multipla
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagId, setBulkTagId] = useState<string>('');

  // Criar lead a partir do contacto
  const [creatingLeadFor, setCreatingLeadFor] = useState<ContactWithMeta | null>(null);
  const [pipelinesForLead, setPipelinesForLead] = useState<any[]>([]);
  const [pipelineForLead, setPipelineForLead] = useState<{ id: string; stageId: string } | null>(null);

  useEffect(() => {
    localStorage.setItem(COLS_KEY, JSON.stringify(columns));
  }, [columns]);

  useEffect(() => setSearch(globalSearchQuery || ''), [globalSearchQuery]);

  const loadTags = () => {
    api.get('/tags').then(({ data }) => setTags(Array.isArray(data) ? data : [])).catch(() => setTags([]));
  };

  useEffect(() => {
    loadTags();
    api.get('/pipelines').then(({ data }) => setPipelinesForLead(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const loadContacts = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (typeFilter) params.set('type', typeFilter);
    if (tagFilter) params.set('tagId', tagFilter);
    if (assigneeFilter) params.set('assignedToId', assigneeFilter);
    params.set('limit', String(PAGE_SIZE));
    params.set('page', String(page));
    setLoading(true);
    api.get(`/contacts?${params.toString()}`)
      .then(({ data }) => {
        setContacts(data.contacts || []);
        setTotal(data.total || 0);
      })
      .catch(() => toast.error('Erro a carregar contactos'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadContacts();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, tagFilter, assigneeFilter, page]);

  // Quando muda filtro de pesquisa, voltar à página 1
  useEffect(() => { setPage(1); }, [search, typeFilter, tagFilter, assigneeFilter]);

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
      let av = a[sortKey]; let bv = b[sortKey];
      if (sortKey === 'createdAt') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
      else { av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase(); }
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
  const sortIcon = (key: SortKey) => sortKey !== key ? <ArrowUpDown size={12} /> : sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;

  const resetFilters = () => {
    setSearch(''); setGlobalSearchQuery(''); setTypeFilter(''); setTagFilter(''); setAssigneeFilter('');
  };

  const openEdit = async (contact: Contact) => {
    try {
      const { data } = await api.get(`/contacts/${contact.id}`);
      setEditing(data);
    } catch { toast.error('Erro a abrir contacto'); }
  };

  const handleDelete = async (contact: Contact) => {
    const leadCount = (contact as any)._count?.leads || 0;
    const msg = leadCount > 0
      ? `Eliminar "${contact.firstName} ${contact.lastName || ''}"? Tem ${leadCount} lead(s) associado(s).`
      : `Eliminar "${contact.firstName} ${contact.lastName || ''}"?`;
    if (!confirm(msg)) return;
    try {
      await api.delete(`/contacts/${contact.id}`);
      setContacts((p) => p.filter((c) => c.id !== contact.id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success('Contacto eliminado');
    } catch { toast.error('Erro a eliminar'); }
  };

  // Selecao
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = sortedContacts.length > 0 && sortedContacts.every((c) => selectedIds.has(c.id));
  const someSelected = !allSelected && sortedContacts.some((c) => selectedIds.has(c.id));
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sortedContacts.map((c) => c.id)));
  };
  const selectedArray = Array.from(selectedIds);

  const handleBulkDelete = async () => {
    if (selectedArray.length === 0) return;
    if (!confirm(`Eliminar ${selectedArray.length} contactos seleccionados?`)) return;
    try {
      const { data } = await api.post('/contacts/bulk-delete', { ids: selectedArray });
      setContacts((p) => p.filter((c) => !selectedIds.has(c.id)));
      setTotal((t) => Math.max(0, t - data.deleted));
      setSelectedIds(new Set());
      toast.success(`${data.deleted} eliminados`);
    } catch { toast.error('Erro a eliminar'); }
  };

  const handleBulkTag = async () => {
    if (!bulkTagId || selectedArray.length === 0) return;
    try {
      const { data } = await api.post('/contacts/bulk-tag', { ids: selectedArray, tagId: bulkTagId });
      toast.success(`Tag aplicada a ${data.added} contactos`);
      loadContacts();
      setBulkTagId('');
    } catch { toast.error('Erro'); }
  };

  const handleBulkExport = () => {
    const subset = sortedContacts.filter((c) => selectedIds.has(c.id));
    exportToCSV(subset);
  };

  const exportToCSV = (list: ContactWithMeta[]) => {
    if (list.length === 0) { toast.error('Nada para exportar'); return; }
    const escape = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const headers = ['Tipo', 'Nome', 'Apelido', 'Empresa', 'Cargo', 'Email', 'Telefone', 'WhatsApp', 'Website', 'Endereco', 'Cidade', 'Pais', 'Notas', 'Tags', 'Nr Leads', 'Criado em'];
    const rows = list.map((c: any) => [
      c.type === 'COMPANY' ? 'Empresa' : 'Pessoa',
      c.firstName || '', c.lastName || '', c.company || '', c.position || '',
      c.email || '', c.phone || '', c.whatsapp || '', c.website || '',
      c.address || '', c.city || '', c.country || '', c.notes || '',
      (c.tags || []).map((tc: any) => tc.tag?.name).filter(Boolean).join(';'),
      c._count?.leads || 0,
      c.createdAt ? new Date(c.createdAt).toLocaleString('pt-PT') : '',
    ].map(escape).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contactos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${list.length} contactos exportados`);
  };

  const cleanPhone = (p?: string) => (p || '').replace(/[^0-9+]/g, '');

  const handleCreateLeadForContact = (contact: ContactWithMeta) => {
    setEditing(null);
    setCreatingLeadFor(contact);
    const def = pipelinesForLead.find((p) => p.isDefault) || pipelinesForLead[0];
    if (def) setPipelineForLead({ id: def.id, stageId: def.stages?.[0]?.id || '' });
  };

  const hasFilters = !!(search || typeFilter || tagFilter || assigneeFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Contactos</h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{total} total</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowTagsManager(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Gerir tags">
            <TagsIcon size={14} /> Tags
          </button>
          <button onClick={() => setShowColumns(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Personalizar colunas">
            <Columns size={14} /> Colunas
          </button>
          <button onClick={() => setImporting(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Upload size={14} /> Importar
          </button>
          <button onClick={() => exportToCSV(sortedContacts)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <Download size={14} /> Exportar
          </button>
          <button onClick={() => setAdding(true)} className="btn btn-primary py-2 px-3"><Plus size={14} /> Novo Contacto</button>
        </div>
      </div>

      {/* Filtros */}
      <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="relative" style={{ minWidth: 240, flex: '1 1 240px' }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." className="input-base" style={{ paddingLeft: 32 }} />
        </div>
        <div className="flex items-center gap-1">
          {(['', 'PERSON', 'COMPANY'] as const).map((t) => (
            <button key={t || 'all'} onClick={() => setTypeFilter(t)} className="btn py-2 px-3"
              style={{ background: typeFilter === t ? 'var(--primary)' : 'var(--surface-3)', color: typeFilter === t ? '#fff' : 'var(--text-primary)' }}>
              {t === '' ? 'Todos' : t === 'PERSON' ? <><UserIcon size={12} /> Pessoas</> : <><Building2 size={12} /> Empresas</>}
            </button>
          ))}
        </div>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 140 }}>
          <option value="">Todas tags</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="input-base" style={{ width: 'auto', minWidth: 160 }} title="Filtrar por responsável">
          <option value="">Todos responsáveis</option>
          <option value="__none__">— Sem responsável —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {hasFilters && (
          <button onClick={resetFilters} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <RotateCcw size={14} /> Limpar
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedArray.length > 0 && (
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: 'var(--primary-light)', borderBottom: '1px solid var(--border)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>{selectedArray.length} seleccionado(s)</span>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>Limpar selecao</button>
          <span className="ml-auto flex items-center gap-2">
            <select value={bulkTagId} onChange={(e) => setBulkTagId(e.target.value)} className="input-base" style={{ padding: '4px 8px', fontSize: 12 }}>
              <option value="">Atribuir tag...</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={handleBulkTag} disabled={!bulkTagId} className="btn py-1 px-2 text-xs" style={{ background: 'var(--primary)', color: '#fff', opacity: bulkTagId ? 1 : 0.5 }}>Aplicar</button>
            <button onClick={handleBulkExport} className="btn py-1 px-2 text-xs" style={{ background: 'var(--surface)', color: 'var(--text-primary)' }}>
              <Download size={12} /> Exportar
            </button>
            <button onClick={handleBulkDelete} className="btn py-1 px-2 text-xs" style={{ background: '#FEF2F2', color: '#EF4444' }}>
              <Trash2 size={12} /> Eliminar
            </button>
          </span>
        </div>
      )}

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
        ) : sortedContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-6">
            <UserIcon size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{hasFilters ? 'Nenhum contacto corresponde aos filtros' : 'Sem contactos ainda'}</p>
            {!hasFilters && <button onClick={() => setAdding(true)} className="btn btn-primary mt-3 py-2 px-4"><Plus size={14} /> Criar primeiro contacto</button>}
          </div>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface-2)', position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="px-3 py-2 w-8">
                  <button onClick={toggleSelectAll}>
                    {allSelected ? <CheckSquare size={16} /> : someSelected ? <MinusSquare size={16} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                  </button>
                </th>
                {columns.name !== false && (
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <button onClick={() => toggleSort('firstName')} className="flex items-center gap-1 text-xs uppercase">Nome {sortIcon('firstName')}</button>
                  </th>
                )}
                {columns.company !== false && (
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <button onClick={() => toggleSort('company')} className="flex items-center gap-1 text-xs uppercase">Empresa {sortIcon('company')}</button>
                  </th>
                )}
                {columns.email !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Email</th>}
                {columns.phone !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Telefone</th>}
                {columns.whatsapp !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>WhatsApp</th>}
                {columns.city !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Cidade</th>}
                {columns.country !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Pais</th>}
                {columns.tags !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Tags</th>}
                {columns.leadsCount !== false && <th className="text-left px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Leads</th>}
                {columns.createdAt !== false && (
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <button onClick={() => toggleSort('createdAt')} className="flex items-center gap-1 text-xs uppercase">Criado {sortIcon('createdAt')}</button>
                  </th>
                )}
                <th className="text-right px-3 py-2 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>Accoes</th>
              </tr>
            </thead>
            <tbody>
              {sortedContacts.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50" style={{ borderBottom: '1px solid var(--border)', background: selectedIds.has(c.id) ? 'var(--primary-light)' : undefined }}>
                  <td className="px-3 py-2">
                    <button onClick={() => toggleSelect(c.id)}>
                      {selectedIds.has(c.id) ? <CheckSquare size={16} style={{ color: 'var(--primary)' }} /> : <Square size={16} style={{ color: 'var(--text-muted)' }} />}
                    </button>
                  </td>
                  {columns.name !== false && (
                    <td className="px-3 py-2">
                      <button onClick={() => openEdit(c)} className="flex items-center gap-2 hover:underline text-left">
                        {c.avatar ? (
                          <img src={c.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                        ) : c.type === 'COMPANY' ? <Building2 size={14} style={{ color: 'var(--text-muted)' }} /> : <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />}
                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.firstName} {c.lastName || ''}</span>
                      </button>
                    </td>
                  )}
                  {columns.company !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.company || (c.type === 'COMPANY' ? c.firstName : '—')}</td>}
                  {columns.email !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.email ? <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> : '—'}</td>}
                  {columns.phone !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.phone || '—'}</td>}
                  {columns.whatsapp !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.whatsapp || '—'}</td>}
                  {columns.city !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.city || '—'}</td>}
                  {columns.country !== false && <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{c.country || '—'}</td>}
                  {columns.tags !== false && (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags || []).map((tc: any) => tc.tag && (
                          <span key={tc.tag.id} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: tc.tag.color + '22', color: tc.tag.color }}>
                            {tc.tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  {columns.leadsCount !== false && (
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{c._count?.leads || 0}</span>
                    </td>
                  )}
                  {columns.createdAt !== false && <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleDateString('pt-PT')}</td>}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {(c.whatsapp || c.phone) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/inbox?contactId=${c.id}`); }}
                          className="p-1.5 rounded hover:bg-green-50"
                          title="Abrir chat WhatsApp deste contacto"
                        >
                          <MessageCircle size={14} style={{ color: '#25D366' }} />
                        </button>
                      )}
                      {c.phone && <a href={`tel:${cleanPhone(c.phone)}`} className="p-1.5 rounded hover:bg-slate-100" title="Telefonar" onClick={(e) => e.stopPropagation()}><PhoneCall size={14} style={{ color: 'var(--text-secondary)' }} /></a>}
                      {c.email && <a href={`mailto:${c.email}`} className="p-1.5 rounded hover:bg-slate-100" title="Email" onClick={(e) => e.stopPropagation()}><Mail size={14} style={{ color: 'var(--text-secondary)' }} /></a>}
                      <button onClick={(e) => { e.stopPropagation(); setNewTaskFor(c); }} className="p-1.5 rounded hover:bg-blue-50" title="Adicionar tarefa"><CheckSquare size={14} style={{ color: 'var(--primary)' }} /></button>
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-slate-100" title="Editar"><Edit3 size={14} style={{ color: 'var(--text-secondary)' }} /></button>
                      <button onClick={() => handleDelete(c)} className="p-1.5 rounded hover:bg-red-50" title="Eliminar"><Trash2 size={14} style={{ color: '#EF4444' }} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Paginação */}
        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between py-3 px-4" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              A mostrar {((page - 1) * PAGE_SIZE) + 1}-{Math.min(page * PAGE_SIZE, total)} de <strong>{total}</strong> contactos
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(1)} disabled={page === 1} className="btn text-xs py-1 px-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page === 1 ? 0.5 : 1 }}>« Primeira</button>
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="btn text-xs py-1 px-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page === 1 ? 0.5 : 1 }}>‹ Anterior</button>
              <span className="text-xs px-2" style={{ color: 'var(--text-secondary)' }}>
                Página <strong>{page}</strong> de <strong>{totalPages}</strong>
              </span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="btn text-xs py-1 px-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page >= totalPages ? 0.5 : 1 }}>Seguinte ›</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="btn text-xs py-1 px-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', opacity: page >= totalPages ? 0.5 : 1 }}>Última »</button>
            </div>
          </div>
        )}
      </div>

      {/* Modais */}
      {adding && (
        <ContactFormModal
          allTags={tags}
          onClose={() => setAdding(false)}
          onSaved={(contact) => { setContacts((p) => [contact as ContactWithMeta, ...p]); setTotal((t) => t + 1); }}
          onTagsChanged={loadTags}
          onFieldsChanged={() => {}}
        />
      )}
      {editing && (
        <ContactFormModal
          contact={editing}
          allTags={tags}
          onClose={() => setEditing(null)}
          onSaved={(contact) => setContacts((p) => p.map((c) => (c.id === contact.id ? { ...c, ...contact } as ContactWithMeta : c)))}
          onCreateLead={handleCreateLeadForContact}
          onTagsChanged={loadTags}
          onFieldsChanged={() => {}}
        />
      )}
      {importing && <ImportCSVModal onClose={() => setImporting(false)} onImported={loadContacts} />}
      {showColumns && <ColumnsModal columns={columns} onChange={setColumns} onClose={() => setShowColumns(false)} />}
      {showTagsManager && <ManageTagsModal tags={tags} onClose={() => setShowTagsManager(false)} onChanged={loadTags} />}

      {/* Modal de criar lead vindo de contacto */}
      {creatingLeadFor && pipelineForLead && (
        <CreateLeadForContactWrapper
          contact={creatingLeadFor}
          pipelines={pipelinesForLead}
          onClose={() => { setCreatingLeadFor(null); setPipelineForLead(null); }}
          onCreated={() => { setCreatingLeadFor(null); setPipelineForLead(null); loadContacts(); }}
        />
      )}

      {newTaskFor && (
        <QuickContactTaskModal
          contact={newTaskFor}
          onClose={() => setNewTaskFor(null)}
          onCreated={() => { setNewTaskFor(null); toast.success('Tarefa criada'); }}
        />
      )}
    </div>
  );
}

// ============== Mini modal: Nova Tarefa para Contacto ==============
function QuickContactTaskModal({ contact, onClose, onCreated }: {
  contact: ContactWithMeta;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { types: taskTypes, priorities: taskPriorities, lookupType, lookupPriority } = useTaskOptions();
  const defaultType = taskTypes.find((t) => t.value === 'FOLLOW_UP')?.value || taskTypes[0]?.value || 'FOLLOW_UP';
  const defaultPriority = taskPriorities.find((p) => p.value === 'MEDIUM')?.value || taskPriorities[0]?.value || 'MEDIUM';
  const fullName = `${contact.firstName}${contact.lastName ? ' ' + contact.lastName : ''}`;
  const [title, setTitle] = useState(`Seguir ${fullName}`);
  const [type, setType] = useState(defaultType);
  const [priority, setPriority] = useState(defaultPriority);
  const [dueAt, setDueAt] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<any | null>(null);

  const submit = async (force = false) => {
    setSaving(true);
    try {
      await api.post('/tasks', {
        title, type, priority,
        contactId: contact.id,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        force,
      });
      onCreated();
    } catch (e: any) {
      if (e.response?.status === 409) {
        setExisting(e.response.data.existingTask);
      } else {
        toast.error(e.response?.data?.message || 'Erro');
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base">Nova tarefa · {fullName}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {existing ? (
          <div className="space-y-3">
            <div className="card p-3" style={{ background: '#FEF3C7', border: '1px solid #FBBF24' }}>
              <p className="text-sm font-medium" style={{ color: '#92400E' }}>Já existe tarefa pendente:</p>
              <p className="text-sm mt-2 font-semibold">{existing.title}</p>
              <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                {existing.dueAt ? `Prazo: ${new Date(existing.dueAt).toLocaleString('pt-PT')}` : 'Sem prazo'} · {existing.priority} · {existing.status}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
              <button onClick={() => submit(true)} disabled={saving} className="btn btn-primary flex-1 py-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Criar mesmo assim'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base text-sm" placeholder="Título" />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="input-base text-sm"
                style={{ borderLeft: `4px solid ${lookupType(type).color || '#94A3B8'}` }}
              >
                {taskTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="input-base text-sm"
                style={{ borderLeft: `4px solid ${lookupPriority(priority).color || '#94A3B8'}` }}
              >
                {taskPriorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input-base text-sm" />
            <div className="flex gap-2 mt-2">
              <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
              <button onClick={() => submit(false)} disabled={saving || !title.trim()} className="btn btn-primary flex-1 py-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Criar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== Wrapper para criar lead a partir do contacto ==============
function CreateLeadForContactWrapper({
  contact,
  pipelines,
  onClose,
  onCreated,
}: {
  contact: ContactWithMeta;
  pipelines: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const def = pipelines.find((p) => p.isDefault) || pipelines[0];
  const [pipelineId, setPipelineId] = useState<string>(def?.id || '');
  const active = pipelines.find((p) => p.id === pipelineId);
  const [stageId, setStageId] = useState<string>(active?.stages?.[0]?.id || '');

  useEffect(() => {
    if (active?.stages?.[0]?.id) setStageId(active.stages[0].id);
  }, [pipelineId]); // eslint-disable-line

  if (!stageId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-[55] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
        <div className="card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Escolhe pipeline e etapa</h3>
          <div className="space-y-2">
            <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="input-base">
              {pipelines.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button onClick={onClose} className="btn w-full py-2 mt-4" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <AddLeadModal
      stageId={stageId}
      pipelineId={pipelineId}
      onClose={onClose}
      onCreated={async (lead) => {
        // ligar lead ao contacto
        try {
          await api.patch(`/leads/${lead.id}`, { contactId: contact.id });
          toast.success('Lead criado e associado ao contacto');
        } catch {}
        onCreated();
      }}
    />
  );
}
