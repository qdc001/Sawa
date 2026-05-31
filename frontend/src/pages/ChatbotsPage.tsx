import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Bot, Play, Trash2, X, Save, Loader2, ZapOff, Copy, Settings as SettingsIcon, AlertCircle, Activity, History, ChevronRight, CheckCircle2, Clock, User as UserIcon } from 'lucide-react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, Connection, Edge, Node, NodeProps, Handle, Position,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import toast from 'react-hot-toast';
import api, { ChatbotFlow, ChatbotTrigger, ChatbotNodeType, ChatbotSession, ChatbotLogEntry } from '../lib/api';
import { useTaskOptions } from '../lib/taskOptions';

// ── Custom Nodes ──────────────────────────────────────
const nodeStyle = (color: string, selected = false) => ({
  background: 'white',
  border: `2px solid ${selected ? color : color + '80'}`,
  borderRadius: 12,
  padding: '12px 16px',
  minWidth: 200,
  maxWidth: 240,
  boxShadow: selected ? `0 0 0 3px ${color}30` : '0 2px 8px rgba(0,0,0,0.08)',
  fontSize: 13,
  fontFamily: 'Manrope, sans-serif',
  cursor: 'pointer',
  transition: 'all .15s',
});

function TriggerNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#C8553D', selected)}>
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>⚡</span>
        <span style={{ fontWeight: 600, color: '#C8553D', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Trigger</span>
      </div>
      <p style={{ fontWeight: 500, color: '#0F172A', fontSize: 12 }}>{data.label || 'Início do fluxo'}</p>
    </div>
  );
}

function MessageNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#0EA5E9', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>💬</span>
        <span style={{ fontWeight: 600, color: '#0EA5E9', fontSize: 11, textTransform: 'uppercase' }}>Mensagem</span>
        {data.waitForReply && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#FEF3C7', color: '#B45309' }}>esperar resposta</span>}
      </div>
      <p style={{ color: '#0F172A', fontSize: 12, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {data.text || data.label || '(vazio)'}
      </p>
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps) {
  return (
    <div style={{ ...nodeStyle('#F59E0B', selected), position: 'relative' }}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: '70%' }} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🔀</span>
        <span style={{ fontWeight: 600, color: '#F59E0B', fontSize: 11, textTransform: 'uppercase' }}>Condição</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>
        {data.label || conditionLabel(data)}
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 10, color: '#10B981', fontWeight: 600 }}>✓ Sim</span>
        <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>✗ Não</span>
      </div>
    </div>
  );
}

function conditionLabel(data: any) {
  const t = data.conditionType || 'contains';
  const v = data.conditionValue || '';
  const labels: Record<string, string> = {
    contains: `contém "${v}"`,
    equals: `igual a "${v}"`,
    starts_with: `começa por "${v}"`,
    is_number: 'é número',
    has_email: 'tem email',
    has_phone: 'tem telefone',
  };
  return labels[t] || 'condição';
}

function ActionNode({ data, selected }: NodeProps) {
  const labels: Record<string, string> = {
    create_task: 'Criar tarefa',
    assign_user: 'Atribuir a utilizador',
    change_stage: 'Mudar etapa',
    add_tag: 'Adicionar tag',
    webhook: 'Chamar webhook',
    set_priority: 'Definir prioridade',
    create_lead: 'Criar lead',
  };
  const at = data.actionType;
  return (
    <div style={nodeStyle('#10B981', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>⚙️</span>
        <span style={{ fontWeight: 600, color: '#10B981', fontSize: 11, textTransform: 'uppercase' }}>Acção</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{at ? labels[at] || at : data.label || 'Configurar acção'}</p>
    </div>
  );
}

function DelayNode({ data, selected }: NodeProps) {
  const s = Number(data.delaySeconds) || 60;
  let txt = `${s}s`;
  if (s >= 86400) txt = `${Math.round(s / 86400)} dias`;
  else if (s >= 3600) txt = `${Math.round(s / 3600)}h`;
  else if (s >= 60) txt = `${Math.round(s / 60)} min`;
  return (
    <div style={nodeStyle('#8B5CF6', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>⏱️</span>
        <span style={{ fontWeight: 600, color: '#8B5CF6', fontSize: 11, textTransform: 'uppercase' }}>Esperar</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{txt}</p>
    </div>
  );
}

function EndNode({ selected }: NodeProps) {
  return (
    <div style={nodeStyle('#EF4444', selected)}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <span style={{ fontSize: 18 }}>🏁</span>
        <span style={{ fontWeight: 600, color: '#EF4444', fontSize: 11, textTransform: 'uppercase' }}>Fim</span>
      </div>
    </div>
  );
}

function AINode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#C8553D', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🤖</span>
        <span style={{ fontWeight: 600, color: '#C8553D', fontSize: 11, textTransform: 'uppercase' }}>Agente IA</span>
        {data.waitForReply && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: '#FEF3C7', color: '#B45309' }}>esperar resposta</span>}
      </div>
      <p style={{ color: '#0F172A', fontSize: 12, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {data.aiPrompt ? (data.aiPrompt as string).substring(0, 80) + ((data.aiPrompt as string).length > 80 ? '...' : '') : 'Responde com IA'}
      </p>
    </div>
  );
}

function TemplateNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#EC4899', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>📋</span>
        <span style={{ fontWeight: 600, color: '#EC4899', fontSize: 11, textTransform: 'uppercase' }}>Template</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{data.templateName || '(sem template)'}</p>
      {Array.isArray(data.variables) && data.variables.length > 0 && (
        <p style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>{data.variables.length} variáveis</p>
      )}
    </div>
  );
}

function MediaNode({ data, selected }: NodeProps) {
  const icons: Record<string, string> = { image: '🖼️', video: '🎥', audio: '🎵', document: '📎' };
  const t = (data.mediaType || 'image') as string;
  return (
    <div style={nodeStyle('#06B6D4', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>{icons[t] || '📎'}</span>
        <span style={{ fontWeight: 600, color: '#06B6D4', fontSize: 11, textTransform: 'uppercase' }}>Mídia</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12, wordBreak: 'break-all' }}>
        {data.mediaUrl ? (data.mediaUrl as string).substring(0, 60) + ((data.mediaUrl as string).length > 60 ? '...' : '') : '(sem URL)'}
      </p>
    </div>
  );
}

function ButtonsNode({ data, selected }: NodeProps) {
  const buttons = Array.isArray(data.buttons) ? data.buttons : [];
  return (
    <div style={nodeStyle('#F97316', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🔘</span>
        <span style={{ fontWeight: 600, color: '#F97316', fontSize: 11, textTransform: 'uppercase' }}>Botões</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{data.text || data.label || '(sem texto)'}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {buttons.slice(0, 3).map((b: any, i: number) => (
          <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: '#FFF7ED', color: '#9A3412', border: '1px solid #FED7AA' }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HandoffNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#FACC15', selected)}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🤝</span>
        <span style={{ fontWeight: 600, color: '#A16207', fontSize: 11, textTransform: 'uppercase' }}>Handoff</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>
        {data.userId ? 'Atribuir a utilizador' : data.teamId ? 'Atribuir a equipa' : 'Transferir p/ humano'}
      </p>
    </div>
  );
}

function ListNode({ data, selected }: NodeProps) {
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const total = sections.reduce((acc: number, s: any) => acc + (Array.isArray(s.rows) ? s.rows.length : 0), 0);
  return (
    <div style={nodeStyle('#0891B2', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>📑</span>
        <span style={{ fontWeight: 600, color: '#0891B2', fontSize: 11, textTransform: 'uppercase' }}>Lista</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{data.text || data.label || '(sem texto)'}</p>
      <p style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>{total} opções em {sections.length} secções</p>
    </div>
  );
}

function SwitchNode({ data, selected }: NodeProps) {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  return (
    <div style={nodeStyle('#D946EF', selected)}>
      <Handle type="target" position={Position.Top} />
      {cases.slice(0, 4).map((c: any, i: number) => (
        <Handle
          key={i}
          type="source"
          position={Position.Bottom}
          id={c.handle || c.value}
          style={{ left: `${(100 / (cases.length + 1)) * (i + 1)}%` }}
        />
      ))}
      <Handle type="source" position={Position.Bottom} id="default" style={{ left: '90%' }} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>↗️</span>
        <span style={{ fontWeight: 600, color: '#D946EF', fontSize: 11, textTransform: 'uppercase' }}>Switch</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>
        {data.target ? `var: ${data.target}` : 'última mensagem'}
      </p>
      <p style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>{cases.length} ramos + default</p>
    </div>
  );
}

function SetVarNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#84CC16', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>📝</span>
        <span style={{ fontWeight: 600, color: '#65A30D', fontSize: 11, textTransform: 'uppercase' }}>Definir variável</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>
        {data.varName ? `${data.varName} = ${(data.varValue || '').substring(0, 30)}` : '(sem nome)'}
      </p>
    </div>
  );
}

function FetchDataNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#14B8A6', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🌐</span>
        <span style={{ fontWeight: 600, color: '#0D9488', fontSize: 11, textTransform: 'uppercase' }}>Buscar dados</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12, wordBreak: 'break-all' }}>
        {data.method || 'GET'} {(data.url || '').substring(0, 40)}
      </p>
      {data.saveAs && <p style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>→ {data.saveAs}</p>}
    </div>
  );
}

function SubflowNode({ data, selected }: NodeProps) {
  return (
    <div style={nodeStyle('#7C3AED', selected)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🔗</span>
        <span style={{ fontWeight: 600, color: '#7C3AED', fontSize: 11, textTransform: 'uppercase' }}>Sub-fluxo</span>
      </div>
      <p style={{ color: '#0F172A', fontSize: 12 }}>{data.flowId || '(sem flow)'}</p>
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  template: TemplateNode,
  media: MediaNode,
  buttons: ButtonsNode,
  list: ListNode,
  condition: ConditionNode,
  switch: SwitchNode,
  action: ActionNode,
  handoff: HandoffNode,
  delay: DelayNode,
  end: EndNode,
  ai: AINode,
  set_var: SetVarNode,
  fetch_data: FetchDataNode,
  subflow: SubflowNode,
};

// ── Default fluxo para fluxos novos ───────────────────
const defaultNodes: Node[] = [
  { id: 't1', type: 'trigger', position: { x: 250, y: 50 }, data: { label: 'Mensagem recebida' } },
  { id: 'm1', type: 'message', position: { x: 250, y: 180 }, data: { text: 'Olá {{contact.firstName}}! Como posso ajudar?', waitForReply: true, saveAs: 'pedido' } },
  { id: 'e1', type: 'end', position: { x: 250, y: 320 }, data: {} },
];
const defaultEdges: Edge[] = [
  { id: 'et1-m1', source: 't1', target: 'm1', animated: true },
  { id: 'em1-e1', source: 'm1', target: 'e1' },
];

const NODE_PALETTE: { type: ChatbotNodeType; label: string; icon: string; color: string }[] = [
  { type: 'message', label: 'Mensagem', icon: '💬', color: '#0EA5E9' },
  { type: 'template', label: 'Template', icon: '📋', color: '#EC4899' },
  { type: 'media', label: 'Mídia', icon: '🖼️', color: '#06B6D4' },
  { type: 'buttons', label: 'Botões', icon: '🔘', color: '#F97316' },
  { type: 'list', label: 'Lista', icon: '📑', color: '#0891B2' },
  { type: 'condition', label: 'Condição', icon: '🔀', color: '#F59E0B' },
  { type: 'switch', label: 'Switch', icon: '↗️', color: '#D946EF' },
  { type: 'action', label: 'Acção', icon: '⚙️', color: '#10B981' },
  { type: 'set_var', label: 'Variável', icon: '📝', color: '#84CC16' },
  { type: 'fetch_data', label: 'Buscar API', icon: '🌐', color: '#14B8A6' },
  { type: 'subflow', label: 'Sub-fluxo', icon: '🔗', color: '#7C3AED' },
  { type: 'handoff', label: 'Handoff', icon: '🤝', color: '#FACC15' },
  { type: 'delay', label: 'Esperar', icon: '⏱️', color: '#8B5CF6' },
  { type: 'ai', label: 'Agente IA', icon: '🤖', color: '#C8553D' },
  { type: 'end', label: 'Fim', icon: '🏁', color: '#EF4444' },
];

// ── Painel de propriedades de um nó ───────────────────
function NodePropertiesPanel({
  node, onChange, onDelete,
}: { node: Node; onChange: (data: any) => void; onDelete: () => void }) {
  const data = node.data || {};
  const { types: taskTypes, priorities: taskPriorities } = useTaskOptions();

  const updateField = (key: string, value: any) => onChange({ ...data, [key]: value });
  const updateActionParam = (key: string, value: any) =>
    onChange({ ...data, actionParams: { ...(data.actionParams || {}), [key]: value } });

  return (
    <div className="overflow-y-auto p-4" style={{ width: 320, borderLeft: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {node.type}
        </h3>
        {node.type !== 'trigger' && (
          <button onClick={onDelete} className="text-red-500 hover:bg-red-50 p-1 rounded" title="Eliminar nó">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* TRIGGER: nada para editar (config está no flow) */}
      {node.type === 'trigger' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          O trigger configura-se nas <strong>Definições</strong> do fluxo (botão com ícone de engrenagem no topo direito do editor).
        </p>
      )}

      {/* MESSAGE */}
      {node.type === 'message' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Texto da mensagem</label>
            <textarea
              value={data.text || ''}
              onChange={(e) => updateField('text', e.target.value)}
              rows={5}
              className="input-base w-full text-xs"
              placeholder="Olá {{contact.firstName}}! ..."
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Variáveis: <code>{'{{contact.firstName}}'}</code>, <code>{'{{message}}'}</code>, <code>{'{{vars.NOME}}'}</code>
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!data.waitForReply}
              onChange={(e) => updateField('waitForReply', e.target.checked)}
            />
            Esperar resposta antes de continuar
          </label>
          {data.waitForReply && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Guardar resposta como (opcional)</label>
                <input
                  value={data.saveAs || ''}
                  onChange={(e) => updateField('saveAs', e.target.value)}
                  className="input-base w-full text-xs"
                  placeholder="pedido"
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Acede depois com <code>{'{{vars.pedido}}'}</code></p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Validar resposta (opcional)</label>
                <select
                  value={data.validate || ''}
                  onChange={(e) => updateField('validate', e.target.value || undefined)}
                  className="input-base w-full text-xs"
                >
                  <option value="">Sem validação</option>
                  <option value="email">Email</option>
                  <option value="phone">Telefone</option>
                  <option value="number">Número</option>
                  <option value="url">URL</option>
                  <option value="regex">Regex personalizado</option>
                </select>
              </div>
              {data.validate === 'regex' && (
                <input
                  value={data.validateRegex || ''}
                  onChange={(e) => updateField('validateRegex', e.target.value)}
                  className="input-base w-full text-xs"
                  placeholder="^[A-Z]{3}\\d+$"
                />
              )}
              {data.validate && (
                <input
                  value={data.validateError || ''}
                  onChange={(e) => updateField('validateError', e.target.value)}
                  className="input-base w-full text-xs"
                  placeholder="Mensagem se inválido (ex: Email inválido)"
                />
              )}
            </>
          )}
        </div>
      )}

      {/* CONDITION */}
      {node.type === 'condition' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Tipo</label>
            <select
              value={data.conditionType || 'contains'}
              onChange={(e) => updateField('conditionType', e.target.value)}
              className="input-base w-full text-xs"
            >
              <option value="contains">Contém</option>
              <option value="equals">Igual a</option>
              <option value="starts_with">Começa por</option>
              <option value="is_number">É número</option>
              <option value="has_email">Contém email</option>
              <option value="has_phone">Contém telefone</option>
            </select>
          </div>
          {(data.conditionType === 'contains' || data.conditionType === 'equals' || data.conditionType === 'starts_with' || !data.conditionType) && (
            <div>
              <label className="block text-xs font-medium mb-1">Valor a comparar</label>
              <input
                value={data.conditionValue || ''}
                onChange={(e) => updateField('conditionValue', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="ex: preço"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Avaliar (opcional)</label>
            <input
              value={data.conditionTarget || ''}
              onChange={(e) => updateField('conditionTarget', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="vazio = última mensagem"
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Se vazio, avalia a última mensagem recebida. Senão, avalia a variável com este nome.
            </p>
          </div>
        </div>
      )}

      {/* ACTION */}
      {node.type === 'action' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Tipo de acção</label>
            <select
              value={data.actionType || ''}
              onChange={(e) => updateField('actionType', e.target.value)}
              className="input-base w-full text-xs"
            >
              <option value="">-- Escolher --</option>
              <option value="create_task">Criar tarefa</option>
              <option value="create_lead">Criar lead</option>
              <option value="assign_user">Atribuir lead a utilizador</option>
              <option value="change_stage">Mudar etapa</option>
              <option value="add_tag">Adicionar tag</option>
              <option value="set_priority">Definir prioridade</option>
              <option value="webhook">Chamar webhook</option>
            </select>
          </div>

          {data.actionType === 'create_task' && (
            <>
              <input
                value={data.actionParams?.title || ''}
                onChange={(e) => updateActionParam('title', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="Título da tarefa"
              />
              <textarea
                value={data.actionParams?.description || ''}
                onChange={(e) => updateActionParam('description', e.target.value)}
                rows={2}
                className="input-base w-full text-xs"
                placeholder="Descrição (opcional)"
              />
              <select
                value={data.actionParams?.type || taskTypes.find((t) => t.value === 'FOLLOW_UP')?.value || taskTypes[0]?.value || 'FOLLOW_UP'}
                onChange={(e) => updateActionParam('type', e.target.value)}
                className="input-base w-full text-xs"
              >
                {taskTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                type="number"
                value={data.actionParams?.dueInHours || ''}
                onChange={(e) => updateActionParam('dueInHours', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="Prazo em horas (ex: 24)"
              />
            </>
          )}

          {data.actionType === 'set_priority' && (
            <select
              value={data.actionParams?.priority || taskPriorities.find((p) => p.value === 'MEDIUM')?.value || taskPriorities[0]?.value || 'MEDIUM'}
              onChange={(e) => updateActionParam('priority', e.target.value)}
              className="input-base w-full text-xs"
            >
              {taskPriorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}

          {data.actionType === 'webhook' && (
            <>
              <input
                value={data.actionParams?.url || ''}
                onChange={(e) => updateActionParam('url', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="https://..."
              />
              <select
                value={data.actionParams?.method || 'POST'}
                onChange={(e) => updateActionParam('method', e.target.value)}
                className="input-base w-full text-xs"
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
              </select>
            </>
          )}

          {data.actionType === 'assign_user' && (
            <UserPicker
              value={data.actionParams?.userId || ''}
              onChange={(v) => updateActionParam('userId', v)}
            />
          )}

          {data.actionType === 'change_stage' && (
            <StagePicker
              value={data.actionParams?.stageId || ''}
              onChange={(v) => updateActionParam('stageId', v)}
            />
          )}

          {data.actionType === 'add_tag' && (
            <>
              <select
                value={data.actionParams?.entity || 'contact'}
                onChange={(e) => updateActionParam('entity', e.target.value)}
                className="input-base w-full text-xs"
              >
                <option value="contact">No contacto</option>
                <option value="lead">No lead</option>
              </select>
              <TagPicker
                value={data.actionParams?.tagId || ''}
                onChange={(v) => updateActionParam('tagId', v)}
              />
            </>
          )}

          {data.actionType === 'create_lead' && (
            <>
              <input
                value={data.actionParams?.title || ''}
                onChange={(e) => updateActionParam('title', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="Título do lead"
              />
              <input
                value={data.actionParams?.source || ''}
                onChange={(e) => updateActionParam('source', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="Fonte (ex: Chatbot)"
              />
            </>
          )}
        </div>
      )}

      {/* TEMPLATE */}
      {node.type === 'template' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Nome do template aprovado</label>
            <input
              value={data.templateName || ''}
              onChange={(e) => updateField('templateName', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="ex: order_confirmation"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Código do idioma</label>
            <input
              value={data.langCode || 'pt_BR'}
              onChange={(e) => updateField('langCode', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="pt_BR | pt_PT | en_US"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Variáveis (uma por linha, ordem 1, 2, 3...)</label>
            <textarea
              value={(data.variables || []).join('\n')}
              onChange={(e) => updateField('variables', e.target.value.split('\n').filter((s) => s !== ''))}
              rows={4}
              className="input-base w-full text-xs"
              placeholder={'{{contact.firstName}}\n12345'}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Suporta interpolação: <code>{'{{contact.firstName}}'}</code>, <code>{'{{vars.X}}'}</code>
            </p>
          </div>
        </div>
      )}

      {/* MEDIA */}
      {node.type === 'media' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Tipo</label>
            <select
              value={data.mediaType || 'image'}
              onChange={(e) => updateField('mediaType', e.target.value)}
              className="input-base w-full text-xs"
            >
              <option value="image">Imagem</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Documento</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">URL pública do ficheiro</label>
            <input
              value={data.mediaUrl || ''}
              onChange={(e) => updateField('mediaUrl', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="https://..."
            />
          </div>
          {(data.mediaType === 'image' || data.mediaType === 'video' || data.mediaType === 'document' || !data.mediaType) && (
            <div>
              <label className="block text-xs font-medium mb-1">Legenda (opcional)</label>
              <input
                value={data.caption || ''}
                onChange={(e) => updateField('caption', e.target.value)}
                className="input-base w-full text-xs"
                placeholder="Texto a acompanhar a mídia"
              />
            </div>
          )}
        </div>
      )}

      {/* BUTTONS */}
      {node.type === 'buttons' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Texto da pergunta</label>
            <textarea
              value={data.text || ''}
              onChange={(e) => updateField('text', e.target.value)}
              rows={3}
              className="input-base w-full text-xs"
              placeholder="Escolhe uma opção:"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Botões (máx 3)</label>
            <ButtonsEditor
              buttons={Array.isArray(data.buttons) ? data.buttons : []}
              onChange={(b) => updateField('buttons', b)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Guardar id do botão como</label>
            <input
              value={data.saveAs || ''}
              onChange={(e) => updateField('saveAs', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="escolha"
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Depois usa <code>{'{{vars.escolha}}'}</code> ou um nó Condição com "igual a" para ramificar.
            </p>
          </div>
        </div>
      )}

      {/* LIST (interactive list WhatsApp) */}
      {node.type === 'list' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Texto da pergunta</label>
            <textarea
              value={data.text || ''}
              onChange={(e) => updateField('text', e.target.value)}
              rows={2}
              className="input-base w-full text-xs"
              placeholder="Escolhe uma opção:"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Texto do botão (abre lista)</label>
            <input
              value={data.buttonLabel || ''}
              onChange={(e) => updateField('buttonLabel', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="Ver opções"
            />
          </div>
          <ListSectionsEditor
            sections={Array.isArray(data.sections) ? data.sections : []}
            onChange={(s) => updateField('sections', s)}
          />
          <div>
            <label className="block text-xs font-medium mb-1">Guardar id escolhido como</label>
            <input
              value={data.saveAs || ''}
              onChange={(e) => updateField('saveAs', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="escolha"
            />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Listas WhatsApp suportam até 10 opções por secção.
          </p>
        </div>
      )}

      {/* SWITCH */}
      {node.type === 'switch' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Variável a comparar (vazio = última mensagem)</label>
            <input
              value={data.target || ''}
              onChange={(e) => updateField('target', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="escolha"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Casos (cada um liga a um nó)</label>
            <SwitchCasesEditor
              cases={Array.isArray(data.cases) ? data.cases : []}
              onChange={(c) => updateField('cases', c)}
            />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Cada caso tem um identificador (handle). Liga a saída visual ao nó correspondente.
            O handle "default" é seguido se nenhum caso corresponder.
          </p>
        </div>
      )}

      {/* SET_VAR */}
      {node.type === 'set_var' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Nome da variável</label>
            <input
              value={data.varName || ''}
              onChange={(e) => updateField('varName', e.target.value)}
              className="input-base w-full text-xs"
              placeholder="estado"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Valor (suporta {`{{...}}`})</label>
            <textarea
              value={data.varValue || ''}
              onChange={(e) => updateField('varValue', e.target.value)}
              rows={2}
              className="input-base w-full text-xs"
              placeholder="qualificado"
            />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Acede com <code>{'{{vars.estado}}'}</code> nos nós seguintes.
          </p>
        </div>
      )}

      {/* FETCH_DATA */}
      {node.type === 'fetch_data' && (
        <div className="space-y-3">
          <input
            value={data.url || ''}
            onChange={(e) => updateField('url', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="https://api.exemplo.com/{{contact.id}}"
          />
          <select
            value={data.method || 'GET'}
            onChange={(e) => updateField('method', e.target.value)}
            className="input-base w-full text-xs"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <textarea
            value={data.headers || ''}
            onChange={(e) => updateField('headers', e.target.value)}
            rows={2}
            className="input-base w-full text-xs"
            placeholder='Headers JSON (opcional): {"Authorization":"Bearer ..."}'
          />
          {(data.method === 'POST' || data.method === 'PUT') && (
            <textarea
              value={data.body || ''}
              onChange={(e) => updateField('body', e.target.value)}
              rows={3}
              className="input-base w-full text-xs"
              placeholder='Body JSON (opcional)'
            />
          )}
          <input
            value={data.path || ''}
            onChange={(e) => updateField('path', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Path do JSON (ex: data.user.name) - opcional"
          />
          <input
            value={data.saveAs || 'response'}
            onChange={(e) => updateField('saveAs', e.target.value)}
            className="input-base w-full text-xs"
            placeholder="Guardar como (variável)"
          />
        </div>
      )}

      {/* SUBFLOW */}
      {node.type === 'subflow' && (
        <div className="space-y-3">
          <ChatbotPickerInline
            value={data.flowId || ''}
            onChange={(v) => updateField('flowId', v)}
          />
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Executa outro chatbot deste workspace e volta aqui no fim. As variáveis são partilhadas.
          </p>
        </div>
      )}

      {/* HANDOFF */}
      {node.type === 'handoff' && (
        <div className="space-y-3">
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Atribui a conversa a um humano e termina o fluxo. Define utilizador específico OU equipa (round-robin).
          </p>
          <div>
            <label className="block text-xs font-medium mb-1">Utilizador específico</label>
            <UserPicker
              value={data.userId || ''}
              onChange={(v) => updateField('userId', v)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Ou equipa (atribui ao membro com menos conversas)</label>
            <TeamPicker
              value={data.teamId || ''}
              onChange={(v) => updateField('teamId', v)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Mensagem ao cliente (opcional)</label>
            <textarea
              value={data.message || ''}
              onChange={(e) => updateField('message', e.target.value)}
              rows={3}
              className="input-base w-full text-xs"
              placeholder="Vou transferir-te para um colega humano..."
            />
          </div>
        </div>
      )}

      {/* DELAY */}
      {node.type === 'delay' && (
        <div className="space-y-3">
          <DelayPicker
            seconds={Number(data.delaySeconds) || 60}
            onChange={(s) => updateField('delaySeconds', s)}
          />
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            O fluxo pausa por este tempo antes de avançar para o próximo nó.
          </p>
        </div>
      )}

      {/* AI */}
      {node.type === 'ai' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Instruções do agente</label>
            <textarea
              value={data.aiPrompt || ''}
              onChange={(e) => updateField('aiPrompt', e.target.value)}
              rows={6}
              className="input-base w-full text-xs"
              placeholder="És um assistente de vendas. Responde de forma profissional..."
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!data.waitForReply}
              onChange={(e) => updateField('waitForReply', e.target.checked)}
            />
            Esperar resposta após enviar
          </label>
        </div>
      )}

      {/* END */}
      {node.type === 'end' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Marca o fim do fluxo. O bot fica disponível para um novo trigger.
        </p>
      )}
    </div>
  );
}

// ── Helpers de pickers (carregam dados da API) ────────
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
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  useEffect(() => { api.get('/tags').then((r) => setTags(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher tag --</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function TeamPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get('/teams').then((r) => setTeams(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Sem equipa --</option>
      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function ListSectionsEditor({ sections, onChange }: {
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  onChange: (s: any[]) => void;
}) {
  const updateSection = (i: number, patch: any) => onChange(sections.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const addSection = () => onChange([...sections, { title: 'Nova secção', rows: [{ id: `r${Date.now()}`, title: 'Opção' }] }]);
  const removeSection = (i: number) => onChange(sections.filter((_, idx) => idx !== i));

  const updateRow = (si: number, ri: number, patch: any) => {
    const s = sections[si];
    const newRows = s.rows.map((r, idx) => idx === ri ? { ...r, ...patch } : r);
    updateSection(si, { rows: newRows });
  };
  const addRow = (si: number) => {
    const s = sections[si];
    if (s.rows.length >= 10) return;
    updateSection(si, { rows: [...s.rows, { id: `r${Date.now()}`, title: 'Nova opção' }] });
  };
  const removeRow = (si: number, ri: number) => {
    const s = sections[si];
    updateSection(si, { rows: s.rows.filter((_, idx) => idx !== ri) });
  };

  return (
    <div className="space-y-3">
      {sections.map((section, si) => (
        <div key={si} className="card p-2" style={{ background: 'var(--surface-3)' }}>
          <div className="flex gap-1 items-center mb-2">
            <input
              value={section.title}
              onChange={(e) => updateSection(si, { title: e.target.value })}
              placeholder="Título da secção"
              className="input-base text-xs flex-1 font-semibold"
            />
            <button onClick={() => removeSection(si)} className="text-red-500 p-1 hover:bg-red-50 rounded">
              <Trash2 size={11} />
            </button>
          </div>
          <div className="space-y-1.5">
            {section.rows.map((row, ri) => (
              <div key={ri} className="flex gap-1 items-center">
                <input
                  value={row.title}
                  onChange={(e) => updateRow(si, ri, { title: e.target.value })}
                  placeholder="Título"
                  className="input-base text-xs flex-1"
                />
                <input
                  value={row.id}
                  onChange={(e) => updateRow(si, ri, { id: e.target.value })}
                  placeholder="id"
                  className="input-base text-xs"
                  style={{ width: 70 }}
                />
                <button onClick={() => removeRow(si, ri)} className="text-red-500 p-1 hover:bg-red-50 rounded">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {section.rows.length < 10 && (
              <button onClick={() => addRow(si)} className="btn btn-outline text-[11px] py-1 w-full gap-1">
                <Plus size={10} /> Adicionar linha
              </button>
            )}
          </div>
        </div>
      ))}
      <button onClick={addSection} className="btn btn-outline text-xs py-1.5 w-full gap-1">
        <Plus size={11} /> Adicionar secção
      </button>
    </div>
  );
}

function SwitchCasesEditor({ cases, onChange }: {
  cases: { value: string; handle: string }[];
  onChange: (c: { value: string; handle: string }[]) => void;
}) {
  const update = (i: number, patch: any) => onChange(cases.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const add = () => onChange([...cases, { value: '', handle: `case_${cases.length + 1}` }]);
  const remove = (i: number) => onChange(cases.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-1.5">
      {cases.map((c, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input
            value={c.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="Valor (ex: sim)"
            className="input-base text-xs flex-1"
          />
          <input
            value={c.handle}
            onChange={(e) => update(i, { handle: e.target.value })}
            placeholder="Handle"
            className="input-base text-xs"
            style={{ width: 100 }}
          />
          <button onClick={() => remove(i)} className="text-red-500 p-1 hover:bg-red-50 rounded">
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <button onClick={add} className="btn btn-outline text-xs py-1 w-full gap-1">
        <Plus size={11} /> Adicionar caso
      </button>
    </div>
  );
}

function ChatbotPickerInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [flows, setFlows] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.get('/chatbots').then((r) => setFlows(r.data)).catch(() => {}); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base w-full text-xs">
      <option value="">-- Escolher chatbot --</option>
      {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

function ButtonsEditor({ buttons, onChange }: { buttons: { id: string; label: string }[]; onChange: (b: { id: string; label: string }[]) => void }) {
  const update = (i: number, patch: Partial<{ id: string; label: string }>) => {
    const next = buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    onChange(next);
  };
  const add = () => {
    if (buttons.length >= 3) return;
    onChange([...buttons, { id: `opt${buttons.length + 1}`, label: `Opção ${buttons.length + 1}` }]);
  };
  const remove = (i: number) => onChange(buttons.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      {buttons.map((b, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input
            value={b.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Texto"
            className="input-base flex-1 text-xs"
          />
          <input
            value={b.id}
            onChange={(e) => update(i, { id: e.target.value })}
            placeholder="id"
            className="input-base text-xs"
            style={{ width: 80 }}
          />
          <button onClick={() => remove(i)} className="text-red-500 p-1 hover:bg-red-50 rounded">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {buttons.length < 3 && (
        <button onClick={add} className="btn btn-outline text-xs py-1 w-full gap-1">
          <Plus size={11} /> Adicionar botão
        </button>
      )}
    </div>
  );
}

function DelayPicker({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const [unit, setUnit] = useState<'s' | 'm' | 'h' | 'd'>(() => {
    if (seconds % 86400 === 0 && seconds >= 86400) return 'd';
    if (seconds % 3600 === 0 && seconds >= 3600) return 'h';
    if (seconds % 60 === 0 && seconds >= 60) return 'm';
    return 's';
  });
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  const display = Math.round(seconds / factor);
  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={1}
        value={display}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value)) * factor)}
        className="input-base flex-1 text-xs"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as any)}
        className="input-base text-xs"
        style={{ width: 90 }}
      >
        <option value="s">segundos</option>
        <option value="m">minutos</option>
        <option value="h">horas</option>
        <option value="d">dias</option>
      </select>
    </div>
  );
}

// ── Configurar trigger do fluxo ───────────────────────
function FlowSettingsModal({
  flow, onClose, onSave,
}: { flow: ChatbotFlow; onClose: () => void; onSave: (changes: Partial<ChatbotFlow>) => void }) {
  const [name, setName] = useState(flow.name);
  const [trigger, setTrigger] = useState<ChatbotTrigger>(flow.trigger);
  const [triggerValue, setTriggerValue] = useState(flow.triggerValue || '');
  const [channel, setChannel] = useState(flow.channel || 'WHATSAPP');
  const [description, setDescription] = useState(flow.description || '');
  const [bhStart, setBhStart] = useState<number | ''>(flow.businessHoursStart ?? '');
  const [bhEnd, setBhEnd] = useState<number | ''>(flow.businessHoursEnd ?? '');
  const [bhWd, setBhWd] = useState(flow.businessHoursWeekdays || '');
  const [outOfHours, setOutOfHours] = useState(flow.outOfHoursMessage || '');
  const [language, setLanguage] = useState(flow.language || 'pt');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card p-6" style={{ width: 480, maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base">Configurar fluxo</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Descrição</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-base w-full text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Canal</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-base w-full text-sm">
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="WEBCHAT">Webchat</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Quando activar?</label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value as ChatbotTrigger)} className="input-base w-full text-sm">
              <option value="first_message">Na primeira mensagem do contacto</option>
              <option value="keyword">Quando a mensagem contém uma palavra-chave</option>
              <option value="always">Em todas as mensagens (sem outro fluxo activo)</option>
            </select>
          </div>
          {trigger === 'keyword' && (
            <div>
              <label className="block text-xs font-medium mb-1">Palavra-chave</label>
              <input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className="input-base w-full text-sm" placeholder="ex: preço" />
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p className="font-semibold text-xs mb-2">HORÁRIO COMERCIAL (opcional)</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number" min={0} max={23}
                value={bhStart}
                onChange={(e) => setBhStart(e.target.value === '' ? '' : Number(e.target.value))}
                className="input-base w-full text-sm"
                placeholder="Hora início (0-23)"
              />
              <input
                type="number" min={0} max={23}
                value={bhEnd}
                onChange={(e) => setBhEnd(e.target.value === '' ? '' : Number(e.target.value))}
                className="input-base w-full text-sm"
                placeholder="Hora fim (0-23)"
              />
            </div>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const labels = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
                const active = bhWd.includes(String(d));
                return (
                  <button
                    key={d}
                    onClick={() => setBhWd(active ? bhWd.replace(String(d), '') : bhWd + String(d))}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: active ? '#F6E3DC' : 'var(--surface-3)', color: active ? 'var(--primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}
                  >
                    {labels[d]}
                  </button>
                );
              })}
            </div>
            <textarea
              value={outOfHours}
              onChange={(e) => setOutOfHours(e.target.value)}
              rows={2}
              className="input-base w-full text-sm mt-2"
              placeholder="Mensagem fora de horas (opcional)"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Idioma</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-base w-full text-sm">
              <option value="pt">Português</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
              <option value="fr">Francês</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn btn-outline text-sm py-1.5">Cancelar</button>
          <button
            onClick={() => onSave({
              name, description, trigger, triggerValue: trigger === 'keyword' ? triggerValue : null, channel,
              businessHoursStart: bhStart === '' ? null : (bhStart as number),
              businessHoursEnd: bhEnd === '' ? null : (bhEnd as number),
              businessHoursWeekdays: bhWd || null,
              outOfHoursMessage: outOfHours || null,
              language,
            })}
            className="btn btn-primary text-sm py-1.5"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Editor wrapper ────────────────────────────────────
function ChatbotEditorInner({ flow, onClose, onSaved }: { flow: ChatbotFlow; onClose: () => void; onSaved: (f: ChatbotFlow) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(
    flow.nodes && flow.nodes.length ? (flow.nodes as any) : defaultNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    flow.edges && flow.edges.length ? (flow.edges as any) : defaultEdges,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flowState, setFlowState] = useState<ChatbotFlow>(flow);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges],
  );

  const onSelectionChange = useCallback(({ nodes: ns }: { nodes: Node[] }) => {
    setSelectedNodeId(ns[0]?.id || null);
  }, []);

  // Eliminar com Delete (só nós que não são trigger)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (!node || node.type === 'trigger') return;
        deleteNode(selectedNodeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, nodes]);

  const addNode = (type: ChatbotNodeType) => {
    const id = `${type}_${Date.now()}`;
    const center = { x: 350, y: 200 };
    const labels: Record<string, string> = {
      message: 'Nova mensagem',
      template: 'Template',
      media: 'Enviar mídia',
      buttons: 'Escolhe uma opção:',
      list: 'Lista de opções',
      condition: 'Nova condição',
      switch: 'Switch',
      action: 'Configurar acção',
      set_var: 'Definir variável',
      fetch_data: 'Buscar API',
      subflow: 'Chamar sub-fluxo',
      handoff: 'Transferir para humano',
      delay: '1 hora',
      ai: 'Responder com IA',
      end: 'Fim',
    };
    const initialData: Record<string, any> = {
      delay: { delaySeconds: 3600, label: labels.delay },
      template: { templateName: '', langCode: 'pt_BR', variables: [], label: labels.template },
      media: { mediaType: 'image', mediaUrl: '', caption: '', label: labels.media },
      buttons: { text: 'Escolhe uma opção:', buttons: [{ id: 'opt1', label: 'Opção 1' }, { id: 'opt2', label: 'Opção 2' }], saveAs: 'escolha', label: labels.buttons },
      list: { text: 'Escolhe uma opção:', buttonLabel: 'Ver opções', sections: [{ title: 'Opções', rows: [{ id: 'r1', title: 'Opção 1' }] }], saveAs: 'escolha' },
      switch: { target: '', cases: [{ value: 'sim', handle: 'sim' }, { value: 'nao', handle: 'nao' }], default: 'default' },
      set_var: { varName: 'minhaVar', varValue: '' },
      fetch_data: { url: '', method: 'GET', saveAs: 'response' },
      subflow: { flowId: '' },
      handoff: { userId: '', teamId: '', message: 'Vou transferir-te para um colega humano. Aguarda um momento.', label: labels.handoff },
    };
    const newNode: Node = {
      id,
      type,
      position: { x: center.x + (Math.random() - 0.5) * 60, y: center.y + (Math.random() - 0.5) * 60 },
      data: initialData[type] || { label: labels[type] || type },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
  };

  const deleteNode = (id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
  };

  const updateNodeData = (id: string, newData: any) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: newData } : n)));
  };

  const validate = (): string | null => {
    if (!nodes.find((n) => n.type === 'trigger')) return 'Falta o nó Trigger.';
    const hasEnd = nodes.some((n) => n.type === 'end');
    if (!hasEnd) return 'Adiciona pelo menos um nó Fim.';
    if (flowState.trigger === 'keyword' && !flowState.triggerValue) return 'Define a palavra-chave nas Definições do fluxo.';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const res = await api.patch(`/chatbots/${flow.id}`, {
        name: flowState.name,
        description: flowState.description,
        trigger: flowState.trigger,
        triggerValue: flowState.triggerValue,
        channel: flowState.channel,
        nodes,
        edges,
      });
      toast.success('Chatbot guardado');
      onSaved(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    // Pede um contacto qualquer para simular
    try {
      const contactsRes = await api.get('/contacts?limit=1');
      const contact = contactsRes.data.contacts?.[0];
      if (!contact) { toast.error('Cria um contacto primeiro para poder testar'); return; }

      // Guarda primeiro
      await api.patch(`/chatbots/${flow.id}`, { nodes, edges });

      const testMessage = window.prompt('Mensagem de teste (será usada como entrada do fluxo):', 'olá');
      if (testMessage === null) return;

      const res = await api.post(`/chatbots/${flow.id}/test`, {
        contactId: contact.id,
        message: testMessage,
        dryRun: true,
      });

      const log: string[] = res.data.log || [];
      const steps: ChatbotLogEntry[] = res.data.steps || [];
      toast.success('Teste executado');
      console.log('--- Log do fluxo ---');
      log.forEach((l) => console.log(l));
      console.log('--- Steps ---', steps);
      alert('Resultado do teste:\n\n' + log.join('\n'));
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a testar');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        <input
          className="font-bold text-base outline-none border-b-2 border-transparent focus:border-indigo-500 px-1"
          style={{ fontFamily: 'Manrope, sans-serif' }}
          value={flowState.name}
          onChange={(e) => setFlowState({ ...flowState, name: e.target.value })}
        />
        <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
          {triggerLabel(flowState.trigger, flowState.triggerValue)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowSettings(true)} className="btn btn-outline text-sm py-1.5 gap-1.5">
            <SettingsIcon size={13} /> Definições
          </button>
          <button onClick={handleTest} className="btn btn-outline text-sm py-1.5 gap-1.5">
            <Play size={13} /> Testar
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary text-sm py-1.5 gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Paleta */}
        <div className="flex flex-col gap-2 p-3 overflow-y-auto" style={{ width: 160, borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>ADICIONAR NÓ</p>
          {NODE_PALETTE.map((n) => (
            <button
              key={n.type}
              onClick={() => addNode(n.type)}
              className="flex items-center gap-2 p-2 rounded-lg text-left text-xs transition-colors hover:bg-white"
              style={{ border: `1px solid ${n.color}30`, background: `${n.color}10` }}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              <span style={{ color: n.color, fontWeight: 500 }}>{n.label}</span>
            </button>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <strong>Atalho:</strong> seleciona um nó e prime <kbd>Delete</kbd> para eliminar.
            </p>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode={null}
          >
            <Background color="#E2E8F0" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const colors: Record<string, string> = {
                  trigger: '#C8553D', message: '#0EA5E9', template: '#EC4899',
                  media: '#06B6D4', buttons: '#F97316', list: '#0891B2',
                  condition: '#F59E0B', switch: '#D946EF',
                  action: '#10B981', handoff: '#FACC15', delay: '#8B5CF6',
                  end: '#EF4444', ai: '#C8553D',
                  set_var: '#84CC16', fetch_data: '#14B8A6', subflow: '#7C3AED',
                };
                return colors[n.type || ''] || '#94A3B8';
              }}
            />
          </ReactFlow>
        </div>

        {/* Painel de propriedades do nó */}
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            onChange={(d) => updateNodeData(selectedNode.id, d)}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        )}
      </div>

      {showSettings && (
        <FlowSettingsModal
          flow={flowState}
          onClose={() => setShowSettings(false)}
          onSave={(changes) => {
            setFlowState({ ...flowState, ...changes });
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function triggerLabel(t: ChatbotTrigger, value?: string | null): string {
  if (t === 'first_message') return 'Trigger: primeira mensagem';
  if (t === 'keyword') return `Trigger: contém "${value || ''}"`;
  if (t === 'always') return 'Trigger: sempre';
  return t;
}

function ChatbotEditor(props: { flow: ChatbotFlow; onClose: () => void; onSaved: (f: ChatbotFlow) => void }) {
  return (
    <ReactFlowProvider>
      <ChatbotEditorInner {...props} />
    </ReactFlowProvider>
  );
}

// ── Modal de histórico de sessões ─────────────────────
function HistoryModal({ flow, onClose }: { flow: ChatbotFlow; onClose: () => void }) {
  const [sessions, setSessions] = useState<ChatbotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/chatbots/${flow.id}/sessions`);
      setSessions(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a carregar histórico');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [flow.id]);

  const clearAll = async () => {
    if (!confirm('Limpar todas as sessões deste chatbot? Os contactos com fluxos pendentes vão começar do início na próxima mensagem.')) return;
    setClearing(true);
    try {
      const res = await api.delete(`/chatbots/${flow.id}/sessions`);
      toast.success(`${res.data.deleted} sessões eliminadas`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h3 className="font-bold text-base" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Histórico — {flow.name}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {sessions.length} sessões registadas (mais recentes primeiro)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {sessions.length > 0 && (
              <button onClick={clearAll} disabled={clearing} className="btn text-xs py-1.5 px-3" style={{ color: '#EF4444', border: '1px solid #FEE2E2', background: 'transparent' }}>
                {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Limpar tudo
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X size={16} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }} className="p-4">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={20} /></div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>
              <History size={32} className="mx-auto mb-2 opacity-40" />
              Sem execuções ainda. Quando alguém entrar no fluxo, aparece aqui.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => {
                const expanded = expandedId === s.id;
                const log: ChatbotLogEntry[] = (s.log as any) || [];
                const contactName = s.contact ? `${s.contact.firstName} ${s.contact.lastName || ''}`.trim() : 'Contacto desconhecido';
                return (
                  <div key={s.id} className="card p-3" style={{ background: 'var(--surface-2)' }}>
                    <button
                      onClick={() => setExpandedId(expanded ? null : s.id)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      <ChevronRight
                        size={14}
                        style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--text-muted)' }}
                      />
                      <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{contactName}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {s.contact?.whatsapp || s.contact?.phone || '-'} · {new Date(s.updatedAt).toLocaleString('pt-PT')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span style={{ color: 'var(--text-muted)' }}>{log.length} passos</span>
                        {s.isFinished ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: '#ECFDF5', color: '#10B981' }}>
                            <CheckCircle2 size={11} /> Terminado
                          </span>
                        ) : s.resumeAt ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: '#EDE9FE', color: '#8B5CF6' }}>
                            <Clock size={11} /> A aguardar
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#B45309' }}>
                            <Activity size={11} /> Em curso
                          </span>
                        )}
                      </div>
                    </button>

                    {expanded && (
                      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                        {log.length === 0 ? (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>(sem passos registados)</p>
                        ) : (
                          <ol className="space-y-1.5">
                            {log.map((e, i) => (
                              <li key={i} className="text-xs flex gap-2">
                                <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                                  {new Date(e.at).toLocaleTimeString('pt-PT')}
                                </span>
                                <span className="font-medium" style={{ minWidth: 80, color: nodeColor(e.nodeType) }}>
                                  {e.nodeType}
                                </span>
                                <span className="flex-1">
                                  {e.action}
                                  {e.detail && <span style={{ color: 'var(--text-muted)' }}> — {e.detail}</span>}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {Object.keys(s.variables || {}).length > 0 && (
                          <div className="mt-3 pt-2" style={{ borderTop: '1px dashed var(--border)' }}>
                            <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>VARIÁVEIS CAPTURADAS</p>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(s.variables || {}).map(([k, v]) => (
                                <span key={k} className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--surface-3)' }}>
                                  <code>{k}</code> = {String(v).substring(0, 30)}
                                </span>
                              ))}
                            </div>
                          </div>
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

function nodeColor(t: string): string {
  const c: Record<string, string> = {
    trigger: '#C8553D', message: '#0EA5E9', template: '#EC4899',
    media: '#06B6D4', buttons: '#F97316', list: '#0891B2',
    condition: '#F59E0B', switch: '#D946EF',
    action: '#10B981', handoff: '#A16207', delay: '#8B5CF6',
    end: '#EF4444', ai: '#C8553D',
    set_var: '#84CC16', fetch_data: '#14B8A6', subflow: '#7C3AED',
  };
  return c[t] || '#64748B';
}

// ── Modal de templates pré-feitos ─────────────────────
function TemplatesModal({ onClose, onChosen }: { onClose: () => void; onChosen: (flow: ChatbotFlow) => void }) {
  const [templates, setTemplates] = useState<ChatbotTemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    api.get('/chatbots/templates').then((r) => setTemplates(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const choose = async (id: string) => {
    setCreating(id);
    try {
      const res = await api.post('/chatbots/from-template', { templateId: id });
      toast.success('Chatbot criado a partir do template');
      onChosen(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a criar');
    } finally { setCreating(null); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: 600, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-bold text-base" style={{ fontFamily: 'Manrope, sans-serif' }}>Escolher template</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="p-4" style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin" size={20} /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => choose(t.id)}
                  disabled={!!creating}
                  className="card p-4 text-left transition-colors hover:border-indigo-300"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'var(--surface-3)' }}>
                      {t.icon}
                    </div>
                    <h4 className="font-bold text-sm">{t.name}</h4>
                    {creating === t.id && <Loader2 size={14} className="animate-spin ml-auto" />}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChatbotTemplateInfo { id: string; name: string; description: string; icon: string; }

// ── Página principal: lista + criar ───────────────────
export default function ChatbotsPage() {
  const [flows, setFlows] = useState<ChatbotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ChatbotFlow | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyFor, setHistoryFor] = useState<ChatbotFlow | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/chatbots');
      setFlows(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a carregar chatbots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await api.post('/chatbots', {
        name: 'Novo Chatbot',
        trigger: 'first_message',
        channel: 'WHATSAPP',
        nodes: defaultNodes,
        edges: defaultEdges,
        isActive: false,
      });
      setFlows((f) => [res.data, ...f]);
      setEditing(res.data);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a criar');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (flow: ChatbotFlow) => {
    try {
      const res = await api.patch(`/chatbots/${flow.id}`, { isActive: !flow.isActive });
      setFlows((fs) => fs.map((f) => (f.id === flow.id ? res.data : f)));
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  const remove = async (flow: ChatbotFlow) => {
    if (!confirm(`Eliminar o chatbot "${flow.name}"? Esta acção não pode ser desfeita.`)) return;
    try {
      await api.delete(`/chatbots/${flow.id}`);
      setFlows((fs) => fs.filter((f) => f.id !== flow.id));
      toast.success('Chatbot eliminado');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  const duplicate = async (flow: ChatbotFlow) => {
    try {
      const res = await api.post(`/chatbots/${flow.id}/duplicate`);
      setFlows((fs) => [res.data, ...fs]);
      toast.success('Chatbot duplicado');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  if (editing) {
    return (
      <ChatbotEditor
        flow={editing}
        onClose={() => { setEditing(null); load(); }}
        onSaved={(f) => {
          setFlows((fs) => fs.map((x) => (x.id === f.id ? f : x)));
          setEditing(f);
        }}
      />
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Chatbots</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Cria fluxos de conversação automáticos sem código
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTemplates(true)} className="btn btn-outline gap-2">
            <span>📋</span> Templates
          </button>
          <button onClick={handleCreate} disabled={creating} className="btn btn-primary gap-2">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Novo Chatbot
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : flows.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
            <Bot size={28} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Sem chatbots ainda</h3>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Cria fluxos visuais que respondem automaticamente a clientes no WhatsApp. Podes pedir nome, qualificar leads, criar tarefas e mais.
          </p>
          <button onClick={handleCreate} className="btn btn-primary gap-2 mt-2">
            <Plus size={16} /> Criar primeiro chatbot
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map((bot) => (
            <div key={bot.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bot.isActive ? '#F6E3DC' : 'var(--surface-3)' }}>
                  <Bot size={20} style={{ color: bot.isActive ? 'var(--primary)' : 'var(--text-muted)' }} />
                </div>
                <button
                  onClick={() => toggleActive(bot)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: bot.isActive ? '#ECFDF5' : 'var(--surface-3)', color: bot.isActive ? '#10B981' : 'var(--text-muted)' }}
                >
                  {bot.isActive ? <Play size={11} /> : <ZapOff size={11} />}
                  {bot.isActive ? 'Activo' : 'Inactivo'}
                </button>
              </div>
              <h3 className="font-bold text-sm mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>{bot.name}</h3>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                {triggerLabel(bot.trigger, bot.triggerValue)}
              </p>
              {bot.description && (
                <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{bot.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                <span className="flex items-center gap-1"><Activity size={11} /> {(bot.nodes || []).length} nós</span>
                <span>•</span>
                <span>{bot.runCount || 0} execuções</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(bot)} className="btn btn-outline flex-1 text-xs py-1.5">Editar fluxo</button>
                <button onClick={() => setHistoryFor(bot)} className="btn text-xs py-1.5 px-2.5" title="Histórico" style={{ border: '1px solid var(--border)', background: 'transparent' }}>
                  <History size={13} />
                </button>
                <button onClick={() => duplicate(bot)} className="btn text-xs py-1.5 px-2.5" title="Duplicar" style={{ border: '1px solid var(--border)', background: 'transparent' }}>
                  <Copy size={13} />
                </button>
                <button onClick={() => remove(bot)} className="btn text-xs py-1.5 px-2.5" title="Eliminar" style={{ color: '#EF4444', border: '1px solid #FEE2E2', background: 'transparent' }}>
                  <Trash2 size={13} />
                </button>
              </div>
              {!(bot.nodes && bot.nodes.length) && (
                <div className="mt-3 flex items-center gap-1.5 text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <AlertCircle size={11} /> Fluxo vazio, precisa de configuração
                </div>
              )}
            </div>
          ))}

          <button
            onClick={handleCreate}
            disabled={creating}
            className="card p-5 flex flex-col items-center justify-center gap-3 border-dashed hover:border-indigo-300 transition-colors"
            style={{ minHeight: 200 }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--surface-3)' }}>
              <Plus size={24} style={{ color: 'var(--text-muted)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Criar novo chatbot</p>
          </button>
        </div>
      )}

      {historyFor && <HistoryModal flow={historyFor} onClose={() => setHistoryFor(null)} />}
      {showTemplates && <TemplatesModal
        onClose={() => setShowTemplates(false)}
        onChosen={(flow) => {
          setShowTemplates(false);
          setFlows((arr) => [flow, ...arr]);
          setEditing(flow);
        }}
      />}
    </div>
  );
}
