import { useEffect, useState } from 'react';
import { Plus, Search, X, Loader2, Trash2, Edit3, Package } from 'lucide-react';
import api, { Product } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

function money(n: number, currency: string) {
  const s = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  const [int, dec] = s.split('.');
  return `${currency} ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`;
}

const empty = (currency: string): Partial<Product> => ({
  name: '', description: '', sku: '', unitPrice: 0, currency, taxRate: 0, unit: '', isActive: true,
});

function ProductModal({ initial, currency, onClose, onSaved }: {
  initial: Partial<Product>; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(initial);
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial.id;

  const save = async () => {
    if (!form.name?.trim()) { toast.error('Indica o nome do produto'); return; }
    setSaving(true);
    try {
      if (isEdit) await api.patch(`/products/${initial.id}`, form);
      else await api.post('/products', form);
      toast.success(isEdit ? 'Produto actualizado' : 'Produto criado');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao guardar');
    } finally { setSaving(false); }
  };

  const set = (k: keyof Product, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{isEdit ? 'Editar produto' : 'Novo produto'}</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Nome *</label>
            <input className="input-base w-full mt-1" value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Consultoria mensal" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Descrição</label>
            <textarea className="input-base w-full mt-1" rows={2} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Preço ({currency})</label>
              <input type="number" step="0.01" className="input-base w-full mt-1" value={form.unitPrice ?? 0} onChange={(e) => set('unitPrice', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Imposto (%)</label>
              <input type="number" step="0.01" className="input-base w-full mt-1" value={form.taxRate ?? 0} onChange={(e) => set('taxRate', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>SKU / Código</label>
              <input className="input-base w-full mt-1" value={form.sku || ''} onChange={(e) => set('sku', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Unidade</label>
              <input className="input-base w-full mt-1" value={form.unit || ''} onChange={(e) => set('unit', e.target.value)} placeholder="hora, mês, unidade" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={form.isActive !== false} onChange={(e) => set('isActive', e.target.checked)} />
            Activo (disponível para propostas)
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }} onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const { workspace } = useAuthStore();
  const currency = workspace?.currency || 'MZN';
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<Partial<Product> | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products');
      setProducts(data);
    } catch { toast.error('Erro ao carregar produtos'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const del = async (p: Product) => {
    if (!confirm(`Eliminar o produto "${p.name}"?`)) return;
    try { await api.delete(`/products/${p.id}`); setProducts((prev) => prev.filter((x) => x.id !== p.id)); toast.success('Produto eliminado'); }
    catch { toast.error('Erro ao eliminar'); }
  };

  const filtered = products.filter((p) =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>Produtos</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>O teu catálogo de produtos e serviços para usar nas propostas.</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={() => setModal(empty(currency))}>
          <Plus size={16} /> Novo produto
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg max-w-sm" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--text-muted)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar produto..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className="flex-1 bg-transparent outline-none text-sm" style={{ color: 'var(--text-primary)' }} />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Package size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ainda não tens produtos. Cria o primeiro para o usar nas propostas.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                <th className="text-left px-4 py-2.5 font-medium">Produto</th>
                <th className="text-left px-4 py-2.5 font-medium">SKU</th>
                <th className="text-right px-4 py-2.5 font-medium">Preço</th>
                <th className="text-right px-4 py-2.5 font-medium">Imposto</th>
                <th className="text-center px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                    {p.description && <p className="text-xs truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>{p.description}</p>}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{p.sku || '—'}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{money(p.unitPrice, p.currency)}{p.unit ? <span style={{ color: 'var(--text-muted)' }}> /{p.unit}</span> : ''}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{p.taxRate ? `${p.taxRate}%` : '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: p.isActive ? 'rgba(45,74,62,0.12)' : 'var(--surface-3)', color: p.isActive ? '#2D4A3E' : 'var(--text-muted)' }}>
                      {p.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModal(p)} className="p-1.5 rounded hover:bg-black/5" title="Editar"><Edit3 size={15} style={{ color: 'var(--text-muted)' }} /></button>
                      <button onClick={() => del(p)} className="p-1.5 rounded hover:bg-red-50" title="Eliminar"><Trash2 size={15} style={{ color: '#EF4444' }} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && <ProductModal initial={modal} currency={currency} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}
