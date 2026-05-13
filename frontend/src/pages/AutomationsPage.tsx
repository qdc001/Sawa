import { useState, useEffect } from 'react';
import {
  Plus, Zap, Play, ZapOff, Trash2, Copy, X, Save, Loader2, AlertCircle,
  History, Filter, ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertTriangle,
  Settings as SettingsIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api, {
  Automation, AutomationTrigger, AutomationTriggerType,
  AutomationCondition, AutomationConditionOp, AutomationAction, AutomationActionType,
  AutomationRun,
} from '../lib/api';
import { useTaskOptions } from '../lib/taskOptions';

// ── Constantes ─────────────────────────────────────────
const TRIGGERS: { type: AutomationTriggerType; label: string; icon: string; entity: string }[] = [
  { type: 'lead_created', label: 'Lead criado', icon: '🎯', entity: 'lead' },
  { type: 'lead_stage_changed', label: 'Lead muda de etapa', icon: '🔀', entity: 'lead' },
  { type: 'lead_won', label: 'Lead ganho', icon: '🏆', entity: 'lead' },
  { type: 'lead_lost', label: 'Lead perdido', icon: '❌', entity: 'lead' },
  { type: 'lead_assigned', label: 'Lead atribuído', icon: '👤', entity: 'lead' },
  { type: 'lead_stagnant', label: 'Lead parado há X dias', icon: '🐢', entity: 'lead' },
  { type: 'task_created', label: 'Tarefa criada', icon: '📋', entity: 'task' },
  { type: 'task_completed', label: 'Tarefa concluída', icon: '✅', entity: 'task' },
  { type: 'task_overdue', label: 'Tarefa atrasada', icon: '⏰', entity: 'task' },
  { type: 'message_received', label: 'Mensagem recebida', icon: '💬', entity: 'message' },
  { type: 'no_response', label: 'Sem resposta há X minutos', icon: '🔕', entity: 'message' },
  { type: 'contact_created', label: 'Contacto criado', icon: '👥', entity: 'contact' },
  { type: 'schedule', label: 'Horário agendado (cron)', icon: '⏱️', entity: 'lead' },
];

const ACTIONS: { type: AutomationActionType; label: string; icon: string }[] = [
  { type: 'send_message', label: 'Enviar mensagem WhatsApp', icon: '💬' },
  { type: 'send_email', label: 'Enviar email', icon: '📧' },
  { type: 'create_task', label: 'Criar tarefa', icon: '📋' },
  { type: 'assign_user', label: 'Atribuir lead a utilizador', icon: '👤' },
  { type: 'change_stage', label: 'Mudar etapa do lead', icon: '🔀' },
  { type: 'add_tag', label: 'Adicionar tag', icon: '🏷️' },
  { type: 'remove_tag', label: 'Remover tag', icon: '🏷️' },
  { type: 'set_priority', label: 'Definir prioridade', icon: '⚡' },
  { type: 'update_lead', label: 'Actualizar campos do lead', icon: '✏️' },
  { type: 'update_contact', label: 'Actualizar campos do contacto', icon: '✏️' },
  { type: 'run_chatbot', label: 'Disparar chatbot', icon: '🤖' },
  { type: 'send_notification', label: 'Notificar utilizador', icon: '🔔' },
  { type: 'webhook', label: 'Chamar webhook', icon: '🔌' },
];

const CONDITION_OPS: { op: AutomationConditionOp; label: string }[] = [
  { op: 'equals', label: 'igual a' },
  { op: 'not_equals', label: 'diferente de' },
  { op: 'contains', label: 'contém' },
  { op: 'greater_than', label: 'maior que' },
  { op: 'less_than', label: 'menor que' },
  { op: 'has_tag', label: 'tem tag' },
  { op: 'is_empty', label: 'está vazio' },
  { op: 'is_not_empty', label: 'não está vazio' },
];

const FIELD_SUGGESTIONS: Record<string, { value: string; label: string }[]> = {
  lead: [
    { value: 'priority', label: 'priority' },
    { value: 'value', label: 'value' },
    { value: 'source', label: 'source' },
    { value: 'status', label: 'status' },
    { value: 'stage.type', label: 'stage.type' },
    { value: 'stage.name', label: 'stage.name' },
    { value: 'pipeline.name', label: 'pipeline.name' },
    { value: 'assignedToId', label: 'assignedToId' },
    { value: 'contact.country', label: 'contact.country' },
    { value: 'contact.company', label: 'contact.company' },
    { value: 'tags', label: 'tags' },
  ],
  task: [
    { value: 'priority', label: 'priority' },
    { value: 'type', label: 'type' },
    { value: 'status', label: 'status' },
    { value: 'assignedToId', label: 'assignedToId' },
    { value: 'lead.title', label: 'lead.title' },
  ],
  message: [
    { value: 'channel', label: 'channel' },
    { value: 'content', label: 'content' },
    { value: 'contact.country', label: 'contact.country' },
  ],
  contact: [
    { value: 'country', label: 'country' },
    { value: 'company', label: 'company' },
    { value: 'tags', label: 'tags' },
  ],
};

function triggerLabel(t: AutomationTrigger): string {
  return TRIGGERS.find((x) => x.type === t.type)?.label || t.type;
}
function triggerIcon(t: string): string {
  return TRIGGERS.find((x) => x.type === t)?.icon || '⚡';
}
function actionIcon(t: AutomationActionType): string {
  return ACTIONS.find((x) => x.type === t)?.icon || '⚙️';
}
function entityForTrigger(t: AutomationTriggerType): string {
  return TRIGGERS.find((x) => x.type === t)?.entity || 'lead';
}

// Normaliza conditions para sempre devolver { op, items } (compatibilidade com formato legado)
function getCondGroup(c: any): { op: 'AND' | 'OR'; items: AutomationCondition[] } {
  if (!c) return { op: 'AND', items: [] };
  if (Array.isArray(c)) return { op: 'AND', items: c };
  return { op: c.op || 'AND', items: c.items || [] };
}

// ── Pickers ────────────────────────────────────────────
function UserPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get('/users').then((r) => setUsers(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher utilizador --</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );
}

function StagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [pipelines, setPipelines] = useState<any[]>([]);
  useEffect(() => { api.get('/pipelines').then((r) => setPipelines(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher etapa --</option>
      {pipelines.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {(p.stages || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function TagPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get('/tags').then((r) => setTags(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher tag --</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

// ── Condition row ──────────────────────────────────────
function ConditionRow({ condition, fields, onChange, onRemove }: {
  condition: AutomationCondition; fields: { value: string; label: string }[];
  onChange: (c: AutomationCondition) => void; onRemove: () => void;
}) {
  const showValueInput = condition.op !== 'is_empty' && condition.op !== 'is_not_empty';
  return (
    <div className="flex gap-2 items-start">
      <input
        list="auto-fields-list"
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
        placeholder="campo (ex: priority)"
        className="input-base text-xs flex-1"
      />
      <datalist id="auto-fields-list">
        {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </datalist>
      <select
        value={condition.op}
        onChange={(e) => onChange({ ...condition, op: e.target.value as AutomationConditionOp })}
        className="input-base text-xs"
        style={{ width: 140 }}
      >
        {CONDITION_OPS.map((op) => <option key={op.op} value={op.op}>{op.label}</option>)}
      </select>
      {showValueInput && (
        condition.op === 'has_tag' ? (
          <div style={{ flex: 1 }}>
            <TagPicker value={condition.value || ''} onChange={(v) => onChange({ ...condition, value: v })} />
          </div>
        ) : (
          <input
            value={condition.value ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            placeholder="valor"
            className="input-base text-xs flex-1"
          />
        )
      )}
      <button onClick={onRemove} className="text-red-500 p-1.5 hover:bg-red-50 rounded">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Action editor ──────────────────────────────────────
function ActionEditor({ action, onChange, onRemove }: {
  action: AutomationAction; onChange: (a: AutomationAction) => void; onRemove: () => void;
}) {
  const params = action.params || {};
  const updateParam = (k: string, v: any) => onChange({ ...action, params: { ...params, [k]: v } });
  const { types: taskTypes, priorities: taskPriorities } = useTaskOptions();

  return (
    <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 18 }}>{actionIcon(action.type)}</span>
        <select
          value={action.type}
          onChange={(e) => onChange({ type: e.target.value as AutomationActionType, params: {} })}
          className="input-base text-xs flex-1"
        >
          {ACTIONS.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>
        <input
          type="number" min={0}
          value={action.delaySeconds || 0}
          onChange={(e) => onChange({ ...action, delaySeconds: Number(e.target.value) || 0 })}
          className="input-base text-xs"
          style={{ width: 90 }}
          placeholder="delay s"
          title="Esperar X segundos antes de executar (máx 60)"
        />
        <button onClick={onRemove} className="text-red-500 p-1.5 hover:bg-red-50 rounded">
          <Trash2 size={13} />
        </button>
      </div>

      {action.type === 'send_message' && (
        <textarea
          value={params.text || ''}
          onChange={(e) => updateParam('text', e.target.value)}
          rows={3}
          className="input-base w-full text-xs"
          placeholder="Olá {{contact.firstName}}, ..."
        />
      )}

      {action.type === 'send_email' && (
        <div className="space-y-2">
          <input
            value={params.to || '{{contact.email}}'}
            onChange={(e) => updateParam('to', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Para (email)"
          />
          <input
            value={params.subject || ''}
            onChange={(e) => updateParam('subject', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Assunto"
          />
          <textarea
            value={params.body || ''}
            onChange={(e) => updateParam('body', e.target.value)}
            rows={3}
            className="input-base w-full text-xs"
            placeholder="Corpo (HTML aceite)"
          />
        </div>
      )}

      {action.type === 'create_task' && (
        <div className="space-y-2">
          <input
            value={params.title || ''}
            onChange={(e) => updateParam('title', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Título da tarefa"
          />
          <textarea
            value={params.description || ''}
            onChange={(e) => updateParam('description', e.target.value)}
            rows={2}
            className="input-base w-full text-xs"
            placeholder="Descrição"
          />
          <div className="flex gap-2">
            <select
              value={params.taskType || taskTypes.find((t) => t.value === 'FOLLOW_UP')?.value || taskTypes[0]?.value || 'FOLLOW_UP'}
              onChange={(e) => updateParam('taskType', e.target.value)}
              className="input-base text-xs flex-1"
            >
              {taskTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={params.priority || taskPriorities.find((p) => p.value === 'MEDIUM')?.value || taskPriorities[0]?.value || 'MEDIUM'}
              onChange={(e) => updateParam('priority', e.target.value)}
              className="input-base text-xs"
              style={{ width: 90 }}
            >
              {taskPriorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="number"
              value={params.dueInHours || ''}
              onChange={(e) => updateParam('dueInHours', e.target.value)}
              className="input-base text-xs"
              style={{ width: 100 }}
              placeholder="Prazo (h)"
            />
          </div>
        </div>
      )}

      {action.type === 'assign_user' && (
        <UserPicker value={params.userId || ''} onChange={(v) => updateParam('userId', v)} />
      )}

      {action.type === 'change_stage' && (
        <StagePicker value={params.stageId || ''} onChange={(v) => updateParam('stageId', v)} />
      )}

      {action.type === 'add_tag' && (
        <div className="space-y-2">
          <select
            value={params.entity || 'lead'}
            onChange={(e) => updateParam('entity', e.target.value)}
            className="input-base w-full text-xs"
          >
            <option value="lead">No lead</option>
            <option value="contact">No contacto</option>
          </select>
          <TagPicker value={params.tagId || ''} onChange={(v) => updateParam('tagId', v)} />
        </div>
      )}

      {action.type === 'set_priority' && (
        <select
          value={params.priority || taskPriorities.find((p) => p.value === 'MEDIUM')?.value || taskPriorities[0]?.value || 'MEDIUM'}
          onChange={(e) => updateParam('priority', e.target.value)}
          className="input-base w-full text-xs"
        >
          {taskPriorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {action.type === 'send_notification' && (
        <div className="space-y-2">
          <UserPicker value={params.userId || ''} onChange={(v) => updateParam('userId', v)} />
          <input
            value={params.title || ''}
            onChange={(e) => updateParam('title', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Título"
          />
          <textarea
            value={params.body || ''}
            onChange={(e) => updateParam('body', e.target.value)}
            rows={2}
            className="input-base w-full text-xs"
            placeholder="Mensagem"
          />
        </div>
      )}

      {action.type === 'webhook' && (
        <div className="space-y-2">
          <input
            value={params.url || ''}
            onChange={(e) => updateParam('url', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="https://..."
          />
          <select
            value={params.method || 'POST'}
            onChange={(e) => updateParam('method', e.target.value)}
            className="input-base w-full text-xs"
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
      )}

      {action.type === 'remove_tag' && (
        <div className="space-y-2">
          <select
            value={params.entity || 'lead'}
            onChange={(e) => updateParam('entity', e.target.value)}
            className="input-base w-full text-xs"
          >
            <option value="lead">Do lead</option>
            <option value="contact">Do contacto</option>
          </select>
          <TagPicker value={params.tagId || ''} onChange={(v) => updateParam('tagId', v)} />
        </div>
      )}

      {action.type === 'update_lead' && (
        <div className="space-y-2">
          <input value={params.title || ''} onChange={(e) => updateParam('title', e.target.value)} className="input-base w-full text-xs" placeholder="Novo título (opcional)" />
          <input type="number" value={params.value ?? ''} onChange={(e) => updateParam('value', e.target.value)} className="input-base w-full text-xs" placeholder="Novo valor (opcional)" />
          <input value={params.source || ''} onChange={(e) => updateParam('source', e.target.value)} className="input-base w-full text-xs" placeholder="Origem" />
          <select value={params.priority || ''} onChange={(e) => updateParam('priority', e.target.value)} className="input-base w-full text-xs">
            <option value="">-- Prioridade (sem alterar) --</option>
            {taskPriorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="number" value={params.expectedCloseInDays || ''} onChange={(e) => updateParam('expectedCloseInDays', e.target.value)} className="input-base w-full text-xs" placeholder="Fechar em X dias (opcional)" />
        </div>
      )}

      {action.type === 'update_contact' && (
        <div className="space-y-2">
          <input value={params.firstName || ''} onChange={(e) => updateParam('firstName', e.target.value)} className="input-base w-full text-xs" placeholder="Primeiro nome" />
          <input value={params.lastName || ''} onChange={(e) => updateParam('lastName', e.target.value)} className="input-base w-full text-xs" placeholder="Último nome" />
          <input value={params.email || ''} onChange={(e) => updateParam('email', e.target.value)} className="input-base w-full text-xs" placeholder="Email" />
          <input value={params.company || ''} onChange={(e) => updateParam('company', e.target.value)} className="input-base w-full text-xs" placeholder="Empresa" />
          <input value={params.position || ''} onChange={(e) => updateParam('position', e.target.value)} className="input-base w-full text-xs" placeholder="Cargo" />
          <input value={params.country || ''} onChange={(e) => updateParam('country', e.target.value)} className="input-base w-full text-xs" placeholder="País" />
          <input value={params.city || ''} onChange={(e) => updateParam('city', e.target.value)} className="input-base w-full text-xs" placeholder="Cidade" />
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Deixa vazio o que não queres alterar.</p>
        </div>
      )}

      {action.type === 'run_chatbot' && (
        <div className="space-y-2">
          <ChatbotFlowPicker value={params.flowId || ''} onChange={(v) => updateParam('flowId', v)} />
          <input value={params.message || ''} onChange={(e) => updateParam('message', e.target.value)} className="input-base w-full text-xs" placeholder="Mensagem inicial (opcional)" />
        </div>
      )}
    </div>
  );
}

function ChatbotFlowPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [flows, setFlows] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get('/chatbots').then((r) => setFlows(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher chatbot --</option>
      {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

// ── Editor de uma automation ───────────────────────────
function AutomationEditor({ automation, onClose, onSaved }: {
  automation: Automation; onClose: () => void; onSaved: (a: Automation) => void;
}) {
  const [draft, setDraft] = useState<Automation>(automation);
  const [saving, setSaving] = useState(false);
  const [stages, setStages] = useState<{ id: string; name: string; pipelineName: string }[]>([]);

  useEffect(() => {
    api.get('/pipelines').then((r) => {
      const flat: { id: string; name: string; pipelineName: string }[] = [];
      r.data.forEach((p: any) => (p.stages || []).forEach((s: any) => flat.push({ id: s.id, name: s.name, pipelineName: p.name })));
      setStages(flat);
    }).catch(() => {});
  }, []);

  const entityType = entityForTrigger(draft.trigger.type);
  const fields = FIELD_SUGGESTIONS[entityType] || [];
  const update = (patch: Partial<Automation>) => setDraft({ ...draft, ...patch });

  const validate = (): string | null => {
    if (!draft.name) return 'Define um nome.';
    if (!draft.trigger.type) return 'Define o trigger.';
    if (!draft.actions || draft.actions.length === 0) return 'Adiciona pelo menos uma acção.';
    return null;
  };

  const save = async (): Promise<Automation | null> => {
    const err = validate();
    if (err) { toast.error(err); return null; }
    setSaving(true);
    try {
      const res = await api.patch(`/automations/${draft.id}`, {
        name: draft.name, description: draft.description,
        trigger: draft.trigger, conditions: draft.conditions, actions: draft.actions,
        isActive: draft.isActive,
      });
      toast.success('Automação guardada');
      onSaved(res.data);
      return res.data;
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    const saved = await save();
    if (!saved) return;
    try {
      const res = await api.post(`/automations/${saved.id}/test`, {});
      const r = res.data;
      if (r.matched) {
        const lines = (r.steps || []).map((s: any) => `${s.action}${s.detail ? ` — ${s.detail}` : ''}`);
        alert('Match!\n\nAcções que seriam executadas:\n\n' + (lines.join('\n') || '(nenhuma)'));
      } else {
        alert('Não corresponde: ' + (r.reason || 'condições não satisfeitas'));
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao testar');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        <input
          className="font-bold text-base outline-none border-b-2 border-transparent focus:border-indigo-500 px-1"
          style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => update({ isActive: e.target.checked })} />
            Activa
          </label>
          <button onClick={test} className="btn btn-outline text-sm py-1.5 gap-1.5"><Play size={13} /> Testar</button>
          <button onClick={save} disabled={saving} className="btn btn-primary text-sm py-1.5 gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <label className="block text-xs font-medium mb-1">Descrição (opcional)</label>
            <input
              value={draft.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              className="input-base w-full text-sm"
              placeholder="Para que serve esta automação?"
            />
          </div>

          {/* TRIGGER */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} style={{ color: '#6366F1' }} />
              <h3 className="font-bold text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>QUANDO</h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Trigger que dispara a automação</span>
            </div>
            <select
              value={draft.trigger.type}
              onChange={(e) => update({ trigger: { type: e.target.value as AutomationTriggerType, params: {} } })}
              className="input-base w-full text-sm"
            >
              {TRIGGERS.map((t) => <option key={t.type} value={t.type}>{t.icon} {t.label}</option>)}
            </select>

            {draft.trigger.type === 'lead_stage_changed' && (
              <div className="mt-3">
                <label className="block text-xs font-medium mb-1">Etapa específica (opcional)</label>
                <select
                  value={draft.trigger.params?.stageId || ''}
                  onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, stageId: e.target.value || undefined } } })}
                  className="input-base w-full text-sm"
                >
                  <option value="">Qualquer etapa</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.pipelineName}: {s.name}</option>)}
                </select>
              </div>
            )}

            {draft.trigger.type === 'lead_stagnant' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Dias parado</label>
                  <input
                    type="number" min={1}
                    value={draft.trigger.params?.days || 7}
                    onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, days: Number(e.target.value) } } })}
                    className="input-base w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Etapa (opcional)</label>
                  <select
                    value={draft.trigger.params?.stageId || ''}
                    onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, stageId: e.target.value || undefined } } })}
                    className="input-base w-full text-sm"
                  >
                    <option value="">Qualquer etapa</option>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.pipelineName}: {s.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {draft.trigger.type === 'no_response' && (
              <div className="mt-3">
                <label className="block text-xs font-medium mb-1">Minutos sem resposta</label>
                <input
                  type="number" min={1}
                  value={draft.trigger.params?.minutes || 60}
                  onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, minutes: Number(e.target.value) } } })}
                  className="input-base w-full text-sm"
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Dispara quando o cliente envia mensagem e não recebe resposta neste tempo.
                </p>
              </div>
            )}

            {draft.trigger.type === 'schedule' && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-medium">Frequência</label>
                <select
                  value={draft.trigger.params?.mode || 'every_X_minutes'}
                  onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, mode: e.target.value } } })}
                  className="input-base w-full text-sm"
                >
                  <option value="every_X_minutes">A cada X minutos</option>
                  <option value="daily_at">Todos os dias a uma hora</option>
                  <option value="weekly_at">Semanalmente a um dia/hora</option>
                  <option value="monthly_at">Mensalmente a um dia/hora</option>
                </select>

                {(draft.trigger.params?.mode || 'every_X_minutes') === 'every_X_minutes' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">Minutos</label>
                    <input
                      type="number" min={1}
                      value={draft.trigger.params?.minutes || 60}
                      onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, minutes: Number(e.target.value) } } })}
                      className="input-base w-full text-sm"
                    />
                  </div>
                )}

                {draft.trigger.params?.mode === 'daily_at' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Hora (0-23)</label>
                      <input type="number" min={0} max={23} value={draft.trigger.params?.hour ?? 9}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, hour: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Minuto</label>
                      <input type="number" min={0} max={59} value={draft.trigger.params?.minute ?? 0}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, minute: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                  </div>
                )}

                {draft.trigger.params?.mode === 'weekly_at' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Dia</label>
                      <select value={draft.trigger.params?.weekday ?? 1}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, weekday: Number(e.target.value) } } })}
                        className="input-base w-full text-sm">
                        <option value={1}>Segunda</option>
                        <option value={2}>Terça</option>
                        <option value={3}>Quarta</option>
                        <option value={4}>Quinta</option>
                        <option value={5}>Sexta</option>
                        <option value={6}>Sábado</option>
                        <option value={7}>Domingo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Hora</label>
                      <input type="number" min={0} max={23} value={draft.trigger.params?.hour ?? 9}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, hour: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Minuto</label>
                      <input type="number" min={0} max={59} value={draft.trigger.params?.minute ?? 0}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, minute: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                  </div>
                )}

                {draft.trigger.params?.mode === 'monthly_at' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Dia do mês</label>
                      <input type="number" min={1} max={28} value={draft.trigger.params?.day ?? 1}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, day: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Hora</label>
                      <input type="number" min={0} max={23} value={draft.trigger.params?.hour ?? 9}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, hour: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Minuto</label>
                      <input type="number" min={0} max={59} value={draft.trigger.params?.minute ?? 0}
                        onChange={(e) => update({ trigger: { ...draft.trigger, params: { ...draft.trigger.params, minute: Number(e.target.value) } } })}
                        className="input-base w-full text-sm" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* CONDITIONS */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={16} style={{ color: '#F59E0B' }} />
              <h3 className="font-bold text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>SE</h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Condições. Vazio = executa sempre.</span>
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Combinar:</span>
                <select
                  value={getCondGroup(draft.conditions).op}
                  onChange={(e) => {
                    const items = getCondGroup(draft.conditions).items;
                    update({ conditions: { op: e.target.value as 'AND' | 'OR', items } });
                  }}
                  className="input-base text-xs"
                  style={{ width: 80, padding: '2px 6px' }}
                >
                  <option value="AND">E (todas)</option>
                  <option value="OR">OU (qualquer)</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              {getCondGroup(draft.conditions).items.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  fields={fields}
                  onChange={(nc) => {
                    const g = getCondGroup(draft.conditions);
                    update({ conditions: { op: g.op, items: g.items.map((x, idx) => (idx === i ? nc : x)) } });
                  }}
                  onRemove={() => {
                    const g = getCondGroup(draft.conditions);
                    update({ conditions: { op: g.op, items: g.items.filter((_, idx) => idx !== i) } });
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => {
                const g = getCondGroup(draft.conditions);
                update({ conditions: { op: g.op, items: [...g.items, { field: '', op: 'equals', value: '' }] } });
              }}
              className="btn btn-outline text-xs py-1.5 mt-3 gap-1"
            >
              <Plus size={11} /> Adicionar condição
            </button>
          </section>

          {/* ACTIONS */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <ChevronRight size={16} style={{ color: '#10B981' }} />
              <h3 className="font-bold text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>ENTÃO</h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Acções executadas em sequência</span>
            </div>
            <div className="space-y-3">
              {(draft.actions || []).map((a, i) => (
                <ActionEditor
                  key={i}
                  action={a}
                  onChange={(na) => update({ actions: draft.actions.map((x, idx) => (idx === i ? na : x)) })}
                  onRemove={() => update({ actions: draft.actions.filter((_, idx) => idx !== i) })}
                />
              ))}
            </div>
            <button
              onClick={() => update({ actions: [...(draft.actions || []), { type: 'create_task', params: { title: 'Nova tarefa' } }] })}
              className="btn btn-outline text-xs py-1.5 mt-3 gap-1"
            >
              <Plus size={11} /> Adicionar acção
            </button>
          </section>

          {/* AVANÇADO: horário activo + limites */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <SettingsIcon size={16} style={{ color: '#64748B' }} />
              <h3 className="font-bold text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>AVANÇADO</h3>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Horário activo e limites</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Horário activo (opcional, todos campos vazios = sempre)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number" min={0} max={23}
                    value={draft.activeHoursStart ?? ''}
                    onChange={(e) => update({ activeHoursStart: e.target.value === '' ? null : Number(e.target.value) })}
                    className="input-base w-full text-xs"
                    placeholder="Hora início (0-23)"
                  />
                  <input
                    type="number" min={0} max={23}
                    value={draft.activeHoursEnd ?? ''}
                    onChange={(e) => update({ activeHoursEnd: e.target.value === '' ? null : Number(e.target.value) })}
                    className="input-base w-full text-xs"
                    placeholder="Hora fim (0-23)"
                  />
                </div>
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const active = (draft.activeWeekdays || '').includes(String(d));
                    const labels = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          const cur = draft.activeWeekdays || '';
                          const next = active ? cur.replace(String(d), '') : cur + String(d);
                          update({ activeWeekdays: next || null });
                        }}
                        className="text-xs px-2 py-1 rounded"
                        style={{
                          background: active ? '#EEF2FF' : 'var(--surface-3)',
                          color: active ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {labels[d]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Sem dias seleccionados = todos os dias.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Limites de execução</label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <input
                      type="number" min={0}
                      value={draft.runLimitPerContact ?? ''}
                      onChange={(e) => update({ runLimitPerContact: e.target.value === '' ? null : Number(e.target.value) })}
                      className="input-base w-full text-xs"
                      placeholder="Por contacto"
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Por contacto</p>
                  </div>
                  <div>
                    <input
                      type="number" min={0}
                      value={draft.runLimitTotal ?? ''}
                      onChange={(e) => update({ runLimitTotal: e.target.value === '' ? null : Number(e.target.value) })}
                      className="input-base w-full text-xs"
                      placeholder="Total"
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Total</p>
                  </div>
                  <div>
                    <input
                      type="number" min={1}
                      value={draft.runLimitWindow ?? 24}
                      onChange={(e) => update({ runLimitWindow: e.target.value === '' ? null : Number(e.target.value) })}
                      className="input-base w-full text-xs"
                      placeholder="Janela (h)"
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Janela em horas</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="card p-3 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
            <strong>Variáveis:</strong> nas mensagens podes usar <code>{'{{contact.firstName}}'}</code>, <code>{'{{title}}'}</code>, <code>{'{{stage.name}}'}</code>, etc.
            O nome do campo é o do recurso disparador (lead/task/contact).
            <br /><br />
            <strong>Delay:</strong> põe um valor em segundos no campo "delay s" de cada acção para esperar antes de a executar (máx 60s para não bloquear webhooks).
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de histórico ─────────────────────────────────
function HistoryModal({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/automations/${automation.id}/runs`);
      setRuns(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [automation.id]);

  const clear = async () => {
    if (!confirm('Limpar todo o histórico?')) return;
    try {
      const res = await api.delete(`/automations/${automation.id}/runs`);
      toast.success(`${res.data.deleted} entradas eliminadas`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="font-bold text-base">Histórico — {automation.name}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{runs.length} execuções</p>
          </div>
          <div className="flex items-center gap-2">
            {runs.length > 0 && (
              <button onClick={clear} className="btn text-xs py-1.5 px-3" style={{ color: '#EF4444', border: '1px solid #FEE2E2', background: 'transparent' }}>
                <Trash2 size={12} /> Limpar tudo
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X size={16} /></button>
          </div>
        </div>

        <div className="p-4" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={20} /></div>
          ) : runs.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
              <History size={32} className="mx-auto mb-2 opacity-40" />
              Sem execuções ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => {
                const expanded = expandedId === r.id;
                const log = Array.isArray(r.log) ? r.log : [];
                return (
                  <div key={r.id} className="card p-3" style={{ background: 'var(--surface-2)' }}>
                    <button onClick={() => setExpandedId(expanded ? null : r.id)} className="w-full flex items-center gap-3 text-left">
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span style={{ fontSize: 14 }}>{triggerIcon(r.triggeredBy)}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{r.triggeredBy}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {r.entityType || ''} {r.entityId ? `· ${r.entityId.substring(0, 8)}` : ''} · {new Date(r.createdAt).toLocaleString('pt-PT')}
                        </p>
                      </div>
                      {r.status === 'OK' ? (
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#ECFDF5', color: '#10B981' }}>
                          <CheckCircle2 size={11} /> OK
                        </span>
                      ) : r.status === 'SKIPPED' ? (
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                          <AlertCircle size={11} /> Saltada
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                          <XCircle size={11} /> Falhou
                        </span>
                      )}
                    </button>
                    {expanded && (
                      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                        {log.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>(sem detalhes)</p>
                        ) : (
                          <ol className="space-y-1.5">
                            {log.map((e, i) => (
                              <li key={i} className="text-xs flex gap-2">
                                <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>{new Date(e.at).toLocaleTimeString('pt-PT')}</span>
                                <span className="flex-1">
                                  {e.action}
                                  {e.detail && <span style={{ color: 'var(--text-muted)' }}> — {e.detail}</span>}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────
export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [historyFor, setHistoryFor] = useState<Automation | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/automations');
      setAutomations(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a carregar');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await api.post('/automations', {
        name: 'Nova automação',
        trigger: { type: 'lead_created' },
        conditions: [],
        actions: [],
        isActive: false,
      });
      setAutomations((a) => [res.data, ...a]);
      setEditing(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    } finally { setCreating(false); }
  };

  const toggle = async (a: Automation) => {
    try {
      const res = await api.patch(`/automations/${a.id}`, { isActive: !a.isActive });
      setAutomations((arr) => arr.map((x) => (x.id === a.id ? res.data : x)));
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  const remove = async (a: Automation) => {
    if (!confirm(`Eliminar "${a.name}"?`)) return;
    try {
      await api.delete(`/automations/${a.id}`);
      setAutomations((arr) => arr.filter((x) => x.id !== a.id));
      toast.success('Eliminada');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  const duplicate = async (a: Automation) => {
    try {
      const res = await api.post(`/automations/${a.id}/duplicate`);
      setAutomations((arr) => [res.data, ...arr]);
      toast.success('Duplicada');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  if (editing) {
    return (
      <AutomationEditor
        automation={editing}
        onClose={() => { setEditing(null); load(); }}
        onSaved={(a) => {
          setAutomations((arr) => arr.map((x) => (x.id === a.id ? a : x)));
          setEditing(a);
        }}
      />
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Automatizações</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Regras "quando isto acontece, faz aquilo"
          </p>
        </div>
        <button onClick={handleCreate} disabled={creating} className="btn btn-primary gap-2">
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Nova automatização
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin" size={24} /></div>
      ) : automations.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
            <Zap size={28} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="font-bold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Sem automatizações ainda</h3>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Cria regras automáticas que reagem a eventos no CRM. Exemplo: "quando lead é criado com origem 'WhatsApp', criar tarefa de seguimento".
          </p>
          <button onClick={handleCreate} className="btn btn-primary gap-2 mt-2">
            <Plus size={16} /> Criar primeira automatização
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: a.isActive ? '#EEF2FF' : 'var(--surface-3)' }}>
                  {triggerIcon(a.trigger.type)}
                </div>
                <button
                  onClick={() => toggle(a)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: a.isActive ? '#ECFDF5' : 'var(--surface-3)', color: a.isActive ? '#10B981' : 'var(--text-muted)' }}
                >
                  {a.isActive ? <Play size={11} /> : <ZapOff size={11} />}
                  {a.isActive ? 'Activa' : 'Inactiva'}
                </button>
              </div>
              <h3 className="font-bold text-sm mb-1" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{a.name}</h3>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{triggerLabel(a.trigger)}</p>
              {a.description && (
                <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{a.description}</p>
              )}
              <div className="flex items-center gap-2 text-xs mb-4 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                <span>{a.actions?.length || 0} acções</span>
                <span>·</span>
                <span>{getCondGroup(a.conditions).items.length} condições</span>
                <span>·</span>
                <span>{a.runCount || 0} execuções</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(a)} className="btn btn-outline flex-1 text-xs py-1.5">Editar</button>
                <button onClick={() => setHistoryFor(a)} className="btn text-xs py-1.5 px-2.5" title="Histórico" style={{ border: '1px solid var(--border)', background: 'transparent' }}>
                  <History size={13} />
                </button>
                <button onClick={() => duplicate(a)} className="btn text-xs py-1.5 px-2.5" title="Duplicar" style={{ border: '1px solid var(--border)', background: 'transparent' }}>
                  <Copy size={13} />
                </button>
                <button onClick={() => remove(a)} className="btn text-xs py-1.5 px-2.5" title="Eliminar" style={{ color: '#EF4444', border: '1px solid #FEE2E2', background: 'transparent' }}>
                  <Trash2 size={13} />
                </button>
              </div>
              {(!a.actions || a.actions.length === 0) && (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <AlertTriangle size={11} /> Sem acções definidas
                </div>
              )}
            </div>
          ))}
          <button onClick={handleCreate} disabled={creating} className="card p-5 flex flex-col items-center justify-center gap-3 border-dashed hover:border-indigo-300 transition-colors" style={{ minHeight: 200 }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
              <Plus size={24} style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Criar automatização</p>
          </button>
        </div>
      )}

      {historyFor && <HistoryModal automation={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}
