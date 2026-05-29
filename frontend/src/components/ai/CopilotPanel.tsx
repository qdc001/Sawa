import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, X, Sparkles, FileText, MessageSquare, Lightbulb } from 'lucide-react';
import api from '../../lib/api';

interface Message { role: 'user' | 'assistant'; content: string; }

interface CopilotPanelProps { leadId?: string; onClose: () => void; }

const QUICK_ACTIONS = [
  { label: 'Resumir lead', icon: <FileText size={13} />, prompt: 'Faz um resumo deste lead' },
  { label: 'Sugerir resposta', icon: <MessageSquare size={13} />, prompt: 'Sugere 3 respostas para a última mensagem' },
  { label: 'Próxima acção', icon: <Lightbulb size={13} />, prompt: 'Qual é a próxima melhor acção para este lead?' },
  { label: 'Preencher campos', icon: <Sparkles size={13} />, prompt: 'Que campos posso preencher com base na conversa?' },
];

export default function CopilotPanel({ leadId, onClose }: CopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou o Copilot, o teu assistente IA. Posso resumir leads, sugerir respostas, analisar conversas e muito mais. Como posso ajudar?' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: msg };
    setMessages((p) => [...p, userMsg]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post('/ai/chat', { message: msg, history, leadId });
      setMessages((p) => [...p, { role: 'assistant', content: data.reply }]);
    } catch {
      // Demo mode
      const demoReplies: Record<string, string> = {
        'resumo': '📋 **Resumo do Lead**\n\nEste lead está na etapa "Proposta Enviada" com valor estimado de MZN 150,000. O contacto é João Silva da empresa TechCorp. A última interação foi há 2 dias via WhatsApp. Há 1 tarefa pendente de follow-up.\n\n**Próxima acção recomendada:** Ligar para confirmar se recebeu a proposta e responder dúvidas.',
        'default': 'Entendi! Com base nos dados do workspace, posso ajudar-te a analisar leads, sugerir mensagens, criar resumos e muito mais. O que precisas especificamente?',
      };
      const key = msg.toLowerCase().includes('resum') ? 'resumo' : 'default';
      setMessages((p) => [...p, { role: 'assistant', content: demoReplies[key] }]);
    } finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary)' }}>
          <Bot size={16} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Copilot IA</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Assistente inteligente</p>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5 p-3 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {QUICK_ACTIONS.map((qa) => (
          <button key={qa.label} onClick={() => sendMessage(qa.prompt)} disabled={loading}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            {qa.icon} {qa.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: 'var(--surface-2)' }}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--primary)', marginTop: 2 }}>
                <Bot size={13} className="text-white" />
              </div>
            )}
            <div className="max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed"
              style={{
                background: msg.role === 'user' ? 'var(--primary)' : 'var(--surface)',
                color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                boxShadow: 'var(--shadow-sm)',
                whiteSpace: 'pre-wrap',
              }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--primary)' }}>
              <Bot size={13} className="text-white" />
            </div>
            <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)', opacity: 0.5, animation: `pulse-dot 1s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="flex items-end gap-2 rounded-xl p-2.5" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <textarea
            className="flex-1 text-sm resize-none outline-none"
            style={{ background: 'transparent', color: 'var(--text-primary)', maxHeight: 80 }}
            placeholder="Perguntar ao Copilot..."
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          />
          <button onClick={() => sendMessage()} disabled={!input.trim() || loading}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: input.trim() && !loading ? 'var(--primary)' : 'var(--surface-3)', transition: '.15s' }}>
            {loading ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : <Send size={14} style={{ color: input.trim() ? 'white' : 'var(--text-muted)' }} />}
          </button>
        </div>
      </div>
    </div>
  );
}
