import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, RotateCcw, Plus, Trash2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

// Editor dos textos da Sherone (Leiz Pro, Zona Nerd).
// Cada mensagem tem partes; cada parte sai como uma mensagem de WhatsApp.
// So se edita o texto: a ordem do fluxo e quando passa para a equipa
// continuam definidas pelo guia no Klaru.

export interface LeizProTextItem {
  key: string;
  group: string;
  label: string;
  help: string;
  vars: string[];
  questionLast: boolean;
  defaultParts: string[];
  parts: string[];
  custom: boolean;
}

export default function LeizProTextsPanel({ items: initial, onSaved }: { items: LeizProTextItem[]; onSaved: (items: LeizProTextItem[]) => void }) {
  const [items, setItems] = useState<LeizProTextItem[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { setItems(initial); }, [initial]);

  const groups = useMemo(() => {
    const map = new Map<string, LeizProTextItem[]>();
    for (const it of items) {
      if (!map.has(it.group)) map.set(it.group, []);
      map.get(it.group)!.push(it);
    }
    return [...map.entries()];
  }, [items]);

  const partsOf = (it: LeizProTextItem) => drafts[it.key] ?? it.parts;
  const isDirty = (it: LeizProTextItem) => drafts[it.key] !== undefined && JSON.stringify(drafts[it.key]) !== JSON.stringify(it.parts);

  const setPart = (it: LeizProTextItem, i: number, value: string) => {
    const next = [...partsOf(it)];
    next[i] = value;
    setDrafts({ ...drafts, [it.key]: next });
  };
  const addPart = (it: LeizProTextItem) => setDrafts({ ...drafts, [it.key]: [...partsOf(it), ''] });
  const removePart = (it: LeizProTextItem, i: number) => setDrafts({ ...drafts, [it.key]: partsOf(it).filter((_, j) => j !== i) });

  const send = async (it: LeizProTextItem, value: string[] | null) => {
    setSaving(it.key);
    try {
      await api.put('/sales-agent/leizpro/texts', { texts: { [it.key]: value } });
      const { data } = await api.get('/sales-agent/leizpro/texts');
      const { [it.key]: _, ...rest } = drafts;
      setDrafts(rest);
      setItems(data.items);
      onSaved(data.items);
      toast.success(value === null ? 'Texto do guia reposto' : 'Texto guardado. Vale a partir da próxima mensagem.');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao guardar');
    } finally { setSaving(null); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4 flex gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <Info size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
        <div className="space-y-1">
          <p>Aqui mudas <b>o que a Sherone escreve</b>. Cada caixa é uma mensagem de WhatsApp separada.</p>
          <p>Usa <code>[NOME]</code> para o primeiro nome do estudante. Os campos entre chavetas, como <code>{'{curso}'}</code>, são preenchidos pelo Klaru.</p>
          <p>A ordem das mensagens e quando a conversa passa para a equipa seguem o guia. Para mudar isso, fala com a equipa do Klaru.</p>
        </div>
      </div>

      {groups.map(([group, list]) => (
        <div key={group}>
          <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>{group}</h3>
          <div className="space-y-2">
            {list.map((it) => {
              const isOpen = open === it.key;
              const parts = partsOf(it);
              const dirty = isDirty(it);
              return (
                <div key={it.key} className="card" style={{ borderColor: dirty ? 'var(--primary)' : 'var(--border)' }}>
                  <button
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
                    onClick={() => setOpen(isOpen ? null : it.key)}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      {it.label}
                    </span>
                    <span className="flex items-center gap-2">
                      {dirty && <span className="text-xs" style={{ color: 'var(--primary)' }}>por guardar</span>}
                      {it.custom && !dirty && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>editado</span>
                      )}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {it.help}
                        {it.questionLast && ' A última mensagem é a pergunta: é ela que se repete se o estudante não responder.'}
                      </p>
                      {parts.map((p, i) => (
                        <div key={i} className="flex gap-2 items-start">
                          <span className="text-xs mt-2 w-5 text-right shrink-0" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                          <textarea
                            className="input w-full text-sm"
                            rows={Math.min(8, Math.max(2, Math.ceil(p.length / 70) + (p.match(/\n/g)?.length || 0)))}
                            value={p}
                            onChange={(e) => setPart(it, i, e.target.value)}
                          />
                          <button
                            className="mt-1 p-1.5 rounded"
                            title="Remover esta mensagem"
                            disabled={parts.length <= 1}
                            onClick={() => removePart(it, i)}
                            style={{ color: 'var(--text-muted)', opacity: parts.length <= 1 ? 0.3 : 1 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {parts.length < 6 && (
                          <button className="btn btn-outline text-xs flex items-center gap-1" onClick={() => addPart(it)}>
                            <Plus size={13} /> Mensagem
                          </button>
                        )}
                        <div className="flex-1" />
                        {(it.custom || dirty) && (
                          <button
                            className="btn btn-outline text-xs flex items-center gap-1"
                            disabled={saving === it.key}
                            onClick={() => {
                              if (!it.custom) { const { [it.key]: _, ...rest } = drafts; setDrafts(rest); return; }
                              if (window.confirm('Repor o texto original do guia nesta mensagem?')) send(it, null);
                            }}
                          >
                            <RotateCcw size={13} /> {it.custom ? 'Repor texto do guia' : 'Cancelar'}
                          </button>
                        )}
                        <button
                          className="btn btn-primary text-xs flex items-center gap-1"
                          disabled={!dirty || saving === it.key}
                          onClick={() => send(it, parts)}
                        >
                          {saving === it.key ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                        </button>
                      </div>
                      {it.custom && (
                        <details className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          <summary className="cursor-pointer">Ver o texto original do guia</summary>
                          <div className="mt-2 space-y-1">
                            {it.defaultParts.map((d, i) => (
                              <p key={i} className="whitespace-pre-wrap p-2 rounded" style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>{d}</p>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
