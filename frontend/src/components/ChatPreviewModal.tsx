// Modal de pre-visualizacao de chat — usado na pagina de Tarefas para ver
// rapidamente as ultimas mensagens da conversa associada a uma tarefa, sem
// sair da pagina. Estilo igual ao do Inbox, mas em formato popup.

import { useEffect, useRef, useState } from 'react';
import { Loader2, X, ExternalLink, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface ChatMessage {
  id: string;
  content: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  createdAt: string;
  isInternal?: boolean;
  sentBy?: { id: string; name: string } | null;
  transcription?: string | null;
}

interface Props {
  leadId?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  onClose: () => void;
}

const MAX_MESSAGES = 20;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ChatPreviewModal({ leadId, contactId, contactName, onClose }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const params: any = { limit: MAX_MESSAGES };
      if (leadId) params.leadId = leadId;
      else if (contactId) params.contactId = contactId;
      else return;
      const { data } = await api.get('/messages', { params });
      // API devolve da mais recente para a mais antiga; queremos cronologica
      const list = Array.isArray(data) ? data : (data.messages || []);
      setMessages(list.slice().reverse());
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [leadId, contactId]);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  const sendQuickReply = async () => {
    const text = reply.trim();
    if (!text || sending || !contactId) return;
    setSending(true);
    try {
      await api.post('/messages', {
        content: text,
        channel: 'WHATSAPP',
        contactId,
        leadId: leadId || undefined,
        type: 'TEXT',
        direction: 'OUTBOUND',
      });
      setReply('');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a enviar');
    } finally { setSending(false); }
  };

  const openFullChat = () => {
    const q = leadId ? `leadId=${leadId}` : `contactId=${contactId}`;
    navigate(`/inbox?${q}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="card flex flex-col w-full"
        style={{ maxWidth: 480, maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {contactName || 'Conversa'}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Pré-visualização das últimas mensagens
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={openFullChat}
              className="p-1.5 rounded hover:bg-black/5 flex items-center gap-1 text-xs"
              style={{ color: 'var(--primary)' }}
              title="Abrir conversa completa"
            >
              <ExternalLink size={13} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-black/5">
              <X size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: 'var(--surface-2)' }}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Sem mensagens nesta conversa.</p>
          ) : (
            messages.map((m) => {
              const out = m.direction === 'OUTBOUND';
              if (m.isInternal) {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="max-w-[80%] px-2 py-1 rounded text-[11px]"
                      style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', color: '#92400E' }}>
                      <span className="font-medium">Nota: </span>{m.content}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[80%] px-3 py-1.5 rounded-lg text-sm whitespace-pre-wrap"
                    style={{
                      background: out ? 'var(--primary)' : 'var(--surface)',
                      color: out ? '#fff' : 'var(--text-primary)',
                      border: out ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {m.content || (m.type === 'AUDIO' ? (m.transcription || '[áudio]') : `[${m.type.toLowerCase()}]`)}
                    <div className="text-[10px] mt-0.5 text-right" style={{ color: out ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                      {fmtTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {contactId && (
          <div className="px-3 py-2 border-t flex gap-2" style={{ borderColor: 'var(--border)' }}>
            <input
              className="input-base flex-1 text-sm"
              placeholder="Resposta rápida..."
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendQuickReply(); } }}
              disabled={sending}
            />
            <button
              className="btn btn-primary px-3"
              onClick={sendQuickReply}
              disabled={sending || !reply.trim()}
              title="Enviar (Enter)"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
