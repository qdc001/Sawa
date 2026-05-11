import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Send, Paperclip, Phone, MoreVertical, Mail, MessageSquare,
  MessageCircle, Loader2, ExternalLink, X, GitBranch, RefreshCw, Check, CheckCheck,
  Inbox, Building2, User as UserIcon, Star, Archive, Edit3, Trash2,
  Reply, Sparkles, FileText, Plus, Lock, Zap, Wand2, ThumbsUp, PanelRightOpen, PanelRightClose, Mic, Eye, EyeOff, CheckSquare, Calendar,
} from 'lucide-react';
import api, {
  Message, Conversation, Lead, Pipeline, Contact, MessageTemplate as MessageTemplateType,
  ConversationMeta, User, Tag as TagType,
} from '../lib/api';
import toast from 'react-hot-toast';
import { useAuthStore, useUIStore } from '../store';
import { getSocket } from '../lib/socket';
import { AddLeadModal } from './PipelinePage';

const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp', EMAIL: 'Email', INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook', TELEGRAM: 'Telegram', WEBCHAT: 'Webchat',
  SMS: 'SMS', INTERNAL: 'Interno',
};
const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#25D366', EMAIL: '#6366F1', INSTAGRAM: '#E1306C',
  FACEBOOK: '#1877F2', TELEGRAM: '#0088CC', WEBCHAT: '#0EA5E9',
  SMS: '#F59E0B', INTERNAL: '#94A3B8',
};

function priorityColor(p: string): string {
  const c: Record<string, string> = { LOW: '#94A3B8', NORMAL: '#3B82F6', HIGH: '#F59E0B', URGENT: '#EF4444' };
  return c[p] || '#94A3B8';
}
function priorityLabel(p: string): string {
  const c: Record<string, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };
  return c[p] || p;
}

function ChannelBadge({ channel, size = 12 }: { channel: string; size?: number }) {
  const color = CHANNEL_COLORS[channel] || '#94A3B8';
  if (channel === 'EMAIL') return <Mail size={size} style={{ color }} />;
  if (channel === 'WEBCHAT') return <MessageSquare size={size} style={{ color }} />;
  return (
    <span className="inline-flex items-center justify-center text-white font-bold rounded-full"
      style={{ background: color, fontSize: size - 4, width: size + 2, height: size + 2 }}>
      {channel[0]}
    </span>
  );
}

function timeShort(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - dDay.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return d.toLocaleDateString('pt-PT', { weekday: 'short' });
  return d.toLocaleDateString('pt-PT');
}

function fullName(c: Conversation['contact']) {
  if (!c) return 'Sem contacto';
  return `${c.firstName} ${c.lastName || ''}`.trim();
}

// localStorage helpers
const SNIPPET_KEY = 'kommo:inbox-snippets';

interface Snippet { key: string; value: string; }
function loadSnippets(): Snippet[] {
  try { const r = localStorage.getItem(SNIPPET_KEY); if (r) return JSON.parse(r); } catch {}
  return [];
}

// =============== Modal: Nova mensagem manual ===============
function NewMessageModal({ contacts, onClose, onCreated }: {
  contacts: Contact[]; onClose: () => void; onCreated: (m: Message) => void;
}) {
  const [contactId, setContactId] = useState('');
  const [channel, setChannel] = useState('WHATSAPP');
  const [content, setContent] = useState('');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId || !content.trim()) { toast.error('Contacto e conteudo obrigatorios'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/messages', { content, channel, contactId, direction });
      toast.success('Mensagem registada');
      onCreated(data);
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Nova mensagem</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="input-base" required>
            <option value="">— Escolher contacto —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName || ''} {c.phone ? `· ${c.phone}` : ''}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-base">
              {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value as any)} className="input-base">
              <option value="OUTBOUND">Enviada</option>
              <option value="INBOUND">Recebida</option>
            </select>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} className="input-base" rows={4} required placeholder="Conteudo da mensagem" />
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Registar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============== Modal: Templates ===============
function TemplatesModal({
  templates, onSelect, onClose, onChanged, channel,
}: {
  templates: MessageTemplateType[];
  onSelect: (content: string) => void;
  onClose: () => void;
  onChanged: () => void;
  channel: string;
}) {
  const [editing, setEditing] = useState<MessageTemplateType | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const handleDelete = async (t: MessageTemplateType) => {
    if (!confirm(`Eliminar template "${t.name}"?`)) return;
    try { await api.delete(`/templates/${t.id}`); toast.success('Eliminado'); onChanged(); }
    catch { toast.error('Erro'); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><FileText size={16} /> Templates</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        {showEditor ? (
          <TemplateEditor
            template={editing}
            channel={channel}
            onCancel={() => { setShowEditor(false); setEditing(null); }}
            onSaved={() => { setShowEditor(false); setEditing(null); onChanged(); }}
          />
        ) : (
          <>
            {templates.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem templates ainda</p>
            ) : (
              <div className="space-y-2 mb-4">
                {templates.map((t) => (
                  <div key={t.id} className="p-3 rounded" style={{ background: 'var(--surface-2)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{CHANNEL_LABELS[t.channel]} · {t.category}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => onSelect(t.content)} className="btn btn-primary py-1 px-2 text-xs">Usar</button>
                        <button onClick={() => { setEditing(t); setShowEditor(true); }} className="p-1.5 rounded hover:bg-slate-100">
                          <Edit3 size={12} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50">
                          <Trash2 size={12} style={{ color: '#EF4444' }} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs whitespace-pre-wrap line-clamp-3" style={{ color: 'var(--text-secondary)' }}>{t.content}</p>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => { setEditing(null); setShowEditor(true); }} className="btn w-full py-2" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              <Plus size={14} /> Novo template
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateEditor({ template, channel, onCancel, onSaved }: {
  template: MessageTemplateType | null;
  channel: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name || '');
  const [content, setContent] = useState(template?.content || '');
  const [tplChannel, setTplChannel] = useState(template?.channel || channel);
  const [category, setCategory] = useState(template?.category || 'SERVICE');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) { toast.error('Nome e conteudo obrigatorios'); return; }
    setLoading(true);
    try {
      if (template) {
        await api.patch(`/templates/${template.id}`, { name, content, channel: tplChannel, category });
        toast.success('Actualizado');
      } else {
        await api.post('/templates', { name, content, channel: tplChannel, category });
        toast.success('Criado');
      }
      onSaved();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do template" className="input-base" />
      <div className="grid grid-cols-2 gap-2">
        <select value={tplChannel} onChange={(e) => setTplChannel(e.target.value)} className="input-base">
          {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="input-base">
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilitario</option>
          <option value="AUTHENTICATION">Autenticacao</option>
          <option value="SERVICE">Servico</option>
        </select>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} className="input-base" rows={6} placeholder="Conteudo do template (podes usar {{nome}}, {{empresa}}, etc.)" />
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
        <button onClick={handleSave} disabled={loading} className="btn btn-primary flex-1 py-2">
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

// =============== Modal: Snippets ===============
function SnippetsModal({ snippets, onChange, onClose }: {
  snippets: Snippet[]; onChange: (s: Snippet[]) => void; onClose: () => void;
}) {
  const [list, setList] = useState<Snippet[]>(snippets);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    const k = newKey.trim().replace(/^\//, '');
    if (!k || !newValue.trim()) { toast.error('Atalho e texto obrigatorios'); return; }
    const next = [...list.filter((s) => s.key !== k), { key: k, value: newValue.trim() }];
    setList(next); onChange(next);
    setNewKey(''); setNewValue('');
  };

  const handleDelete = (key: string) => {
    const next = list.filter((s) => s.key !== key);
    setList(next); onChange(next);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><Zap size={16} /> Snippets pessoais</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Escreves <code className="px-1 rounded" style={{ background: 'var(--surface-3)' }}>/atalho</code> seguido de espaco no input para expandir automaticamente.
        </p>
        {list.length === 0 ? (
          <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>Sem snippets ainda</p>
        ) : (
          <div className="space-y-2 mb-4">
            {list.map((s) => (
              <div key={s.key} className="p-2 rounded flex items-start gap-2" style={{ background: 'var(--surface-2)' }}>
                <code className="px-2 py-1 rounded text-xs flex-shrink-0 font-medium" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>/{s.key}</code>
                <p className="text-xs flex-1 whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
                <button onClick={() => handleDelete(s.key)} className="p-1 rounded hover:bg-red-50 flex-shrink-0">
                  <Trash2 size={12} style={{ color: '#EF4444' }} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium">Novo snippet</p>
          <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="atalho (ex: ola)" className="input-base" />
          <textarea value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Texto que sera inserido" className="input-base" rows={3} />
          <button onClick={handleAdd} className="btn btn-primary w-full py-2"><Plus size={14} /> Adicionar</button>
        </div>
      </div>
    </div>
  );
}

// =============== Pagina principal ===============
export default function InboxPage() {
  const navigate = useNavigate();
  const { globalSearchQuery, setGlobalSearchQuery } = useUIStore();
  const { user, workspace } = useAuthStore();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [search, setSearch] = useState(globalSearchQuery || '');
  const [channelFilter, setChannelFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [combineByContact, setCombineByContact] = useState(false);
  const [folderFilter, setFolderFilter] = useState<'all' | 'fav' | 'archive' | 'mine'>('all');

  // Pesquisa local na conversa
  const [convSearch, setConvSearch] = useState('');
  const [showConvSearch, setShowConvSearch] = useState(false);
  const [showContactPanel, setShowContactPanel] = useState<boolean>(() => {
    return localStorage.getItem('kommo:contactPanel') === 'true'; // por defeito retraído
  });
  useEffect(() => { localStorage.setItem('kommo:contactPanel', String(showContactPanel)); }, [showContactPanel]);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);

  // Composer
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [attachment, setAttachment] = useState<{ url: string; name: string; mimeType: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gravador de audio
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  // Read receipts toggle (persistido em localStorage)
  const [readReceipts, setReadReceipts] = useState<boolean>(() => {
    return localStorage.getItem('kommo:readReceipts') === 'true';
  });
  useEffect(() => { localStorage.setItem('kommo:readReceipts', String(readReceipts)); }, [readReceipts]);

  // Presence: { contactId: 'composing' | 'recording' | 'available' | ... }
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  const presenceTimeoutsRef = useRef<Record<string, any>>({});

  // Refs para uso dentro de socket callbacks (evita TDZ)
  const selectedRef = useRef<any>(null);
  const readReceiptsRef = useRef<boolean>(false);

  // Lightbox para visualizar imagens em grande
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Som de notificação ao receber mensagem
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => localStorage.getItem('kommo:soundOn') !== 'false');
  useEffect(() => { localStorage.setItem('kommo:soundOn', String(soundEnabled)); }, [soundEnabled]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      if (!audioElRef.current) {
        // tom curto: oscilator via AudioContext (não precisa de ficheiro)
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        o.start(); o.stop(ctx.currentTime + 0.35);
        setTimeout(() => ctx.close(), 500);
      }
    } catch {}
  };

  // Mini modal nova tarefa
  const [newTaskFor, setNewTaskFor] = useState<{ leadId?: string | null; contactId?: string | null; contactName: string } | null>(null);

  // Pesquisa avançada
  const [showAdvSearch, setShowAdvSearch] = useState(false);
  const [advSearchType, setAdvSearchType] = useState<string>('');
  const [advSearchFrom, setAdvSearchFrom] = useState<string>('');
  const [advSearchTo, setAdvSearchTo] = useState<string>('');

  // Socket listeners para presence e chamadas
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    if (workspace?.id) socket.emit('join:workspace', workspace.id);

    const onPresence = (data: { contactId: string; state: string }) => {
      setPresenceMap((prev) => ({ ...prev, [data.contactId]: data.state }));
      // limpa presence após 8s se não houver nova actualização
      if (presenceTimeoutsRef.current[data.contactId]) {
        clearTimeout(presenceTimeoutsRef.current[data.contactId]);
      }
      if (data.state === 'composing' || data.state === 'recording') {
        presenceTimeoutsRef.current[data.contactId] = setTimeout(() => {
          setPresenceMap((prev) => {
            const next = { ...prev };
            delete next[data.contactId];
            return next;
          });
        }, 8000);
      }
    };

    const onCall = (data: { contactId: string; contactName: string; phone: string; callType: string; status: string }) => {
      if (data.status === 'ringing') {
        toast((tt) => (
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 20 }}>📞</span>
            <div>
              <p className="font-semibold text-sm">{data.contactName} está a chamar</p>
              <p className="text-xs opacity-70">{data.callType === 'video' ? 'Vídeo' : 'Voz'} · atende no telefone</p>
            </div>
            <button onClick={() => toast.dismiss(tt.id)} className="ml-2 text-xs">OK</button>
          </div>
        ), { duration: 15000, icon: null });

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`${data.contactName} está a chamar`, {
            body: data.callType === 'video' ? 'Chamada de vídeo recebida' : 'Chamada de voz recebida',
          });
        }
      }
    };

    const onMessage = (msg: Message) => {
      // som para inbound novas
      if (msg.direction === 'INBOUND' && !msg.isInternal) {
        playNotificationSound();
      }
      const sel = selectedRef.current;
      const matchesSelected =
        !!sel &&
        ((sel.combined && msg.contactId === sel.contact?.id) ||
         (!sel.combined && msg.contactId === sel.contact?.id && (msg.channel === sel.channel || msg.isInternal)));
      if (matchesSelected) {
        setMessages((prev) => prev.find((x) => x.id === msg.id) ? prev : [...prev, msg]);
        if (msg.direction === 'INBOUND' && readReceiptsRef.current) {
          api.post('/messages/mark-conversation-read', {
            contactId: sel!.contact?.id, leadId: sel!.leadId, sendReceipt: true,
          }).catch(() => {});
        }
      }
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.contact?.id === msg.contactId);
        if (idx === -1) return prev;
        const updated = [...prev];
        const conv = updated[idx];
        updated[idx] = {
          ...conv,
          lastMessage: msg,
          total: conv.total + 1,
          unread: msg.direction === 'INBOUND' && (sel?.contact?.id !== msg.contactId) ? (conv.unread || 0) + 1 : conv.unread,
        };
        const [item] = updated.splice(idx, 1);
        updated.unshift(item);
        return updated;
      });
    };

    const onMessageUpdated = (msg: Message) => {
      setMessages((prev) => prev.map((m) => m.id === msg.id ? msg : m));
      setConversations((prev) => prev.map((c) => c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c));
    };

    const onConversationDeleted = (data: { contactId: string; channel: string | null }) => {
      setConversations((prev) => prev.filter((c) => {
        if (c.contact?.id !== data.contactId) return true;
        if (data.channel && c.channel !== data.channel) return true;
        return false;
      }));
      const sel = selectedRef.current;
      if (sel?.contact?.id === data.contactId) setMessages([]);
    };

    socket.on('presence:update', onPresence);
    socket.on('call:incoming', onCall);
    socket.on('message:new', onMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('conversation:deleted', onConversationDeleted);
    return () => {
      socket.off('presence:update', onPresence);
      socket.off('call:incoming', onCall);
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('conversation:deleted', onConversationDeleted);
    };
  }, [workspace?.id]);

  // Modais
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);

  // Dados auxiliares
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<MessageTemplateType[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [users, setUsers] = useState<User[]>([]);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [metas, setMetas] = useState<Record<string, ConversationMeta>>({}); // key contactId:channel

  const metaKey = (contactId: string, channel: string | null) => `${contactId}:${channel || 'all'}`;
  const getMeta = (conv: Conversation): ConversationMeta | undefined => {
    if (!conv.contact) return undefined;
    const ch = conv.combined ? null : conv.channel;
    return metas[metaKey(conv.contact.id, ch)];
  };

  const loadMetas = () => {
    api.get('/messages/meta').then(({ data }) => {
      const map: Record<string, ConversationMeta> = {};
      (Array.isArray(data) ? data : []).forEach((m: ConversationMeta) => {
        map[metaKey(m.contactId, m.channel)] = m;
      });
      setMetas(map);
    }).catch(() => {});
  };

  const upsertMeta = async (conv: Conversation, patch: Partial<ConversationMeta> & { tagIds?: string[] }) => {
    if (!conv.contact) return;
    try {
      const { data } = await api.post('/messages/meta', {
        contactId: conv.contact.id,
        channel: conv.combined ? 'all' : conv.channel,
        ...patch,
      });
      setMetas((p) => ({ ...p, [metaKey(conv.contact!.id, conv.combined ? null : conv.channel)]: data }));
    } catch {
      toast.error('Erro a guardar');
    }
  };

  // IA
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setSearch(globalSearchQuery || ''), [globalSearchQuery]);

  const loadConversations = () => {
    const params = new URLSearchParams();
    if (channelFilter) params.set('channel', channelFilter);
    if (search.trim()) params.set('search', search.trim());
    if (unreadOnly) params.set('unreadOnly', 'true');
    if (combineByContact) params.set('combineByContact', 'true');
    setLoadingConvs(true);
    api.get(`/messages/conversations?${params.toString()}`)
      .then(({ data }) => setConversations(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Erro a carregar conversas'))
      .finally(() => setLoadingConvs(false));
  };

  useEffect(() => { loadConversations(); /* eslint-disable-next-line */ }, [channelFilter, search, unreadOnly, combineByContact]);

  useEffect(() => {
    api.get('/contacts?limit=500').then(({ data }) => setContacts(data.contacts || [])).catch(() => {});
    api.get('/pipelines').then(({ data }) => setPipelines(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/tags').then(({ data }) => setAllTags(Array.isArray(data) ? data : [])).catch(() => {});
    loadTemplates();
    loadMetas();
  }, []);

  const loadTemplates = () => {
    api.get('/templates').then(({ data }) => setTemplates(Array.isArray(data) ? data : [])).catch(() => {});
  };

  // Aplicar filtro de pasta (favoritas/arquivadas/atribuidas)
  const visibleConversations = useMemo(() => {
    let arr = conversations;
    if (folderFilter === 'fav') arr = arr.filter((c) => getMeta(c)?.isPinned);
    else if (folderFilter === 'archive') arr = arr.filter((c) => getMeta(c)?.isArchived);
    else if (folderFilter === 'mine') arr = arr.filter((c) => getMeta(c)?.assignedToId === user?.id);
    else arr = arr.filter((c) => !getMeta(c)?.isArchived);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, folderFilter, metas, user]);

  const selected = useMemo(() => conversations.find((c) => c.key === selectedKey), [conversations, selectedKey]);

  // Sincroniza refs (usados em socket callbacks)
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { readReceiptsRef.current = readReceipts; }, [readReceipts]);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    setLoadingMsgs(true);
    setReplyTo(null);
    setEditingMessage(null);
    setAiSummary(''); setAiSuggestions([]);

    const params = new URLSearchParams();
    if (selected.contact?.id) params.set('contactId', selected.contact.id);
    else if (selected.leadId) params.set('leadId', selected.leadId);

    api.get(`/messages?${params.toString()}`)
      .then(({ data }) => {
        let msgs: Message[] = Array.isArray(data) ? data : [];
        // Quando combinado por contacto, filtrar pelo contactId mas todos os canais
        // Quando nao combinado, filtrar tambem pelo canal
        if (!selected.combined) msgs = msgs.filter((m) => m.channel === selected.channel || m.isInternal);
        setMessages(msgs);
        if (selected.unread > 0) {
          api.post('/messages/mark-conversation-read', {
            contactId: selected.contact?.id, leadId: selected.leadId,
            sendReceipt: readReceipts, // só envia ticks azuis ao remetente se toggle estiver ON
          }).then(() => {
            setConversations((prev) => prev.map((c) => c.key === selected.key ? { ...c, unread: 0 } : c));
          }).catch(() => {});
        }
      })
      .catch(() => toast.error('Erro a carregar mensagens'))
      .finally(() => setLoadingMsgs(false));
  }, [selectedKey]); // eslint-disable-line

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!selectedKey && visibleConversations.length > 0) setSelectedKey(visibleConversations[0].key);
  }, [visibleConversations, selectedKey]);

  // Snippet expansion: quando draft termina com /xxx <espaco>, expande
  // Envio de presence (composing/recording/paused) com debounce
  const presenceDebounceRef = useRef<any>(null);
  const lastPresenceSentRef = useRef<{ state: string; at: number } | null>(null);
  const sendPresence = (state: 'composing' | 'recording' | 'paused') => {
    const phone = selected?.contact?.whatsapp || selected?.contact?.phone;
    if (!phone || isInternalNote) return;
    // throttle: só envia se mudou ou se passaram > 4s
    const last = lastPresenceSentRef.current;
    if (last && last.state === state && Date.now() - last.at < 4000) return;
    lastPresenceSentRef.current = { state, at: Date.now() };
    api.post('/integrations/evolution/presence', { phone, presence: state }).catch(() => {});
  };

  const handleExport = async (format: 'txt' | 'json') => {
    if (!selected?.contact?.id) return;
    const apiBase = (import.meta.env as any).VITE_API_URL || '';
    const token = localStorage.getItem('kommo:token') || '';
    const url = `${apiBase}/api/messages/export?contactId=${selected.contact.id}${selected.channel ? `&channel=${selected.channel}` : ''}&format=${format}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Erro a exportar');
      const blob = await res.blob();
      const link = document.createElement('a');
      const dlUrl = URL.createObjectURL(blob);
      link.href = dlUrl;
      link.download = `conversa_${selected.contact.firstName || 'contacto'}_${Date.now()}.${format}`;
      document.body.appendChild(link); link.click();
      document.body.removeChild(link); URL.revokeObjectURL(dlUrl);
      toast.success('Exportação concluída');
    } catch (e: any) { toast.error(e.message || 'Erro a exportar'); }
  };

  const handleDeleteConversation = async () => {
    if (!selected?.contact?.id) return;
    if (!confirm(`Eliminar todas as mensagens da conversa com ${selected.contact.firstName}? Esta acção não pode ser desfeita.`)) return;
    try {
      const res = await api.delete('/messages/conversation', {
        data: { contactId: selected.contact.id, channel: selected.combined ? 'all' : selected.channel },
      });
      toast.success(`${res.data.deleted} mensagens eliminadas`);
      setMessages([]);
      setSelectedKey(null);
      loadConversations();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro a eliminar'); }
  };

  const handleSetPriority = async (priority: string) => {
    if (!selected?.contact?.id) return;
    try {
      await api.post('/messages/meta', {
        contactId: selected.contact.id,
        channel: selected.combined ? 'all' : selected.channel,
        priority,
      });
      toast.success(`Prioridade: ${priorityLabel(priority)}`);
      loadConversations();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro'); }
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    // detect /shortcut + space
    const match = val.match(/\/(\w+)\s$/);
    if (match) {
      const sn = snippets.find((s) => s.key === match[1]);
      if (sn) {
        const replaced = val.replace(/\/\w+\s$/, sn.value + ' ');
        setDraft(replaced);
      }
    }
    // Enviar presence "composing" + agendar "paused" após 3s sem actualizações
    if (val.trim()) {
      sendPresence('composing');
      if (presenceDebounceRef.current) clearTimeout(presenceDebounceRef.current);
      presenceDebounceRef.current = setTimeout(() => sendPresence('paused'), 3000);
    }
  };

  const sendMessage = async () => {
    if ((!draft.trim() && !attachment) || !selected) return;
    setSending(true);
    try {
      const apiBase = (import.meta.env as any).VITE_API_URL || '';
      const { data } = await api.post('/messages', {
        content: draft.trim() || attachment?.name || 'Anexo',
        channel: isInternalNote ? 'INTERNAL' : selected.channel,
        contactId: selected.contact?.id,
        leadId: selected.leadId,
        replyToId: replyTo?.id,
        isInternal: isInternalNote,
        type: attachment ? (attachment.mimeType.startsWith('image/') ? 'IMAGE' : attachment.mimeType.startsWith('video/') ? 'VIDEO' : attachment.mimeType.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT') : 'TEXT',
        mediaUrl: attachment ? `${apiBase}${attachment.url}` : undefined,
        mediaType: attachment?.mimeType,
      });
      setMessages((p) => p.find((x) => x.id === data.id) ? p : [...p, data]);
      setDraft(''); setReplyTo(null); setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!isInternalNote) {
        setConversations((prev) => prev.map((c) => c.key === selected.key ? { ...c, lastMessage: data, total: c.total + 1 } : c));
      }
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro a enviar'); } finally { setSending(false); }
  };

  // Gravação de áudio
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Preferir ogg/opus (WhatsApp aceita nativamente sem conversão), depois webm/opus, m4a, fallback
      const mimeType =
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const finalMime = mr.mimeType || mimeType || 'audio/ogg';
        const blob = new Blob(audioChunksRef.current, { type: finalMime });
        const ext = finalMime.includes('ogg') ? 'ogg' : finalMime.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: finalMime });
        await uploadAudio(file);
      };
      mr.start();
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
        sendPresence('recording'); // renovar presence a cada 1s
      }, 1000);
      sendPresence('recording');
    } catch (err: any) {
      toast.error('Sem permissão para microfone. Activa nas definições do browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      sendPresence('paused');
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && recording) {
      audioChunksRef.current = []; // descartar
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
      setRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      sendPresence('paused');
    }
  };

  const uploadAudio = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachment({ url: data.url, name: data.name, mimeType: data.mimeType, size: data.size });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a carregar áudio');
    } finally { setUploading(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Ficheiro maior que 25 MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachment({ url: data.url, name: data.name, mimeType: data.mimeType, size: data.size });
      toast.success('Ficheiro carregado');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a carregar ficheiro');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (m: Message) => { setEditingMessage(m); setEditingContent(m.content); };
  const saveEdit = async () => {
    if (!editingMessage || !editingContent.trim()) return;
    try {
      const { data } = await api.patch(`/messages/${editingMessage.id}`, { content: editingContent.trim() });
      setMessages((p) => p.map((m) => m.id === data.id ? data : m));
      setEditingMessage(null);
      toast.success('Editada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const deleteMessage = async (m: Message) => {
    if (!confirm('Eliminar esta mensagem?')) return;
    try {
      await api.delete(`/messages/${m.id}`);
      setMessages((p) => p.filter((x) => x.id !== m.id));
      toast.success('Eliminada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const toggleFavorite = async (conv: Conversation) => {
    const meta = getMeta(conv);
    await upsertMeta(conv, { isPinned: !meta?.isPinned });
  };

  const toggleArchive = async (conv: Conversation) => {
    const meta = getMeta(conv);
    await upsertMeta(conv, { isArchived: !meta?.isArchived });
    if (!meta?.isArchived && selectedKey === conv.key) setSelectedKey(null);
  };

  const assignTo = async (conv: Conversation, userId: string | null) => {
    await upsertMeta(conv, { assignedToId: userId });
  };

  const toggleTag = async (conv: Conversation, tagId: string) => {
    const meta = getMeta(conv);
    const current = meta?.tags?.map((t) => t.tag.id) || [];
    const next = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    await upsertMeta(conv, { tagIds: next });
  };

  const handleAISummary = async () => {
    if (!selected?.contact?.id && !selected?.leadId) return;
    setAiLoading(true);
    try {
      const { data } = await api.post('/ai/summarize-conversation', {
        contactId: selected.contact?.id, leadId: selected.leadId,
      });
      setAiSummary(data.summary || '');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro IA. Configura ANTHROPIC_API_KEY no backend.');
    } finally { setAiLoading(false); }
  };

  const handleAISuggest = async () => {
    if (!selected?.leadId) { toast.error('Esta conversa nao esta ligada a um lead'); return; }
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'INBOUND');
    if (!lastInbound) { toast.error('Sem mensagem do cliente para responder'); return; }
    setAiLoading(true);
    try {
      const { data } = await api.post('/ai/suggest-reply', {
        leadId: selected.leadId, lastMessage: lastInbound.content,
      });
      setAiSuggestions(data.suggestions || []);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro IA. Configura ANTHROPIC_API_KEY.');
    } finally { setAiLoading(false); }
  };

  const handleAIImprove = async () => {
    if (!draft.trim()) return;
    setAiLoading(true);
    try {
      const { data } = await api.post('/ai/improve-text', { text: draft, action: 'improve' });
      setDraft(data.result || draft);
      toast.success('Texto melhorado');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro IA'); } finally { setAiLoading(false); }
  };

  const handleCreateLeadFromConv = () => {
    if (!selected) return;
    if (pipelines.length === 0) { toast.error('Sem pipelines'); return; }
    setCreatingLead(true);
  };

  const handleCsatRequest = async () => {
    if (!selected?.contact?.id) { toast.error('Conversa sem contacto associado'); return; }
    try {
      const { data } = await api.post('/csat', {
        contactId: selected.contact.id,
        leadId: selected.leadId,
      });
      const link = `${window.location.origin}/csat/${data.token}`;
      try {
        await navigator.clipboard.writeText(link);
        toast.success('Link copiado para a clipboard! Envia ao cliente.');
      } catch {
        toast.success(`Link: ${link}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro');
    }
  };

  const cleanPhone = (p?: string | null) => (p || '').replace(/[^0-9+]/g, '');

  const totalUnread = conversations.reduce((a, b) => a + b.unread, 0);
  const defaultPipeline = pipelines.find((p) => p.isDefault) || pipelines[0];
  const defaultStage = defaultPipeline?.stages?.[0];

  // Tempo medio de resposta (em minutos) para a conversa actual
  const avgResponseMin = useMemo(() => {
    if (!messages.length) return null;
    const pairs: number[] = [];
    let lastInbound: Date | null = null;
    for (const m of messages) {
      if (m.isInternal) continue;
      if (m.direction === 'INBOUND') lastInbound = new Date(m.createdAt);
      else if (m.direction === 'OUTBOUND' && lastInbound) {
        const diff = (new Date(m.createdAt).getTime() - lastInbound.getTime()) / 60000;
        if (diff > 0 && diff < 60 * 24 * 7) pairs.push(diff);
        lastInbound = null;
      }
    }
    if (!pairs.length) return null;
    return Math.round(pairs.reduce((a, b) => a + b, 0) / pairs.length);
  }, [messages]);

  // Pesquisa local nas mensagens
  const filteredMessages = useMemo(() => {
    let list = messages;
    if (advSearchType) list = list.filter((m) => m.type === advSearchType);
    if (advSearchFrom) {
      const from = new Date(advSearchFrom).getTime();
      list = list.filter((m) => new Date(m.createdAt).getTime() >= from);
    }
    if (advSearchTo) {
      const to = new Date(advSearchTo).getTime() + 86400000; // fim do dia
      list = list.filter((m) => new Date(m.createdAt).getTime() <= to);
    }
    if (convSearch.trim()) {
      const q = convSearch.toLowerCase();
      list = list.filter((m) => m.content?.toLowerCase().includes(q));
    }
    return list;
  }, [messages, convSearch, advSearchType, advSearchFrom, advSearchTo]);

  return (
    <div className="flex h-full" style={{ background: 'var(--surface)' }}>
      {/* Sidebar */}
      <div className="w-80 flex flex-col flex-shrink-0" style={{ borderRight: '1px solid var(--border)' }}>
        <div className="p-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-base flex items-center gap-2"><Inbox size={16} style={{ color: 'var(--primary)' }} />Caixa de Entrada</h2>
            <div className="flex gap-1">
              <button onClick={loadConversations} className="p-1.5 rounded hover:bg-slate-100" title="Recarregar">
                <RefreshCw size={14} style={{ color: 'var(--text-muted)' }} />
              </button>
              <button onClick={() => setNewMessageOpen(true)} className="p-1.5 rounded hover:bg-slate-100" title="Nova mensagem manual">
                <MessageCircle size={14} style={{ color: 'var(--primary)' }} />
              </button>
            </div>
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {visibleConversations.length} conversas
            {totalUnread > 0 && <span className="ml-2 font-medium" style={{ color: 'var(--primary)' }}>· {totalUnread} nao lidas</span>}
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input className="input-base text-sm" style={{ paddingLeft: 32 }} placeholder="Pesquisar..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {/* Folders */}
          <div className="flex gap-1 mb-2 flex-wrap">
            {([
              { v: 'all', label: 'Activas' },
              { v: 'mine', label: 'Minhas' },
              { v: 'fav', label: 'Favoritas' },
              { v: 'archive', label: 'Arquivadas' },
            ] as const).map((f) => (
              <button key={f.v} onClick={() => setFolderFilter(f.v)} className="text-xs px-2 py-1 rounded font-medium flex-1"
                style={{ background: folderFilter === f.v ? 'var(--primary)' : 'var(--surface-3)', color: folderFilter === f.v ? '#fff' : 'var(--text-secondary)' }}>
                {f.label}
              </button>
            ))}
          </div>
          {/* Channel filters */}
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setChannelFilter('')} className="text-xs px-2 py-1 rounded font-medium"
              style={{ background: channelFilter === '' ? 'var(--primary)' : 'var(--surface-3)', color: channelFilter === '' ? '#fff' : 'var(--text-secondary)' }}>
              Todos
            </button>
            {(['WHATSAPP', 'EMAIL', 'INSTAGRAM'] as const).map((ch) => (
              <button key={ch} onClick={() => setChannelFilter(channelFilter === ch ? '' : ch)} className="text-xs px-2 py-1 rounded font-medium"
                style={{ background: channelFilter === ch ? CHANNEL_COLORS[ch] : 'var(--surface-3)', color: channelFilter === ch ? '#fff' : 'var(--text-secondary)' }}>
                {CHANNEL_LABELS[ch]}
              </button>
            ))}
            <button onClick={() => setUnreadOnly(!unreadOnly)} className="text-xs px-2 py-1 rounded font-medium"
              style={{ background: unreadOnly ? 'var(--primary)' : 'var(--surface-3)', color: unreadOnly ? '#fff' : 'var(--text-secondary)' }}>
              Nao lidas
            </button>
            <button onClick={() => setCombineByContact(!combineByContact)} className="text-xs px-2 py-1 rounded font-medium"
              title="Juntar todos os canais do mesmo contacto numa unica conversa"
              style={{ background: combineByContact ? 'var(--primary)' : 'var(--surface-3)', color: combineByContact ? '#fff' : 'var(--text-secondary)' }}>
              Combinar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
          ) : visibleConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <Inbox size={28} style={{ color: 'var(--text-muted)' }} />
              <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>Sem conversas</p>
            </div>
          ) : (
            visibleConversations.map((conv) => {
              const isSelected = selectedKey === conv.key;
              const meta = getMeta(conv);
              const isFav = !!meta?.isPinned;
              const isArc = !!meta?.isArchived;
              const initial = (conv.contact?.firstName?.[0] || '?').toUpperCase();
              const priority = (meta?.priority || 'NORMAL') as string;
              return (
                <div key={conv.key} className="relative group" style={{ borderLeft: `3px solid ${priority !== 'NORMAL' ? priorityColor(priority) : 'transparent'}` }}>
                  <button onClick={() => setSelectedKey(conv.key)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    style={{ background: isSelected ? 'var(--primary-light)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                    <div className="relative flex-shrink-0">
                      {conv.contact?.avatar ? (
                        <img src={conv.contact.avatar} className="w-10 h-10 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--primary)' }}>
                          {conv.contact?.type === 'COMPANY' ? <Building2 size={16} /> : initial}
                        </div>
                      )}
                      {isFav && <Star size={10} className="absolute -top-1 -right-1 fill-yellow-400" style={{ color: '#F59E0B' }} />}
                      {priority === 'URGENT' && (
                        <span className="absolute -bottom-1 -right-1 text-[8px] font-bold px-1 rounded text-white" style={{ background: '#EF4444' }}>!</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{fullName(conv.contact)}</span>
                        <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>{timeShort(conv.lastMessage.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {conv.combined && conv.channels && conv.channels.length > 1 ? (
                          <div className="flex gap-0.5">
                            {conv.channels.slice(0, 3).map((ch) => <ChannelBadge key={ch} channel={ch} size={10} />)}
                          </div>
                        ) : (
                          <ChannelBadge channel={conv.channel} />
                        )}
                        <span className="text-xs truncate" style={{ color: conv.unread > 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: conv.unread > 0 ? 500 : 400 }}>
                          {conv.lastMessage.direction === 'OUTBOUND' && (
                            <span className="mr-1 font-medium" style={{ color: 'var(--primary)' }}>
                              {conv.lastMessage.sentBy
                                ? (conv.lastMessage.sentBy.id === user?.id ? 'Você' : conv.lastMessage.sentBy.name.split(' ')[0])
                                : 'Sistema'}:
                            </span>
                          )}
                          {conv.lastMessage.content?.slice(0, 50)}
                        </span>
                        {conv.unread > 0 && (
                          <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full text-white flex-shrink-0 font-medium" style={{ background: 'var(--primary)', fontSize: 10 }}>
                            {conv.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  {/* Tags da conversa (sempre visiveis) */}
                  {meta?.tags && meta.tags.length > 0 && (
                    <div className="absolute left-14 bottom-1 flex gap-0.5 pointer-events-none">
                      {meta.tags.slice(0, 3).map((t) => (
                        <span key={t.tag.id} className="w-2 h-2 rounded-full" style={{ background: t.tag.color }} title={t.tag.name} />
                      ))}
                    </div>
                  )}
                  {/* Acções rápidas no hover */}
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); toggleFavorite(conv); }}
                      className="p-1 rounded bg-white shadow-sm" title={isFav ? 'Remover dos favoritos' : 'Marcar como favorito'}>
                      <Star size={12} style={{ color: isFav ? '#F59E0B' : 'var(--text-muted)' }} fill={isFav ? '#F59E0B' : 'none'} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleArchive(conv); }}
                      className="p-1 rounded bg-white shadow-sm" title={isArc ? 'Restaurar' : 'Arquivar'}>
                      <Archive size={12} style={{ color: isArc ? 'var(--primary)' : 'var(--text-muted)' }} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center" style={{ background: 'var(--surface-2)' }}>
            <Inbox size={40} style={{ color: 'var(--text-muted)' }} />
            <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>Selecciona uma conversa</p>
          </div>
        ) : (
          <>
            {/* Header chat */}
            <div className="flex items-center justify-between px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: 'var(--primary)' }}>
                  {selected.contact?.avatar ? (
                    <img src={selected.contact.avatar} className="w-10 h-10 rounded-full object-cover" alt="" />
                  ) : selected.contact?.type === 'COMPANY' ? <Building2 size={16} /> : (selected.contact?.firstName?.[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{fullName(selected.contact)}</p>
                  <div className="flex items-center gap-1.5">
                    {selected.combined && selected.channels && selected.channels.length > 1 ? (
                      <div className="flex gap-0.5">
                        {selected.channels.map((ch) => <ChannelBadge key={ch} channel={ch} />)}
                      </div>
                    ) : (
                      <ChannelBadge channel={selected.channel} />
                    )}
                    {selected.contact?.id && presenceMap[selected.contact.id] === 'composing' ? (
                      <span className="text-xs font-medium" style={{ color: 'var(--primary)' }}>a escrever...</span>
                    ) : selected.contact?.id && presenceMap[selected.contact.id] === 'recording' ? (
                      <span className="text-xs font-medium" style={{ color: '#10B981' }}>a gravar áudio...</span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {selected.combined ? 'Multi-canal' : CHANNEL_LABELS[selected.channel]}
                        {selected.contact?.phone && ` · ${selected.contact.phone}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0 relative">
                <button
                  onClick={() => setReadReceipts(!readReceipts)}
                  className="p-1.5 rounded-lg hover:bg-slate-100"
                  title={readReceipts ? 'Confirmação de leitura ACTIVA' : 'Confirmação de leitura DESACTIVADA'}
                >
                  {readReceipts
                    ? <Eye size={15} style={{ color: '#3B82F6' }} />
                    : <EyeOff size={15} style={{ color: 'var(--text-muted)' }} />}
                </button>
                <button onClick={handleCreateLeadFromConv} className="btn btn-primary text-xs py-1.5 px-2.5 ml-1" disabled={!defaultStage} title="Criar Lead a partir desta conversa">
                  <GitBranch size={12} /> <span className="hidden xl:inline">Criar Lead</span>
                </button>
                <button onClick={() => setShowContactPanel(!showContactPanel)} className="p-1.5 rounded-lg hover:bg-slate-100 ml-1" title={showContactPanel ? 'Fechar painel do contacto' : 'Abrir painel do contacto'}>
                  {showContactPanel ? <PanelRightClose size={16} style={{ color: 'var(--text-secondary)' }} /> : <PanelRightOpen size={16} style={{ color: 'var(--text-secondary)' }} />}
                </button>
                <button onClick={() => setShowHeaderMenu(!showHeaderMenu)} className="p-1.5 rounded-lg hover:bg-slate-100 ml-0.5" title="Mais opções">
                  <MoreVertical size={16} style={{ color: 'var(--text-secondary)' }} />
                </button>
                {showHeaderMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 rounded-lg shadow-lg py-1 z-30 w-60"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                    onMouseLeave={() => setShowHeaderMenu(false)}
                  >
                    <button onClick={() => { setShowConvSearch(!showConvSearch); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <Search size={14} /> Pesquisar nesta conversa
                    </button>
                    <button onClick={() => { setShowAdvSearch(!showAdvSearch); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <Search size={14} /> Pesquisa avançada (filtros)
                    </button>
                    <button onClick={() => { handleAISummary(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <Sparkles size={14} style={{ color: 'var(--primary)' }} /> Resumir conversa (IA)
                    </button>
                    {selected.contact?.whatsapp && (
                      <a href={`https://wa.me/${cleanPhone(selected.contact.whatsapp)}`} target="_blank" rel="noreferrer" className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100" onClick={() => setShowHeaderMenu(false)}>
                        <MessageCircle size={14} style={{ color: '#25D366' }} /> Abrir no WhatsApp
                      </a>
                    )}
                    {selected.contact?.phone && (
                      <a href={`tel:${cleanPhone(selected.contact.phone)}`} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100" onClick={() => setShowHeaderMenu(false)}>
                        <Phone size={14} /> Telefonar
                      </a>
                    )}
                    <button onClick={() => { handleCsatRequest(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <ThumbsUp size={14} style={{ color: '#F59E0B' }} /> Pedir avaliação CSAT
                    </button>
                    <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                    <button onClick={() => { handleExport('txt'); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <FileText size={14} /> Exportar conversa (.txt)
                    </button>
                    <button onClick={() => { handleExport('json'); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      <FileText size={14} /> Exportar conversa (.json)
                    </button>
                    <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                    <p className="px-3 py-1 text-[10px] uppercase font-semibold" style={{ color: 'var(--text-muted)' }}>Prioridade</p>
                    {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                      <button key={p} onClick={() => { handleSetPriority(p); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-100 text-left">
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: priorityColor(p), display: 'inline-block' }} />
                        {priorityLabel(p)}
                      </button>
                    ))}
                    <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                    <button onClick={() => setSoundEnabled(!soundEnabled)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 text-left">
                      {soundEnabled ? '🔊' : '🔇'} Som: {soundEnabled ? 'ON' : 'OFF'}
                    </button>
                    <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                    <button onClick={() => { handleDeleteConversation(); setShowHeaderMenu(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-50 text-left" style={{ color: '#EF4444' }}>
                      <Trash2 size={14} /> Eliminar conversa
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Pesquisa interna */}
            {showConvSearch && (
              <div className="px-6 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input autoFocus value={convSearch} onChange={(e) => setConvSearch(e.target.value)} className="input-base text-sm" style={{ paddingLeft: 32 }} placeholder="Pesquisar nesta conversa..." />
                </div>
                {convSearch.trim() && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{filteredMessages.length} resultado(s)</p>
                )}
              </div>
            )}

            {/* Pesquisa avançada (filtros) */}
            {showAdvSearch && (
              <div className="px-6 py-3 flex-shrink-0 space-y-2" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Pesquisa avançada</p>
                  <button onClick={() => { setShowAdvSearch(false); setAdvSearchType(''); setAdvSearchFrom(''); setAdvSearchTo(''); }} className="text-xs" style={{ color: 'var(--text-muted)' }}>Fechar</button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select value={advSearchType} onChange={(e) => setAdvSearchType(e.target.value)} className="input-base text-xs">
                    <option value="">Qualquer tipo</option>
                    <option value="TEXT">Texto</option>
                    <option value="IMAGE">Imagem</option>
                    <option value="VIDEO">Vídeo</option>
                    <option value="AUDIO">Áudio</option>
                    <option value="DOCUMENT">Documento</option>
                    <option value="INTERACTIVE">Botão/Lista</option>
                    <option value="SYSTEM">Sistema (chamadas)</option>
                  </select>
                  <input type="date" value={advSearchFrom} onChange={(e) => setAdvSearchFrom(e.target.value)} className="input-base text-xs" />
                  <input type="date" value={advSearchTo} onChange={(e) => setAdvSearchTo(e.target.value)} className="input-base text-xs" />
                </div>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Filtros aplicados na lista de mensagens abaixo. Combinar com pesquisa por texto na barra acima.
                </p>
              </div>
            )}

            {/* Resumo IA */}
            {aiSummary && (
              <div className="px-6 py-3 flex-shrink-0" style={{ background: 'var(--primary-light)', borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-start gap-2">
                  <Sparkles size={14} style={{ color: 'var(--primary)' }} className="mt-0.5 flex-shrink-0" />
                  <p className="text-xs whitespace-pre-wrap flex-1" style={{ color: 'var(--text-primary)' }}>{aiSummary}</p>
                  <button onClick={() => setAiSummary('')} className="flex-shrink-0">
                    <X size={12} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              </div>
            )}

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3" style={{ background: 'var(--surface-2)' }}>
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} /></div>
              ) : filteredMessages.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  {convSearch ? 'Nenhuma mensagem corresponde' : 'Sem mensagens'}
                </p>
              ) : (
                filteredMessages.map((msg) => {
                  const out = msg.direction === 'OUTBOUND';
                  const isMe = !!msg.sentBy?.id;
                  const isEditing = editingMessage?.id === msg.id;

                  if (msg.isInternal) {
                    return (
                      <div key={msg.id} className="flex justify-center group">
                        <div className="max-w-md px-4 py-2 rounded-lg text-xs flex items-start gap-2"
                          style={{ background: '#FEF3C7', border: '1px dashed #F59E0B', color: '#92400E' }}>
                          <Lock size={11} className="mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="font-medium">Nota interna · {msg.sentBy?.name}</p>
                            <p className="whitespace-pre-wrap mt-0.5">{msg.content}</p>
                            <p className="text-[10px] opacity-70 mt-1">{new Date(msg.createdAt).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</p>
                          </div>
                          {isMe && (
                            <button onClick={() => deleteMessage(msg)} className="opacity-0 group-hover:opacity-100">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className={`flex ${out ? 'justify-end' : 'justify-start'} group`}>
                      <div className="max-w-md relative">
                        {/* Quote (replyTo) */}
                        {msg.replyTo && (
                          <div className="mb-1 pl-2 ml-2 text-xs"
                            style={{ borderLeft: '2px solid var(--primary)', color: 'var(--text-muted)', opacity: 0.8 }}>
                            <p className="font-medium">{msg.replyTo.sentBy?.name || 'Cliente'}</p>
                            <p className="truncate">{msg.replyTo.content}</p>
                          </div>
                        )}
                        <div className="px-4 py-2.5 text-sm relative"
                          style={{
                            background: out ? 'var(--primary)' : 'var(--surface)',
                            color: out ? 'white' : 'var(--text-primary)',
                            borderRadius: out ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                            boxShadow: 'var(--shadow-sm)',
                          }}>
                          {isEditing ? (
                            <div>
                              <textarea value={editingContent} onChange={(e) => setEditingContent(e.target.value)}
                                className="w-full text-sm bg-transparent outline-none resize-none"
                                style={{ color: out ? '#fff' : 'var(--text-primary)', minHeight: 40 }} rows={3} autoFocus />
                              <div className="flex gap-2 mt-2">
                                <button onClick={saveEdit} className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: '#fff', color: 'var(--primary)' }}>Guardar</button>
                                <button onClick={() => setEditingMessage(null)} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.2)', color: out ? '#fff' : 'var(--text-primary)' }}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {msg.mediaUrl && (
                                <div className="mb-1">
                                  {(msg.type === 'IMAGE' || msg.mediaType?.startsWith('image/')) ? (
                                    <button onClick={() => setLightboxUrl(msg.mediaUrl!)} className="block">
                                      <img src={msg.mediaUrl} alt={msg.content} className="rounded max-w-full cursor-pointer" style={{ maxHeight: 240 }} />
                                    </button>
                                  ) : (msg.type === 'VIDEO' || msg.mediaType?.startsWith('video/')) ? (
                                    <video src={msg.mediaUrl} controls className="rounded max-w-full" style={{ maxHeight: 240, maxWidth: 320 }} />
                                  ) : (msg.type === 'AUDIO' || msg.mediaType?.startsWith('audio/')) ? (
                                    <audio src={msg.mediaUrl} controls style={{ maxWidth: 280 }} />
                                  ) : (
                                    <div className="flex items-center gap-2 p-2 rounded" style={{ background: out ? 'rgba(255,255,255,0.15)' : 'var(--surface-2)' }}>
                                      <FileText size={20} style={{ color: out ? 'white' : 'var(--text-secondary)' }} />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium truncate" style={{ color: out ? 'white' : 'var(--text-primary)' }}>{msg.content}</p>
                                      </div>
                                      <a href={msg.mediaUrl} download={msg.content} target="_blank" rel="noreferrer"
                                        className="p-1.5 rounded hover:bg-white/20"
                                        title="Baixar"
                                        style={{ background: out ? 'rgba(255,255,255,0.2)' : 'var(--surface-3)' }}>
                                        ⬇
                                      </a>
                                    </div>
                                  )}
                                </div>
                              )}
                              {msg.content && !(msg.type === 'IMAGE' || msg.mediaType?.startsWith('image/')) && msg.content !== '[Áudio]' && msg.content !== '[Imagem]' && msg.content !== '[Vídeo]' && (
                                <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
                              )}
                            </>
                          )}
                          <div className="flex items-center justify-end gap-1 mt-1 text-xs" style={{ color: out ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                            {selected.combined && <ChannelBadge channel={msg.channel} size={9} />}
                            <span>{new Date(msg.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
                            {msg.editedAt && <span title="Editada">(ed.)</span>}
                            {out && (msg.status === 'READ' ? <CheckCheck size={12} style={{ color: '#A5F3FC' }} /> : msg.status === 'DELIVERED' ? <CheckCheck size={12} /> : <Check size={12} />)}
                          </div>
                        </div>

                        {/* Actions on hover */}
                        {!isEditing && (
                          <div className={`absolute top-0 ${out ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1'} opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity`}>
                            <button onClick={() => setReplyTo(msg)} className="p-1 rounded bg-white shadow-sm" title="Responder">
                              <Reply size={11} style={{ color: 'var(--text-secondary)' }} />
                            </button>
                            {isMe && (
                              <>
                                <button onClick={() => startEdit(msg)} className="p-1 rounded bg-white shadow-sm" title="Editar">
                                  <Edit3 size={11} style={{ color: 'var(--text-secondary)' }} />
                                </button>
                                <button onClick={() => deleteMessage(msg)} className="p-1 rounded bg-white shadow-sm" title="Eliminar">
                                  <Trash2 size={11} style={{ color: '#EF4444' }} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Sugestões IA */}
            {aiSuggestions.length > 0 && (
              <div className="px-4 py-2 flex-shrink-0 flex flex-wrap gap-2" style={{ background: 'var(--primary-light)', borderTop: '1px solid var(--border)' }}>
                {aiSuggestions.map((s, i) => (
                  <button key={i} onClick={() => { setDraft(s); setAiSuggestions([]); }} className="text-xs px-2 py-1.5 rounded text-left max-w-xs"
                    style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                    {s.slice(0, 80)}{s.length > 80 ? '...' : ''}
                  </button>
                ))}
                <button onClick={() => setAiSuggestions([])} className="ml-auto p-1"><X size={12} style={{ color: 'var(--text-muted)' }} /></button>
              </div>
            )}

            {/* Reply preview */}
            {replyTo && (
              <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                <Reply size={14} style={{ color: 'var(--primary)' }} />
                <div className="flex-1 min-w-0 text-xs">
                  <p className="font-medium" style={{ color: 'var(--primary)' }}>A responder a {replyTo.sentBy?.name || 'Cliente'}</p>
                  <p className="truncate" style={{ color: 'var(--text-muted)' }}>{replyTo.content}</p>
                </div>
                <button onClick={() => setReplyTo(null)}><X size={14} style={{ color: 'var(--text-muted)' }} /></button>
              </div>
            )}

            {/* Composer */}
            <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setIsInternalNote(!isInternalNote)} className="text-xs px-2 py-1 rounded font-medium flex items-center gap-1"
                  style={{ background: isInternalNote ? '#FEF3C7' : 'var(--surface-3)', color: isInternalNote ? '#92400E' : 'var(--text-secondary)' }}>
                  <Lock size={11} /> Nota interna
                </button>
                <button onClick={() => setShowTemplates(true)} className="text-xs px-2 py-1 rounded font-medium" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                  <FileText size={11} className="inline mr-1" /> Templates
                </button>
                <button onClick={() => setShowSnippets(true)} className="text-xs px-2 py-1 rounded font-medium" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                  <Zap size={11} className="inline mr-1" /> Snippets
                </button>
                <button onClick={handleAISuggest} disabled={aiLoading} className="text-xs px-2 py-1 rounded font-medium ml-auto"
                  style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                  {aiLoading ? <Loader2 size={11} className="animate-spin inline" /> : <Sparkles size={11} className="inline mr-1" />}
                  Sugerir resposta
                </button>
                {draft.trim() && (
                  <button onClick={handleAIImprove} disabled={aiLoading} className="text-xs px-2 py-1 rounded font-medium"
                    style={{ background: 'var(--primary-light)', color: 'var(--primary)' }} title="Melhorar texto com IA">
                    <Wand2 size={11} className="inline mr-1" /> Melhorar
                  </button>
                )}
              </div>
              {/* Preview do anexo */}
              {attachment && (
                <div className="flex items-center gap-2 p-2 rounded mb-2" style={{ background: 'var(--surface-2)' }}>
                  {attachment.mimeType.startsWith('image/') ? (
                    <img src={`${(import.meta.env as any).VITE_API_URL || ''}${attachment.url}`} className="w-10 h-10 rounded object-cover" alt="" />
                  ) : (
                    <div className="w-10 h-10 rounded flex items-center justify-center" style={{ background: 'var(--primary-light)' }}>
                      <Paperclip size={16} style={{ color: 'var(--primary)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{attachment.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{(attachment.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="p-1">
                    <X size={14} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              )}

              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
              {recording ? (
                <div className="flex items-center gap-3 p-3 rounded-xl" style={{ border: '1px solid #EF4444', background: '#FEF2F2' }}>
                  <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: '#EF4444' }} />
                  <span className="text-sm font-medium" style={{ color: '#EF4444' }}>
                    A gravar... {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                  </span>
                  <div className="flex-1" />
                  <button onClick={cancelRecording} className="p-2 rounded-lg hover:bg-red-100" title="Cancelar">
                    <X size={18} style={{ color: '#EF4444' }} />
                  </button>
                  <button onClick={stopRecording} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#10B981' }} title="Parar e anexar">
                    <Check size={18} className="text-white" />
                  </button>
                </div>
              ) : (
                <div className="flex items-end gap-2 p-3 rounded-xl"
                  style={{ border: `1px solid ${isInternalNote ? '#F59E0B' : 'var(--border)'}`, background: isInternalNote ? '#FEF3C7' : 'transparent' }}>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="p-1 rounded-lg hover:bg-slate-100 flex-shrink-0" title="Anexar ficheiro">
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} style={{ color: 'var(--text-muted)' }} />}
                  </button>
                  <textarea
                    ref={draftRef}
                    className="flex-1 text-sm resize-none outline-none min-h-[36px] max-h-32"
                    style={{ color: 'var(--text-primary)', background: 'transparent' }}
                    placeholder={isInternalNote ? 'Nota interna (so visivel para a equipa)...' : `Mensagem para ${fullName(selected.contact)}... (/atalho para snippets)`}
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    rows={1}
                    disabled={sending}
                  />
                  {!draft.trim() && !attachment && !isInternalNote && (
                    <button onClick={startRecording} className="p-1 rounded-lg hover:bg-slate-100 flex-shrink-0" title="Gravar mensagem de voz">
                      <Mic size={18} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  )}
                  <button onClick={sendMessage} disabled={sending || (!draft.trim() && !attachment)} className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: isInternalNote ? '#F59E0B' : 'var(--primary)', opacity: ((!draft.trim() && !attachment) || sending) ? 0.5 : 1 }}>
                    {sending ? <Loader2 size={16} className="animate-spin text-white" /> : <Send size={16} className="text-white" />}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Painel direito */}
      {selected && selected.contact && showContactPanel && (
        <div className="w-72 flex flex-col flex-shrink-0" style={{ borderLeft: '1px solid var(--border)' }}>
          <div className="p-4 flex-shrink-0 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="font-semibold text-sm">Contacto</h3>
            <button onClick={() => setShowContactPanel(false)} className="p-1 rounded hover:bg-slate-100" title="Fechar">
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="text-center">
              {selected.contact.avatar ? (
                <img src={selected.contact.avatar} className="w-16 h-16 rounded-full object-cover mx-auto" alt="" />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white mx-auto" style={{ background: 'var(--primary)' }}>
                  {selected.contact.type === 'COMPANY' ? <Building2 size={24} /> : (selected.contact.firstName?.[0] || '?').toUpperCase()}
                </div>
              )}
              <p className="font-semibold mt-2">{fullName(selected.contact)}</p>
            </div>

            <div className="flex justify-center gap-1">
              <button onClick={() => toggleFavorite(selected)} className="btn py-1.5 px-3 text-xs"
                style={{ background: getMeta(selected)?.isPinned ? '#FEF3C7' : 'var(--surface-3)', color: getMeta(selected)?.isPinned ? '#92400E' : 'var(--text-secondary)' }}>
                <Star size={12} fill={getMeta(selected)?.isPinned ? '#F59E0B' : 'none'} />
                {getMeta(selected)?.isPinned ? 'Favorita' : 'Favoritar'}
              </button>
              <button onClick={() => toggleArchive(selected)} className="btn py-1.5 px-3 text-xs"
                style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                <Archive size={12} />
                {getMeta(selected)?.isArchived ? 'Restaurar' : 'Arquivar'}
              </button>
            </div>

            <button
              onClick={() => setNewTaskFor({
                leadId: selected.leadId,
                contactId: selected.contact?.id || null,
                contactName: fullName(selected.contact),
              })}
              className="btn btn-primary py-1.5 text-xs w-full"
              disabled={!selected.leadId && !selected.contact?.id}
            >
              <CheckSquare size={12} /> Nova tarefa
            </button>

            {/* Atribuir responsavel */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Responsavel</p>
              <select
                value={getMeta(selected)?.assignedToId || ''}
                onChange={(e) => assignTo(selected, e.target.value || null)}
                className="input-base text-xs"
                style={{ padding: '6px 8px' }}
              >
                <option value="">— Sem atribuir —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Tags da conversa */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tags da conversa</p>
              <div className="flex flex-wrap gap-1 p-2 rounded" style={{ background: 'var(--surface-2)', minHeight: 32 }}>
                {allTags.length === 0 && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Sem tags. Cria nos Contactos.</span>
                )}
                {allTags.map((tag) => {
                  const sel = !!getMeta(selected)?.tags?.find((t) => t.tag.id === tag.id);
                  return (
                    <button key={tag.id} onClick={() => toggleTag(selected, tag.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: sel ? tag.color : tag.color + '22', color: sel ? '#fff' : tag.color, border: `1px solid ${tag.color}` }}>
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 text-xs">
              {selected.contact.phone && <div><p style={{ color: 'var(--text-muted)' }}>Telefone</p><p className="font-medium">{selected.contact.phone}</p></div>}
              {selected.contact.whatsapp && <div><p style={{ color: 'var(--text-muted)' }}>WhatsApp</p><p className="font-medium">{selected.contact.whatsapp}</p></div>}
              {selected.contact.email && <div><p style={{ color: 'var(--text-muted)' }}>Email</p><p className="font-medium truncate">{selected.contact.email}</p></div>}
            </div>

            <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>Mensagens</span>
                <span className="font-medium">{selected.total}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>Nao lidas</span>
                <span className="font-medium" style={{ color: selected.unread > 0 ? 'var(--primary)' : undefined }}>{selected.unread}</span>
              </div>
              {avgResponseMin !== null && (
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>Tempo medio resposta</span>
                  <span className="font-medium">{avgResponseMin < 60 ? `${avgResponseMin}min` : `${Math.round(avgResponseMin / 60)}h`}</span>
                </div>
              )}
            </div>

            <button onClick={() => navigate(`/contacts?contactId=${selected.contact!.id}`)} className="btn w-full text-xs py-2" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
              <UserIcon size={12} /> Ver perfil completo
            </button>
          </div>
        </div>
      )}

      {/* Modais */}
      {newMessageOpen && <NewMessageModal contacts={contacts} onClose={() => setNewMessageOpen(false)} onCreated={() => loadConversations()} />}
      {showTemplates && (
        <TemplatesModal
          templates={templates}
          channel={selected?.channel || 'WHATSAPP'}
          onSelect={(content) => { setDraft(draft + content); setShowTemplates(false); }}
          onClose={() => setShowTemplates(false)}
          onChanged={loadTemplates}
        />
      )}
      {showSnippets && (
        <SnippetsModal
          snippets={snippets}
          onChange={(s) => { setSnippets(s); localStorage.setItem(SNIPPET_KEY, JSON.stringify(s)); }}
          onClose={() => setShowSnippets(false)}
        />
      )}
      {creatingLead && selected && defaultPipeline && defaultStage && (
        <AddLeadModal
          stageId={defaultStage.id}
          pipelineId={defaultPipeline.id}
          onClose={() => setCreatingLead(false)}
          onCreated={async (lead) => {
            if (selected.contact?.id) {
              try { await api.patch(`/leads/${lead.id}`, { contactId: selected.contact.id }); } catch {}
            }
            toast.success('Lead criado');
            setCreatingLead(false);
            loadConversations();
          }}
        />
      )}

      {/* Mini modal Nova Tarefa */}
      {newTaskFor && (
        <QuickNewTaskModal
          leadId={newTaskFor.leadId || null}
          contactId={newTaskFor.contactId || null}
          contactName={newTaskFor.contactName}
          onClose={() => setNewTaskFor(null)}
          onCreated={() => { setNewTaskFor(null); toast.success('Tarefa criada'); }}
        />
      )}

      {/* Lightbox de imagem */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
            className="absolute top-4 right-4 text-white p-2 rounded-full hover:bg-white/10"
            title="Fechar"
          >
            <X size={24} />
          </button>
          <a
            href={lightboxUrl}
            download
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-16 text-white p-2 rounded-full hover:bg-white/10"
            title="Baixar"
          >
            ⬇
          </a>
          <img
            src={lightboxUrl}
            alt=""
            style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Mini modal Nova Tarefa (tratamento de tarefa única) ───
function QuickNewTaskModal({ leadId, contactId, contactName, onClose, onCreated }: {
  leadId: string | null;
  contactId: string | null;
  contactName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(`Seguir ${contactName}`);
  const [type, setType] = useState('FOLLOW_UP');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueAt, setDueAt] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<any | null>(null);

  const submit = async (force = false) => {
    if (!leadId && !contactId) { toast.error('Conversa sem lead/contacto associado'); return; }
    setSaving(true);
    try {
      await api.post('/tasks', {
        title, type, priority,
        leadId: leadId || undefined,
        contactId: contactId || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        force,
      });
      onCreated();
    } catch (e: any) {
      if (e.response?.status === 409) {
        setExisting(e.response.data.existingTask);
      } else {
        toast.error(e.response?.data?.message || 'Erro');
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-base">Nova tarefa</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {existing ? (
          <div className="space-y-3">
            <div className="card p-3" style={{ background: '#FEF3C7', border: '1px solid #FBBF24' }}>
              <p className="text-sm font-medium" style={{ color: '#92400E' }}>Já existe uma tarefa pendente:</p>
              <p className="text-sm mt-2 font-semibold">{existing.title}</p>
              <p className="text-xs mt-1" style={{ color: '#92400E' }}>
                {existing.dueAt ? `Prazo: ${new Date(existing.dueAt).toLocaleString('pt-PT')}` : 'Sem prazo'}
                {' · '}{existing.priority}
                {' · '}{existing.status}
              </p>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Podes ver a tarefa em <strong>Tarefas</strong>, ou criar uma nova mesmo assim.
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
              <button onClick={() => submit(true)} disabled={saving} className="btn btn-primary flex-1 py-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Criar mesmo assim'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">Título</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Tipo</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className="input-base text-sm">
                  <option value="CALL">Chamada</option>
                  <option value="EMAIL">Email</option>
                  <option value="MEETING">Reunião</option>
                  <option value="FOLLOW_UP">Seguimento</option>
                  <option value="DEMO">Demo</option>
                  <option value="OTHER">Outra</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Prioridade</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-base text-sm">
                  <option value="LOW">Baixa</option>
                  <option value="MEDIUM">Média</option>
                  <option value="HIGH">Alta</option>
                  <option value="URGENT">Urgente</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Prazo</label>
              <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="input-base text-sm" style={{ colorScheme: 'dark' }} />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
              <button onClick={() => submit(false)} disabled={saving || !title.trim()} className="btn btn-primary flex-1 py-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Criar tarefa'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
