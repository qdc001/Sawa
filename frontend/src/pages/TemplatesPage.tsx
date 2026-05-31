import { useEffect, useState } from 'react';
import {
  Plus, X, Loader2, Trash2, Edit3, Copy, FileText, Search, RotateCcw,
} from 'lucide-react';
import api, { MessageTemplate as MessageTemplateType } from '../lib/api';
import toast from 'react-hot-toast';
import { useUIStore } from '../store';

const CHANNELS = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'TELEGRAM', 'WEBCHAT', 'SMS'];
const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE'];
const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  MARKETING: { bg: '#FEE2E2', fg: '#991B1B' },
  UTILITY: { bg: '#DBEAFE', fg: '#1E40AF' },
  AUTHENTICATION: { bg: '#FEF3C7', fg: '#92400E' },
  SERVICE: { bg: '#D1FAE5', fg: '#065F46' },
};

function TemplateModal({
  template, onClose, onSaved,
}: {
  template?: MessageTemplateType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!template?.id;
  const [name, setName] = useState(template?.name || '');
  const [content, setContent] = useState(template?.content || '');
  const [channel, setChannel] = useState(template?.channel || 'WHATSAPP');
  const [category, setCategory] = useState(template?.category || 'SERVICE');
  const [variablesText, setVariablesText] = useState((template?.variables || []).join(', '));
  const [loading, setLoading] = useState(false);

  const detectVariables = () => {
    const matches = content.match(/\{\{\s*(\w+)\s*\}\}/g) || [];
    const vars = Array.from(new Set(matches.map((m) => m.replace(/[{}\s]/g, ''))));
    setVariablesText(vars.join(', '));
    toast.success(`${vars.length} variaveis detectadas`);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) { toast.error('Nome e conteudo obrigatórios'); return; }
    setLoading(true);
    try {
      const variables = variablesText.split(',').map((s) => s.trim()).filter(Boolean);
      if (isEdit) {
        await api.patch(`/templates/${template!.id}`, { name, content, channel, category, variables });
        toast.success('Template actualizado');
      } else {
        await api.post('/templates', { name, content, channel, category, variables });
        toast.success('Template criado');
      }
      onSaved();
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{isEdit ? 'Editar template' : 'Novo template'}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nome *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" placeholder="Ex: Boas-vindas WhatsApp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Canal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-base">
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="input-base">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Conteudo *</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} className="input-base" rows={8}
              placeholder="Ola {{nome}}, obrigado pelo contacto..." />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Usa chavetas duplas para variaveis dinamicas.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Variaveis (separadas por virgula)</label>
              <button type="button" onClick={detectVariables} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>
                Detectar do conteudo
              </button>
            </div>
            <input value={variablesText} onChange={(e) => setVariablesText(e.target.value)} className="input-base" placeholder="nome, empresa, link" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();
  const [templates, setTemplates] = useState<MessageTemplateType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(globalSearchQuery || '');
  const [channelFilter, setChannelFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState<MessageTemplateType | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => setSearch(globalSearchQuery || ''), [globalSearchQuery]);

  const load = () => {
    setLoading(true);
    api.get('/templates').then(({ data }) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Erro a carregar'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const handleDelete = async (t: MessageTemplateType) => {
    if (!confirm(`Eliminar template "${t.name}"?`)) return;
    try {
      await api.delete(`/templates/${t.id}`);
      setTemplates((p) => p.filter((x) => x.id !== t.id));
      toast.success('Eliminado');
    } catch { toast.error('Erro'); }
  };

  const handleCopy = (t: MessageTemplateType) => {
    navigator.clipboard.writeText(t.content);
    toast.success('Conteudo copiado');
  };

  const filtered = templates.filter((t) => {
    if (channelFilter && t.channel !== channelFilter) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilters = !!(search || channelFilter || categoryFilter);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText size={18} /> Templates</h1>
        <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{filtered.length}</span>
        <button onClick={() => setCreating(true)} className="btn btn-primary py-2 px-3 ml-auto">
          <Plus size={14} /> Novo Template
        </button>
      </div>

      <div className="p-3 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="relative" style={{ minWidth: 220, flex: '1 1 220px' }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className="input-base" style={{ paddingLeft: 32 }} />
        </div>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
          <option value="">Todos os canais</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="input-base" style={{ width: 'auto' }}>
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setGlobalSearchQuery(''); setChannelFilter(''); setCategoryFilter(''); }}
            className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <RotateCcw size={14} /> Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FileText size={32} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {hasFilters ? 'Nenhum template corresponde aos filtros' : 'Sem templates ainda'}
            </p>
            {!hasFilters && (
              <button onClick={() => setCreating(true)} className="btn btn-primary mt-3 py-2 px-4">
                <Plus size={14} /> Criar primeiro template
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
              <div key={t.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>{t.name}</h3>
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ background: CATEGORY_COLORS[t.category]?.bg, color: CATEGORY_COLORS[t.category]?.fg }}>
                    {t.category}
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.channel}</span>
                <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', flex: 1, maxHeight: 100, overflow: 'hidden' }}>{t.content}</p>
                {t.variables && t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map((v) => (
                      <span key={v} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => handleCopy(t)} className="btn py-1 px-2 text-xs" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                    <Copy size={11} /> Copiar
                  </button>
                  <button onClick={() => setEditing(t)} className="btn py-1 px-2 text-xs ml-auto" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                    <Edit3 size={11} />
                  </button>
                  <button onClick={() => handleDelete(t)} className="btn py-1 px-2 text-xs" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && <TemplateModal onClose={() => setCreating(false)} onSaved={load} />}
      {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
