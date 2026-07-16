// Painel de gestao da Base de Conhecimento da Leizy (Sprint 4.1).
// Usa-se dentro da pagina Leizy (SalesAgentPage) como uma tab nova.
// Admin escreve tabelas de precos, listas de procedimentos, planos de saude
// aceites, protocolos internos. A Leizy usa-os para responder.

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, X, BookOpen, Save } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface KnowledgeDoc {
  id: string;
  title: string;
  category: string | null;
  sourceType: string;
  fileSizeKb: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { chunks: number };
  content?: string;
}

const CATEGORY_PRESETS = [
  'precos',
  'procedimentos',
  'planos-saude',
  'protocolos',
  'faq',
  'geral',
];

export default function LeizyKnowledgePanel() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<KnowledgeDoc | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/knowledge')
      .then(({ data }) => setDocs(data))
      .catch(() => toast.error('Erro a carregar base de conhecimento'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const del = async (d: KnowledgeDoc) => {
    if (!confirm(`Eliminar "${d.title}"? A Leizy deixa de usar este documento.`)) return;
    try {
      await api.delete(`/knowledge/${d.id}`);
      setDocs((p) => p.filter((x) => x.id !== d.id));
      toast.success('Documento eliminado');
    } catch { toast.error('Erro a eliminar'); }
  };

  const toggleActive = async (d: KnowledgeDoc) => {
    try {
      const { data } = await api.patch(`/knowledge/${d.id}`, { isActive: !d.isActive });
      setDocs((p) => p.map((x) => (x.id === d.id ? { ...x, ...data } : x)));
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Base de conhecimento</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Documentos que a Leizy pode usar como fonte de verdade: tabela de preços, lista de procedimentos, planos de saúde aceites, protocolos. Cada documento é fatiado em pedaços que a Leizy pesquisa quando a mensagem do paciente é relevante.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
        >
          <Plus size={14} /> Novo documento
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--text-muted)' }} /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
          <BookOpen size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sem documentos. Cria o primeiro para a Leizy aprender.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="rounded-lg p-3 flex items-center gap-3"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', opacity: d.isActive ? 1 : 0.5 }}
            >
              <BookOpen size={16} style={{ color: 'var(--primary)' }} />
              <button onClick={() => api.get(`/knowledge/${d.id}`).then(({ data }) => setEditing(data))} className="flex-1 text-left min-w-0">
                <p className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{d.title}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {d.category ? `${d.category} · ` : ''}{d._count?.chunks || 0} fragmento(s) · {d.fileSizeKb} kB
                </p>
              </button>
              <label className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={d.isActive} onChange={() => toggleActive(d)} />
                Activo
              </label>
              <button onClick={() => del(d)} className="p-1 rounded hover:bg-red-50">
                <Trash2 size={14} style={{ color: '#DC2626' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <KnowledgeDocEditor
          doc={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(saved, chunksCreated) => {
            if (editing) {
              setDocs((p) => p.map((x) => (x.id === saved.id ? { ...x, ...saved, _count: { chunks: chunksCreated || x._count?.chunks || 0 } } : x)));
            } else {
              load();
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ============ Editor ============
function KnowledgeDocEditor({
  doc, onClose, onSaved,
}: {
  doc: KnowledgeDoc | null;
  onClose: () => void;
  onSaved: (saved: KnowledgeDoc, chunksCreated?: number) => void;
}) {
  const isEdit = !!doc?.id;
  const [title, setTitle] = useState(doc?.title || '');
  const [category, setCategory] = useState(doc?.category || 'geral');
  const [content, setContent] = useState(doc?.content || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) { toast.error('Título obrigatório'); return; }
    if (!content.trim()) { toast.error('Conteúdo obrigatório'); return; }
    setSaving(true);
    try {
      const body = { title: title.trim(), category, content: content.trim() };
      const { data } = isEdit
        ? await api.patch(`/knowledge/${doc!.id}`, body)
        : await api.post('/knowledge', body);
      toast.success(isEdit ? 'Documento actualizado' : 'Documento criado');
      onSaved(data, data.chunksCreated);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-bold text-base">{isEdit ? 'Editar documento' : 'Novo documento'}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Título *</label>
            <input
              className="input-base w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tabela de preços 2026, Planos de saúde aceites, ..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Categoria</label>
            <div className="flex flex-wrap gap-1">
              {CATEGORY_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: category === c ? 'var(--primary)' : 'var(--surface-3)',
                    color: category === c ? 'white' : 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              Conteúdo *
              <span className="ml-2 opacity-60">({content.length} caracteres)</span>
            </label>
            <textarea
              className="input-base w-full"
              rows={16}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Cola aqui a tabela de preços, o texto do procedimento, a lista dos planos de saúde aceites..."
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Separa secções com uma linha em branco. O sistema divide em pedaços de ~500 palavras cada, e a Leizy pesquisa o pedaço mais relevante para cada mensagem do paciente.
            </p>
          </div>
        </div>
        <div className="p-4 flex gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={saving} className="btn btn-primary flex-1 py-2 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <><Save size={14} /> Guardar</>}
          </button>
        </div>
      </div>
    </div>
  );
}
