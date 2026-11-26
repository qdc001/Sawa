import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, RotateCcw, Plus, Trash2, ChevronDown, ChevronRight, Info, Download, RefreshCw } from 'lucide-react';
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

// Arrumar no pipeline "Leiz Pro · Zona Nerd" os estudantes ja atendidos
// (pela Sherone ou a mao). Nao envia mensagens.
function OrganizePipelineCard() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; byStage: Record<string, number> } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/sales-agent/leizpro/organize', { days }, { timeout: 300_000 });
      setResult(data);
      toast.success(`${data.total} estudantes arrumados no pipeline`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao organizar os contactos');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Organizar contactos no pipeline</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Põe no pipeline "Leiz Pro · Zona Nerd" os estudantes já atendidos, pela Sherone ou à mão, na etapa em que estão
          (Diagnóstico, Apresentação, Pacotes enviados, Régua, Escolheu o pacote). Só faz avançar, não mexe em leads ganhos ou perdidos e não envia mensagens.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span style={{ color: 'var(--text-secondary)' }}>Conversas dos:</span>
          <select className="input py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        <div className="flex-1" />
        <button className="btn btn-primary text-xs flex items-center gap-1" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Organizar
        </button>
      </div>
      {result && (
        <ul className="text-xs space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
          {Object.entries(result.byStage).map(([stage, n]) => <li key={stage}>{stage}: <b>{n}</b></li>)}
          {result.total === 0 && <li>Nenhum estudante para arrumar.</li>}
        </ul>
      )}
    </div>
  );
}

// Aplicar etapas a mao: "ref = etapa" por linha (a ref vem no ficheiro das
// conversas). Serve para corrigir onde cada estudante esta no pipeline.
function ApplyStagesCard() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ moved: string[]; errors: string[] } | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/sales-agent/leizpro/stages', { text }, { timeout: 300_000 });
      setResult(data);
      toast.success(`${data.moved.length} estudantes movidos`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao aplicar as etapas');
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Aplicar etapas</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Uma linha por estudante: <code>ref = etapa</code>. A ref aparece no ficheiro das conversas (ex.: <code>ref a1b2c3d4</code>).
          Exemplo: <code>a1b2c3d4 = Pacotes enviados</code>. Aqui pode mover para trás e "Pago" fecha o lead como ganho.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Opções depois de <code>;</code> (acertam também a Leiz): <code>paga 2026-11-30</code> (1.º follow-up de pagamento nesse dia às 12h),{' '}
          <code>pacote Pacote D (570 MZN)</code>, <code>leiz</code> (devolve a conversa à Leiz) e <code>tarefa texto</code> (tarefa para hoje).
          Nada é enviado no momento.
        </p>
      </div>
      <textarea className="input-base w-full text-xs font-mono" rows={5} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'a1b2c3d4 = Pacotes enviados\ne5f6g7h8 = Escolheu o pacote (falta pagar)'} />
      <div className="flex justify-end">
        <button className="btn btn-primary text-xs flex items-center gap-1" onClick={run} disabled={busy || !text.trim()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Aplicar
        </button>
      </div>
      {result && (
        <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
          {result.moved.map((m) => <div key={m}>✓ {m}</div>)}
          {result.errors.map((m) => <div key={m} style={{ color: '#B45309' }}>⚠ {m}</div>)}
        </div>
      )}
    </div>
  );
}

// Descarregar todas as conversas de WhatsApp num .txt, com as sugestoes da IA
// intercaladas, para analisar como a Leiz Pro se esta a portar.
function ExportConversationsCard() {
  const [days, setDays] = useState(7);
  const [onlyAi, setOnlyAi] = useState(true);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get('/sales-agent/leizpro/export', {
        params: { days, onlyAi: onlyAi ? '1' : '0' },
        responseType: 'blob',
        timeout: 120_000,
      });
      const dispo = res.headers['content-disposition'] || '';
      const match = dispo.match(/filename="?([^";]+)"?/i);
      const fname = match ? match[1] : `conversas_leizpro_${days}d.txt`;
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Conversas descarregadas');
    } catch (e: any) {
      let msg = 'Erro ao descarregar as conversas';
      if (e.response?.data instanceof Blob) {
        try { msg = JSON.parse(await e.response.data.text()).message || msg; } catch { /* ignora */ }
      }
      toast.error(msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Descarregar conversas</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Todas as conversas de WhatsApp num só ficheiro de texto, com o que a Sherone propôs em cada momento e se foi aprovado, editado ou descartado. Os números de telefone saem escondidos.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span style={{ color: 'var(--text-secondary)' }}>Período:</span>
          <select className="input py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Último dia</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={onlyAi} onChange={(e) => setOnlyAi(e.target.checked)} />
          <span style={{ color: 'var(--text-secondary)' }}>Só conversas onde a IA respondeu</span>
        </label>
        <div className="flex-1" />
        <button className="btn btn-primary text-xs flex items-center gap-1" onClick={download} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Descarregar
        </button>
      </div>
    </div>
  );
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
    // Grupos numerados ("3b. Régua", "3c. Follow-ups"): pela ordem do número.
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt', { numeric: true }));
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
      const { data: saved } = await api.put('/sales-agent/leizpro/texts', { texts: { [it.key]: value } });
      const { data } = await api.get('/sales-agent/leizpro/texts');
      const { [it.key]: _, ...rest } = drafts;
      setDrafts(rest);
      setItems(data.items);
      onSaved(data.items);
      const refreshed = Number(saved?.refreshed || 0);
      toast.success(`${value === null ? 'Texto do guia reposto' : 'Texto guardado. Vale a partir da próxima mensagem.'}${refreshed ? ` ${refreshed} follow-up(s) por aprovar foram actualizados.` : ''}`);
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

      <OrganizePipelineCard />
      <ExportConversationsCard />
      <ApplyStagesCard />

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
