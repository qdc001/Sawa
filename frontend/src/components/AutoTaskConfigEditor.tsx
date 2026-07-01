// Editor de configuracao da auto-tarefa (Definicoes > Auto-tarefa).
//
// Permite ao admin:
//  - Editar tipos de trabalho (label, artigo, possessivo)
//  - Editar os textos dos templates (anuncio, entrega, titulo tarefa,
//    titulo follow-up)
//  - Definir dias para o follow-up
//  - Repor os defaults

import { useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw, Trash2, Plus, Info } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

type WorkType = {
  key: string;
  label: string;
  article: string;
  possessive: string;
};

type Subject = {
  label: string;
  article: string;
  possessive: string;
};

type Config = {
  workTypes: WorkType[];
  subjects: Subject[];
  announceTemplate: string;
  deliverTemplate: string;
  announceTaskTitleTemplate: string;
  followupTitleTemplate: string;
  followupDays: number;
};

const ARTICLES = ['o', 'a', 'os', 'as'];
const POSSESSIVES = ['teu', 'tua', 'teus', 'tuas'];

export default function AutoTaskConfigEditor() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCustom, setIsCustom] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/auto-task/config');
      setConfig(data.config);
      setIsCustom(!!data.isCustom);
    } catch {
      toast.error('Erro a carregar configuração');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      // Garantir keys unicas (usar label lowercased sem espacos se vazia)
      const cleanTypes = config.workTypes
        .filter((t) => t.label.trim())
        .map((t) => ({
          ...t,
          key: (t.key || t.label).toLowerCase().replace(/\s+/g, '_'),
        }));
      await api.patch('/auto-task/config', { ...config, workTypes: cleanTypes });
      toast.success('Configuração guardada');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm('Repor os valores por defeito? A configuração personalizada será perdida.')) return;
    setSaving(true);
    try {
      await api.patch('/auto-task/config', { reset: true });
      toast.success('Configuração reposta');
      load();
    } catch { toast.error('Erro a repor'); } finally { setSaving(false); }
  };

  const updateType = (idx: number, patch: Partial<WorkType>) => {
    setConfig((c) => {
      if (!c) return c;
      const arr = [...c.workTypes];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...c, workTypes: arr };
    });
  };

  const addType = () => {
    setConfig((c) => c ? { ...c, workTypes: [...c.workTypes, { key: '', label: '', article: 'o', possessive: 'teu' }] } : c);
  };

  const removeType = (idx: number) => {
    setConfig((c) => c ? { ...c, workTypes: c.workTypes.filter((_, i) => i !== idx) } : c);
  };

  if (loading || !config) {
    return <div className="card p-6 flex justify-center"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--text-muted)' }} /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Auto-tarefa</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Configura os tipos de trabalho e os textos usados pelo botão "Enviar com tarefa" no Inbox.
            </p>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded" style={{
            background: isCustom ? '#DBEAFE' : 'var(--surface-2)',
            color: isCustom ? '#1E40AF' : 'var(--text-muted)',
          }}>
            {isCustom ? 'Personalizado' : 'Default'}
          </span>
        </div>

        {/* Tipos de trabalho */}
        <div className="mt-4">
          <label className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Tipos de trabalho</label>
          <p className="text-[11px] mt-1 mb-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Info size={11} /> Artigo e possessivo garantem concordância: "da tua monografia" vs "do teu projecto". Mantém um tipo com a chave "outros" para permitir texto livre no modal.
          </p>
          <div className="space-y-2">
            {config.workTypes.map((t, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="input-base col-span-5"
                  placeholder="Nome (ex: Monografia)"
                  value={t.label}
                  onChange={(e) => updateType(i, { label: e.target.value })}
                />
                <select
                  className="input-base col-span-2"
                  value={t.article}
                  onChange={(e) => updateType(i, { article: e.target.value })}
                  title="Artigo definido"
                >
                  {ARTICLES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select
                  className="input-base col-span-3"
                  value={t.possessive}
                  onChange={(e) => updateType(i, { possessive: e.target.value })}
                  title="Possessivo"
                >
                  {POSSESSIVES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  className="input-base col-span-1 text-[10px]"
                  placeholder="key"
                  value={t.key}
                  onChange={(e) => updateType(i, { key: e.target.value })}
                  title="Chave interna (sem espaços)"
                />
                <button
                  onClick={() => removeType(i)}
                  className="col-span-1 p-1 rounded hover:bg-red-50 flex justify-center"
                  title="Remover"
                >
                  <Trash2 size={14} style={{ color: '#DC2626' }} />
                </button>
              </div>
            ))}
            <button
              onClick={addType}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5"
              style={{ color: 'var(--primary)' }}
            >
              <Plus size={12} /> Adicionar tipo
            </button>
          </div>
        </div>

        {/* Assuntos frequentes */}
        <div className="mt-6">
          <label className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Assuntos frequentes</label>
          <p className="text-[11px] mt-1 mb-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Info size={11} /> Aparecem no dropdown "Assunto" do modal. Artigo e possessivo permitem concordancia em frases como "pedir feedback da Versao preliminar".
          </p>
          <div className="space-y-2">
            {config.subjects.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="input-base col-span-6"
                  placeholder="Assunto (ex: Versao preliminar)"
                  value={s.label}
                  onChange={(e) => {
                    const next = [...config.subjects];
                    next[i] = { ...next[i], label: e.target.value };
                    setConfig({ ...config, subjects: next });
                  }}
                />
                <select
                  className="input-base col-span-2"
                  value={s.article}
                  onChange={(e) => {
                    const next = [...config.subjects];
                    next[i] = { ...next[i], article: e.target.value };
                    setConfig({ ...config, subjects: next });
                  }}
                  title="Artigo definido"
                >
                  {ARTICLES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select
                  className="input-base col-span-3"
                  value={s.possessive}
                  onChange={(e) => {
                    const next = [...config.subjects];
                    next[i] = { ...next[i], possessive: e.target.value };
                    setConfig({ ...config, subjects: next });
                  }}
                  title="Possessivo"
                >
                  {POSSESSIVES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button
                  onClick={() => setConfig({ ...config, subjects: config.subjects.filter((_, x) => x !== i) })}
                  className="col-span-1 p-1 rounded hover:bg-red-50 flex justify-center"
                  title="Remover"
                >
                  <Trash2 size={14} style={{ color: '#DC2626' }} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setConfig({ ...config, subjects: [...config.subjects, { label: 'Novo assunto', article: 'a', possessive: 'tua' }] })}
              className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-black/5"
              style={{ color: 'var(--primary)' }}
            >
              <Plus size={12} /> Adicionar assunto
            </button>
          </div>
        </div>

        {/* Templates de texto */}
        <div className="mt-6 space-y-3">
          <label className="text-xs uppercase font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>Textos das mensagens</label>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Placeholders: <code>{'{nome}'}</code>, <code>{'{assunto}'}</code>, <code>{'{tipo}'}</code>, <code>{'{data}'}</code>. Concordância do <b>tipo</b>: <code>{'{artigo}'}</code>, <code>{'{possessivo}'}</code>. Concordância do <b>assunto</b>: <code>{'{artigoAssunto}'}</code>, <code>{'{possAssunto}'}</code>. Prefixa com <code>d</code> (ex. <code>{'d{artigo}'}</code> ou <code>{'d{artigoAssunto}'}</code>) para gerar "da"/"do"/"dos" automaticamente.
          </p>

          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Anúncio ("Vou enviar")</label>
            <textarea
              className="input-base w-full mt-1"
              rows={2}
              value={config.announceTemplate}
              onChange={(e) => setConfig({ ...config, announceTemplate: e.target.value })}
            />
          </div>

          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Entrega ("Envio em anexo")</label>
            <textarea
              className="input-base w-full mt-1"
              rows={2}
              value={config.deliverTemplate}
              onChange={(e) => setConfig({ ...config, deliverTemplate: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Título da tarefa (anúncio)</label>
              <input
                className="input-base w-full mt-1"
                value={config.announceTaskTitleTemplate}
                onChange={(e) => setConfig({ ...config, announceTaskTitleTemplate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Título da tarefa (follow-up)</label>
              <input
                className="input-base w-full mt-1"
                value={config.followupTitleTemplate}
                onChange={(e) => setConfig({ ...config, followupTitleTemplate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Dias para o follow-up</label>
            <input
              type="number"
              min={1}
              max={90}
              className="input-base w-24 mt-1"
              value={config.followupDays}
              onChange={(e) => setConfig({ ...config, followupDays: parseInt(e.target.value, 10) || 3 })}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={save} disabled={saving} className="btn btn-primary flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
          <button onClick={reset} disabled={saving} className="btn flex items-center gap-1.5" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <RotateCcw size={14} /> Repor defaults
          </button>
        </div>
      </div>
    </div>
  );
}
