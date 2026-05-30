import { useEffect, useState } from 'react';
import {
  Plus, Search, X, Loader2, Trash2, Edit3, FileDown, ScrollText, ChevronDown,
} from 'lucide-react';
import api, { Quote, QuoteItem, QuoteStatus, Product, Contact } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

function money(n: number, currency: string) {
  const s = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  const [int, dec] = s.split('.');
  return `${currency} ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`;
}

function computeTotals(items: QuoteItem[], opts: { discountType?: string; discountValue?: any; taxRate?: any }) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  let discountAmount = 0;
  if (opts.discountType === 'percent') discountAmount = subtotal * (Number(opts.discountValue) || 0) / 100;
  else if (opts.discountType === 'amount') discountAmount = Number(opts.discountValue) || 0;
  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
  const net = subtotal - discountAmount;
  const taxBefore = items.reduce((s, i) => {
    const line = (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    const rate = i.taxRate !== undefined && i.taxRate !== null && (i.taxRate as any) !== '' ? Number(i.taxRate) : (Number(opts.taxRate) || 0);
    return s + line * (rate / 100);
  }, 0);
  const tax = subtotal > 0 ? taxBefore * (net / subtotal) : 0;
  return { subtotal, discountAmount, tax, total: net + tax };
}

const STATUS: Record<QuoteStatus, { label: string; bg: string; color: string }> = {
  DRAFT: { label: 'Rascunho', bg: 'var(--surface-3)', color: 'var(--text-muted)' },
  SENT: { label: 'Enviada', bg: 'rgba(229,143,101,0.20)', color: '#B45309' },
  ACCEPTED: { label: 'Aceite', bg: 'rgba(45,74,62,0.16)', color: '#2D4A3E' },
  REJECTED: { label: 'Recusada', bg: 'rgba(239,68,68,0.12)', color: '#B91C1C' },
};

function dmy(d?: string | null) {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

// ==================== Modal criar/editar ====================
function QuoteModal({ quoteId, currency, onClose, onSaved }: {
  quoteId: string | null; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [loading, setLoading] = useState(!!quoteId);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'amount'>('none');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [items, setItems] = useState<QuoteItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          api.get('/contacts?limit=500'),
          api.get('/products?active=true'),
        ]);
        setContacts(cRes.data.contacts || cRes.data || []);
        setProducts(pRes.data || []);
        if (quoteId) {
          const { data } = await api.get(`/quotes/${quoteId}`);
          setTitle(data.title);
          setContactId(data.contactId || '');
          setNotes(data.notes || '');
          setValidUntil(data.validUntil ? data.validUntil.slice(0, 10) : '');
          setDiscountType(data.discountType || 'none');
          setDiscountValue(data.discountValue || 0);
          setItems(data.items || []);
        }
      } catch { toast.error('Erro ao carregar dados'); }
      finally { setLoading(false); }
    })();
  }, [quoteId]);

  const addBlank = () => setItems((p) => [...p, { description: '', quantity: 1, unitPrice: 0, taxRate: 0 }]);
  const addProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setItems((prev) => [...prev, { description: p.name, quantity: 1, unitPrice: p.unitPrice, taxRate: p.taxRate, productId: p.id }]);
  };
  const updateItem = (idx: number, k: keyof QuoteItem, v: any) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const totals = computeTotals(items, { discountType, discountValue, taxRate: 0 });

  const save = async () => {
    if (!title.trim()) { toast.error('Indica o título da proposta'); return; }
    if (items.length === 0) { toast.error('Adiciona pelo menos um item'); return; }
    setSaving(true);
    const payload = { title, contactId: contactId || null, notes, validUntil: validUntil || null, discountType, discountValue, currency, items };
    try {
      if (quoteId) await api.patch(`/quotes/${quoteId}`, payload);
      else await api.post('/quotes', payload);
      toast.success(quoteId ? 'Proposta actualizada' : 'Proposta criada');
      onSaved();
      onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro ao guardar'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{quoteId ? 'Editar proposta' : 'Nova proposta'}</h3>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--text-muted)' }} /></button>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Título *</label>
                <input className="input-base w-full mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Proposta de serviços de marketing" />
              </div>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Cliente</label>
                <select className="input-base w-full mt-1" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">Sem cliente associado</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.firstName} {c.lastName || ''}{c.company ? ` (${c.company})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Válida até</label>
                <input type="date" className="input-base w-full mt-1" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>

            {/* Itens */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Itens</label>
                <div className="flex items-center gap-2">
                  <select className="input-base text-xs py-1" value="" onChange={(e) => { if (e.target.value) addProduct(e.target.value); e.target.value = ''; }}>
                    <option value="">+ Do catálogo</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.unitPrice, p.currency)}</option>)}
                  </select>
                  <button className="btn text-xs py-1.5 flex items-center gap-1" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }} onClick={addBlank}><Plus size={13} /> Linha livre</button>
                </div>
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-center py-4 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}>Sem itens. Adiciona do catálogo ou uma linha livre.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-2 text-[11px] font-medium px-1" style={{ gridTemplateColumns: '1fr 70px 110px 70px 90px 28px', color: 'var(--text-muted)' }}>
                    <span>Descrição</span><span className="text-right">Qtd</span><span className="text-right">Preço</span><span className="text-right">IVA%</span><span className="text-right">Total</span><span></span>
                  </div>
                  {items.map((it, idx) => {
                    const line = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
                    return (
                      <div key={idx} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 70px 110px 70px 90px 28px' }}>
                        <input className="input-base text-sm" value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} placeholder="Descrição" />
                        <input type="number" step="0.01" className="input-base text-sm text-right" value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                        <input type="number" step="0.01" className="input-base text-sm text-right" value={it.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} />
                        <input type="number" step="0.01" className="input-base text-sm text-right" value={it.taxRate} onChange={(e) => updateItem(idx, 'taxRate', e.target.value)} />
                        <span className="text-sm text-right" style={{ color: 'var(--text-primary)' }}>{money(line, currency)}</span>
                        <button onClick={() => removeItem(idx)} className="p-1 rounded hover:bg-red-50"><Trash2 size={14} style={{ color: '#EF4444' }} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Desconto + totais */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Desconto</label>
                <div className="flex gap-2 mt-1">
                  <select className="input-base" value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
                    <option value="none">Sem desconto</option>
                    <option value="percent">Percentagem</option>
                    <option value="amount">Valor fixo</option>
                  </select>
                  {discountType !== 'none' && (
                    <input type="number" step="0.01" className="input-base w-24" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} />
                  )}
                </div>
              </div>
              <div className="rounded-lg p-3 text-sm space-y-1" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Subtotal</span><span>{money(totals.subtotal, currency)}</span></div>
                {totals.discountAmount > 0 && <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Desconto</span><span>- {money(totals.discountAmount, currency)}</span></div>}
                {totals.tax > 0 && <div className="flex justify-between" style={{ color: 'var(--text-muted)' }}><span>Imposto</span><span>{money(totals.tax, currency)}</span></div>}
                <div className="flex justify-between font-bold pt-1" style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--border)' }}><span>Total</span><span>{money(totals.total, currency)}</span></div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Notas e condições</label>
              <textarea className="input-base w-full mt-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: Validade de 30 dias. Pagamento 50% adiantado." />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }} onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || loading}>{saving ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

// ==================== Página ====================
export default function QuotesPage() {
  const { workspace } = useAuthStore();
  const currency = workspace?.currency || 'MZN';
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ id: string | null } | null>(null);
  const [statusMenu, setStatusMenu] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get('/quotes'); setQuotes(data); }
    catch { toast.error('Erro ao carregar propostas'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const del = async (q: Quote) => {
    if (!confirm(`Eliminar a proposta ${q.number}?`)) return;
    try { await api.delete(`/quotes/${q.id}`); setQuotes((prev) => prev.filter((x) => x.id !== q.id)); toast.success('Proposta eliminada'); }
    catch { toast.error('Erro ao eliminar'); }
  };

  const changeStatus = async (q: Quote, status: QuoteStatus) => {
    setStatusMenu(null);
    try { const { data } = await api.patch(`/quotes/${q.id}/status`, { status }); setQuotes((prev) => prev.map((x) => (x.id === q.id ? data : x))); toast.success(`Estado: ${STATUS[status].label}`); }
    catch { toast.error('Erro ao mudar estado'); }
  };

  const downloadPdf = async (q: Quote) => {
    try {
      const res = await api.get(`/quotes/${q.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('Erro ao gerar PDF'); }
  };

  const filtered = quotes.filter((q) =>
    !search.trim() || q.number.toLowerCase().includes(search.toLowerCase()) || q.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>Propostas</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cria orçamentos e propostas profissionais e descarrega-os em PDF.</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={() => setModal({ id: null })}>
          <Plus size={16} /> Nova proposta
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg max-w-sm" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
        <Search size={14} style={{ color: 'var(--text-muted)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar proposta..." className="flex-1 bg-transparent outline-none text-sm" style={{ color: 'var(--text-primary)' }} />
      </div>

      <div className="card overflow-visible">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <ScrollText size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ainda não tens propostas. Cria a primeira e descarrega-a em PDF.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                <th className="text-left px-4 py-2.5 font-medium">Número</th>
                <th className="text-left px-4 py-2.5 font-medium">Título</th>
                <th className="text-left px-4 py-2.5 font-medium">Cliente</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                <th className="text-left px-4 py-2.5 font-medium">Estado</th>
                <th className="text-left px-4 py-2.5 font-medium">Data</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{q.number}</td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setModal({ id: q.id })} className="font-medium text-left hover:underline" style={{ color: 'var(--text-primary)' }}>{q.title}</button>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{q.contact ? `${q.contact.firstName} ${q.contact.lastName || ''}` : '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium" style={{ color: 'var(--text-primary)' }}>{money(q.totals?.total || 0, q.currency)}</td>
                  <td className="px-4 py-2.5 relative">
                    <button onClick={() => setStatusMenu(statusMenu === q.id ? null : q.id)} className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: STATUS[q.status].bg, color: STATUS[q.status].color }}>
                      {STATUS[q.status].label} <ChevronDown size={11} />
                    </button>
                    {statusMenu === q.id && (
                      <div className="absolute top-full mt-1 left-4 z-30 rounded-lg shadow-lg py-1" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} onMouseLeave={() => setStatusMenu(null)}>
                        {(Object.keys(STATUS) as QuoteStatus[]).map((s) => (
                          <button key={s} onClick={() => changeStatus(q, s)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{STATUS[s].label}</button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>{dmy(q.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => downloadPdf(q)} className="p-1.5 rounded hover:bg-black/5" title="Descarregar PDF"><FileDown size={15} style={{ color: 'var(--primary)' }} /></button>
                      <button onClick={() => setModal({ id: q.id })} className="p-1.5 rounded hover:bg-black/5" title="Editar"><Edit3 size={15} style={{ color: 'var(--text-muted)' }} /></button>
                      <button onClick={() => del(q)} className="p-1.5 rounded hover:bg-red-50" title="Eliminar"><Trash2 size={15} style={{ color: '#EF4444' }} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && <QuoteModal quoteId={modal.id} currency={currency} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}
