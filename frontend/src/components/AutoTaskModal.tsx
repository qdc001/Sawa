// Modal de auto-tarefa: dispara envio de mensagem + criacao/conclusao
// automatica de tarefa. Configuravel via Definicoes > Auto-tarefa.
//
// Se o utilizador escolher o tipo "outros", aparece campo livre para
// escrever qualquer texto (ex: "Ensaio", "Relatorio semanal").

import { useEffect, useState } from 'react';
import { X, Loader2, Send, CalendarClock, CheckCircle2 } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

type Mode = 'announce' | 'deliver';

type WorkType = {
  key: string;
  label: string;
  article: string;
  possessive: string;
};

type Config = {
  workTypes: WorkType[];
  subjects: string[];
  announceTemplate: string;
  deliverTemplate: string;
  followupDays: number;
};

interface OpenTask {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
}

interface Props {
  contactId: string;
  contactName: string;
  leadId?: string | null;
  onClose: () => void;
  onSent: () => void;
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AutoTaskModal({ contactId, contactName, leadId, onClose, onSent }: Props) {
  const [mode, setMode] = useState<Mode>('announce');
  // subjectChoice: valor do dropdown. Se for 'Outros' mostra input de texto.
  const [subjectChoice, setSubjectChoice] = useState<string>('');
  const [customSubject, setCustomSubject] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [typeKey, setTypeKey] = useState<string>('');
  const [customTypeLabel, setCustomTypeLabel] = useState('');
  const [dueDate, setDueDate] = useState(todayPlusDays(3));
  const [taskToClose, setTaskToClose] = useState<string>('');
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<{ message: string; taskTitle: string } | null>(null);

  // Valor efectivo do assunto (dropdown ou custom)
  const effectiveSubject = subjectChoice === '__outros__' ? customSubject.trim() : subjectChoice;

  // Carregar config
  useEffect(() => {
    api.get('/auto-task/config').then(({ data }) => {
      setConfig(data.config);
      if (data.config?.workTypes?.[0]) setTypeKey(data.config.workTypes[0].key);
      if (data.config?.subjects?.[0]) setSubjectChoice(data.config.subjects[0]);
    }).catch(() => toast.error('Erro a carregar configuração'));
  }, []);

  // Tarefas abertas para o dropdown de fechar (modo deliver)
  useEffect(() => {
    if (mode !== 'deliver') return;
    api.get('/auto-task/open-tasks', { params: { contactId } })
      .then(({ data }) => setOpenTasks(data.tasks || []))
      .catch(() => setOpenTasks([]));
  }, [mode, contactId]);

  // Preview via backend (respeita templates e concordancia)
  useEffect(() => {
    if (!effectiveSubject || !config) { setPreview(null); return; }
    const t = setTimeout(() => {
      api.get('/auto-task/preview', {
        params: {
          mode,
          typeKey,
          customTypeLabel,
          subject: effectiveSubject,
          dueDate,
          nome: contactName,
        },
      }).then(({ data }) => setPreview(data)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [mode, typeKey, customTypeLabel, effectiveSubject, dueDate, contactName, config]);

  const isOthers = typeKey === 'outros';

  const send = async () => {
    const subj = effectiveSubject;
    if (!subj) { toast.error('Assunto é obrigatório'); return; }
    if (mode === 'announce' && !/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(dueDate)) {
      toast.error('Data inválida (usa DD/MM ou DD/MM/YYYY)');
      return;
    }
    if (isOthers && !customTypeLabel.trim()) {
      toast.error('Escreve qual é o tipo de trabalho (campo Outros)');
      return;
    }
    setSending(true);
    try {
      const body: any = {
        contactId,
        subject: subj,
        typeKey,
        customTypeLabel: isOthers ? customTypeLabel.trim() : undefined,
        leadId: leadId || undefined,
      };
      if (mode === 'announce') {
        body.dueDate = dueDate;
        await api.post('/auto-task/announce', body);
        toast.success('Mensagem enviada e tarefa criada');
      } else {
        if (taskToClose) body.taskToCompleteId = taskToClose;
        await api.post('/auto-task/deliver', body);
        toast.success('Mensagem enviada, tarefa fechada e follow-up criado');
      }
      onSent();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a enviar');
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Envio com tarefa</h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Para {contactName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5">
            <X size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-1 p-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => setMode('announce')}
            className="px-3 py-2 rounded text-xs font-medium flex items-center justify-center gap-1.5"
            style={{
              background: mode === 'announce' ? 'var(--primary-light)' : 'var(--surface-2)',
              color: mode === 'announce' ? 'var(--primary)' : 'var(--text-secondary)',
            }}
          >
            <CalendarClock size={13} /> Vou enviar
          </button>
          <button
            onClick={() => setMode('deliver')}
            className="px-3 py-2 rounded text-xs font-medium flex items-center justify-center gap-1.5"
            style={{
              background: mode === 'deliver' ? 'var(--primary-light)' : 'var(--surface-2)',
              color: mode === 'deliver' ? 'var(--primary)' : 'var(--text-secondary)',
            }}
          >
            <CheckCircle2 size={13} /> Estou a entregar
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Assunto</label>
            {config && (
              <select
                value={subjectChoice}
                onChange={(e) => setSubjectChoice(e.target.value)}
                className="input-base w-full mt-1"
                autoFocus
              >
                {config.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value="__outros__">Outros (escrever)</option>
              </select>
            )}
            {subjectChoice === '__outros__' && (
              <input
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                className="input-base w-full mt-2"
                placeholder="Escreve o assunto"
                maxLength={200}
              />
            )}
          </div>

          {config && (
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Tipo de trabalho</label>
              <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} className="input-base w-full mt-1">
                {config.workTypes.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              {isOthers && (
                <input
                  className="input-base w-full mt-2"
                  placeholder="Escreve o tipo (ex: ensaio, relatório semanal)"
                  value={customTypeLabel}
                  onChange={(e) => setCustomTypeLabel(e.target.value)}
                  maxLength={80}
                />
              )}
            </div>
          )}

          {mode === 'announce' && (
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Data limite (DD/MM)</label>
              <input
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-base w-full mt-1"
                placeholder="Ex: 15/12"
                maxLength={10}
              />
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Tarefa fica com prazo 23:59 desse dia.</p>
            </div>
          )}

          {mode === 'deliver' && openTasks.length > 0 && (
            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Fechar tarefa (opcional)</label>
              <select value={taskToClose} onChange={(e) => setTaskToClose(e.target.value)} className="input-base w-full mt-1">
                <option value="">— Não fechar nenhuma —</option>
                {openTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}{t.dueAt ? ` (até ${new Date(t.dueAt).toLocaleDateString('pt-PT')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Preview */}
          {preview ? (
            <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Mensagem a enviar</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{preview.message}</p>
              <p className="text-[10px] uppercase font-semibold mt-3 mb-1" style={{ color: 'var(--text-muted)' }}>Tarefa</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {mode === 'announce'
                  ? `Cria "${preview.taskTitle}" com prazo ${dueDate}`
                  : `${taskToClose ? 'Fecha a tarefa escolhida e cria ' : 'Cria '}"${preview.taskTitle}" com prazo em ${config?.followupDays || 3} dias`}
              </p>
            </div>
          ) : (
            <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              Escreve o assunto para ver a pré-visualização.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex gap-2" style={{ borderColor: 'var(--border)' }}>
          <button onClick={onClose} className="btn flex-1" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            Cancelar
          </button>
          <button onClick={send} disabled={sending} className="btn btn-primary flex-1 flex items-center justify-center gap-1.5">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'A enviar...' : 'Enviar e criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}
