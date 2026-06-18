import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, FileText, Image as ImageIcon, Video, Music, File as FileIcon, Loader2, Check, X } from 'lucide-react';
import api, { ProductFile } from '../../lib/api';
import toast from 'react-hot-toast';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function safeMediaUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  // URL absoluta: garante HTTPS quando a app corre em HTTPS.
  if (/^https?:\/\//.test(u)) {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && u.startsWith('http://')) {
      return 'https://' + u.slice('http://'.length);
    }
    return u;
  }
  // Caminho relativo (ex: /uploads/xxx): prefixa com o host do backend.
  return `${API_BASE}${u.startsWith('/') ? u : '/' + u}`;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileKindIcon({ mimeType, size = 18 }: { mimeType: string; size?: number }) {
  if (mimeType.startsWith('image/')) return <ImageIcon size={size} />;
  if (mimeType.startsWith('video/')) return <Video size={size} />;
  if (mimeType.startsWith('audio/')) return <Music size={size} />;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return <FileText size={size} />;
  return <FileIcon size={size} />;
}

interface Props {
  productId: string;
}

export default function ProductFilesPanel({ productId }: Props) {
  const [files, setFiles] = useState<ProductFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<{ id: string; label: string; description: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/products/${productId}/files`);
      setFiles(data);
    } catch {
      toast.error('Erro ao carregar ficheiros');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productId]);

  const uploadFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setUploading(true);
    let ok = 0;
    for (const f of arr) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        await api.post(`/products/${productId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        ok++;
      } catch (e: any) {
        toast.error(`Falhou ${f.name}: ${e.response?.data?.message || 'erro'}`);
      }
    }
    setUploading(false);
    if (ok > 0) {
      toast.success(`${ok} ${ok === 1 ? 'ficheiro carregado' : 'ficheiros carregados'}`);
      load();
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const del = async (f: ProductFile) => {
    if (!confirm(`Eliminar "${f.label || f.name}"?`)) return;
    try {
      await api.delete(`/products/${productId}/files/${f.id}`);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
      toast.success('Ficheiro eliminado');
    } catch { toast.error('Erro ao eliminar'); }
  };

  const startEdit = (f: ProductFile) => {
    setEditing({ id: f.id, label: f.label || '', description: f.description || '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const { data } = await api.patch(`/products/${productId}/files/${editing.id}`, {
        label: editing.label,
        description: editing.description,
      });
      setFiles((prev) => prev.map((x) => (x.id === editing.id ? data : x)));
      setEditing(null);
      toast.success('Actualizado');
    } catch { toast.error('Erro ao guardar'); }
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg p-5 mb-3 cursor-pointer text-center transition-colors"
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border)'}`,
          background: dragOver ? 'var(--primary-light)' : 'var(--surface-2)',
        }}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={16} className="animate-spin" /> A carregar...
          </div>
        ) : (
          <>
            <Upload size={22} className="mx-auto mb-1" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Arrasta ficheiros para aqui ou clica para escolher</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Imagens, PDFs, vídeos, brochuras. Máx 25 MB cada.</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {loading ? (
        <div className="p-6 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      ) : files.length === 0 ? (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>Ainda sem ficheiros associados a este produto.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => {
            const isImg = f.mimeType.startsWith('image/');
            const url = safeMediaUrl(f.url);
            const isEditing = editing?.id === f.id;
            return (
              <li key={f.id} className="rounded-lg p-3 flex gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex-shrink-0">
                  {isImg && url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="" className="rounded object-cover" style={{ width: 56, height: 56 }} />
                    </a>
                  ) : (
                    <div className="rounded flex items-center justify-center" style={{ width: 56, height: 56, background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                      <FileKindIcon mimeType={f.mimeType} size={24} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <input
                        className="input-base w-full text-sm"
                        placeholder="Rótulo (ex: Brochura 2026)"
                        value={editing!.label}
                        onChange={(e) => setEditing({ ...editing!, label: e.target.value })}
                        autoFocus
                      />
                      <textarea
                        className="input-base w-full text-xs"
                        rows={2}
                        placeholder="Descrição curta para a IA saber quando usar este ficheiro"
                        value={editing!.description}
                        onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {f.label || f.name}
                      </p>
                      {f.description && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{f.description}</p>
                      )}
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {f.name} <span className="mx-1">•</span> {humanSize(f.size)}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {isEditing ? (
                    <>
                      <button onClick={saveEdit} className="p-1.5 rounded hover:bg-black/5" title="Guardar">
                        <Check size={15} style={{ color: 'var(--primary)' }} />
                      </button>
                      <button onClick={() => setEditing(null)} className="p-1.5 rounded hover:bg-black/5" title="Cancelar">
                        <X size={15} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(f)} className="p-1.5 rounded hover:bg-black/5" title="Editar rótulo">
                        <FileText size={15} style={{ color: 'var(--text-muted)' }} />
                      </button>
                      <button onClick={() => del(f)} className="p-1.5 rounded hover:bg-red-50" title="Eliminar">
                        <Trash2 size={15} style={{ color: '#EF4444' }} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
