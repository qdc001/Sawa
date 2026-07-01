// Modal de auto-tarefa: dispara envio de mensagem + criacao/conclusao
// automatica de tarefa. Duas variantes acessiveis por 2 abas:
//   - Anunciar: "Vou enviar X ate D" (cria tarefa)
//   - Entregar: "Envio em anexo o X, pede feedback" (fecha tarefa + follow-up)

import { useEffect, useState } from 'react';
import { X, Loader2, Send, CalendarClock, CheckCircle2 } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

type Mode = 'announce' | 'deliver';

const TIPOS = ['Dissertação', 'Monografia', 'Projecto', 'Slides', 'Outros'] as const;

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
  const [subject, setSubject] = useState('');
  const [tipo, setTipo] = useState<string>('Outros');
  const [dueDate, setDueDate] = useState(todayPlusDays(3));
  const [taskToClose, setTaskToClose] = useState<string>('');
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (mode !== 'deliver') return;
    api.get('/auto-task/open-tasks', { params: { contactId } })
      .then(({ data }) => setOpenTasks(data.tasks || []))
      .catch(() => setOpenTasks([]));
  }, [mode, contactId]);

  const previewMessage = () => {
    const subj = subject.trim() || '...';
    const nome = contactName || 'cliente';
    if (mode === 'announce') {
      const tipoText = tipo && tipo !== 'Outros' ? ` do teu ${tipo.toLowerCase()}` : '';
      return `Olá ${nome}, irei enviar o(a) ${subj}${tipoText} até ${dueDate}.`;
    }
    return `Olá ${nome}, envio em anexo o(a) ${subj}. Peço para analisar e depois deixar o teu feedback.`;
  };

  const previewTaskTitle = () => {
    const subj = subject.trim() || '...';
    if (mode === 'announce') {
      return tipo && tipo !== 'Outros' ? `Enviar ${subj} do ${tipo.toLowerCase()}` : `Enviar ${subj}`;
    }
    return `Pedir feedback do ${subj}`;
  };

  const send = async () => {
    const subj = subject.trim();
    if (!subj) { toast.error('Assunto é obrigatório'); return; }
    if (mode === 'announce' && !/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(dueDate)) {
      toast.error('Data inválida (usa DD/MM ou DD/MM/YYYY)');
      return;
    }
    setSending(true);
    try {
      if (mode === 'announce') {
        await api.post('/auto-task/announce', {
          contactId,
          subject: subj,
          type: tipo,
          dueDate,
          leadId: leadId || undefined,
        });
        toast.success('Mensagem enviada e tarefa criada');
      } else {
        await api.post('/auto-task/deliver', {
          contactId,
          subject: subj,
          taskToCompleteId: taskToClose || undefined,
          leadId: leadId || undefined,
        });
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
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input-base w-full mt-1"
              placeholder="Ex: Capítulo 1, revisão da introdução, primeira versão"
              autoFocus
              maxLength={200}
            />
          </div>

          {mode === 'announce' && (
            <>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Tipo de trabalho (opcional)</label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input-base w-full mt-1">
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
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
            </>
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
          <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <p className="text-[10px] uppercase font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Mensagem a enviar</p>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{previewMessage()}</p>
            <p className="text-[10px] uppercase font-semibold mt-3 mb-1" style={{ color: 'var(--text-muted)' }}>Tarefa</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {mode === 'announce'
                ? `Cria "${previewTaskTitle()}" com prazo ${dueDate}`
                : `${taskToClose ? 'Fecha a tarefa escolhida e cria ' : 'Cria '}"${previewTaskTitle()}" com prazo em 3 dias`}
            </p>
          </div>
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
