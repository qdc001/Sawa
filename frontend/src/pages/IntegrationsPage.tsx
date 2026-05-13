import { useEffect, useState, useRef } from 'react';
import { MessageCircle, Mail, Globe, CheckCircle2, Settings, Loader2, X, Plus, Trash2, Send, QrCode, Power, RefreshCw, Smartphone, Download } from 'lucide-react';
import api, { IntegrationItem } from '../lib/api';
import toast from 'react-hot-toast';
import { getSocket } from '../lib/socket';

type IntegrationType = 'WHATSAPP_CLOUD' | 'EVOLUTION' | 'EMAIL' | 'INSTAGRAM' | 'FACEBOOK' | 'TIKTOK';

interface IntegrationDef {
  type: IntegrationType;
  // Backend usa enum IntegrationType: WHATSAPP, WEBHOOK, EMAIL_SMTP, etc.
  backendType: string;
  name: string;
  icon: any;
  color: string;
  bg: string;
  desc: string;
  fields: Array<{ key: string; label: string; type?: 'text' | 'password' | 'number' | 'checkbox'; required?: boolean; placeholder?: string }>;
}

const DEFINITIONS: IntegrationDef[] = [
  {
    type: 'WHATSAPP_CLOUD',
    backendType: 'WHATSAPP',
    name: 'WhatsApp Cloud API',
    icon: MessageCircle,
    color: '#25D366',
    bg: '#E7F9EE',
    desc: 'Envia mensagens via Meta Cloud API. Requer Phone Number ID e Access Token.',
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'EAAG...' },
      { key: 'phoneNumberId', label: 'Phone Number ID', required: true, placeholder: '123456789012345' },
      { key: 'businessAccountId', label: 'Business Account ID (opcional)', placeholder: '...' },
    ],
  },
  {
    type: 'EVOLUTION',
    backendType: 'WEBHOOK', // usar tipo WEBHOOK + name=Evolution
    name: 'WhatsApp via QR (Evolution)',
    icon: Smartphone,
    color: '#25D366',
    bg: '#E7F9EE',
    desc: 'Liga o teu WhatsApp pessoal ou de empresa diretamente, sem Cloud API. Escaneias um QR como no WhatsApp Web.',
    fields: [
      { key: 'baseUrl', label: 'URL Base', required: true, placeholder: 'https://evolution.exemplo.com' },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'instanceName', label: 'Nome da Instância', required: true, placeholder: 'absalao' },
    ],
  },
  {
    type: 'EMAIL',
    backendType: 'EMAIL_SMTP',
    name: 'Email SMTP',
    icon: Mail,
    color: '#0EA5E9',
    bg: '#F0F9FF',
    desc: 'Envio de email via servidor SMTP (Gmail, Outlook, custom).',
    fields: [
      { key: 'host', label: 'Host SMTP', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Porta', type: 'number', required: true, placeholder: '587' },
      { key: 'secure', label: 'SSL/TLS (porta 465)', type: 'checkbox' },
      { key: 'user', label: 'Utilizador (email)', required: true, placeholder: 'tu@exemplo.com' },
      { key: 'pass', label: 'Password / App password', type: 'password', required: true },
      { key: 'fromName', label: 'Nome remetente', placeholder: 'Absalão' },
      { key: 'fromEmail', label: 'Email remetente (opcional)', placeholder: 'igual ao utilizador se vazio' },
    ],
  },
  {
    type: 'INSTAGRAM',
    backendType: 'INSTAGRAM',
    name: 'Instagram Direct',
    icon: MessageCircle,
    color: '#E1306C',
    bg: '#FCE7F3',
    desc: 'Receber e responder DMs do Instagram via Meta Graph API. Precisa de conta business ligada a página Facebook.',
    fields: [
      { key: 'accessToken', label: 'Access Token (Long-lived)', type: 'password', required: true, placeholder: 'EAAG...' },
      { key: 'pageId', label: 'Facebook Page ID', required: true },
      { key: 'instagramBusinessId', label: 'Instagram Business Account ID', required: true },
    ],
  },
  {
    type: 'FACEBOOK',
    backendType: 'FACEBOOK',
    name: 'Facebook Messenger',
    icon: MessageCircle,
    color: '#1877F2',
    bg: '#EFF6FF',
    desc: 'Receber e responder mensagens do Facebook Messenger via Meta Graph API.',
    fields: [
      { key: 'accessToken', label: 'Page Access Token', type: 'password', required: true, placeholder: 'EAAG...' },
      { key: 'pageId', label: 'Facebook Page ID', required: true },
      { key: 'verifyToken', label: 'Verify Token (webhook)', required: true, placeholder: 'meta_fb_verify_2026' },
    ],
  },
  {
    type: 'TIKTOK',
    backendType: 'WEBHOOK',
    name: 'TikTok Business',
    icon: MessageCircle,
    color: '#000000',
    bg: '#F1F5F9',
    desc: 'Integração com TikTok Business Messages. Em beta — requer conta TikTok for Business aprovada.',
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { key: 'businessId', label: 'Business Account ID', required: true },
    ],
  },
];

function ConfigModal({
  def, existing, onClose, onSaved,
}: {
  def: IntegrationDef;
  existing?: IntegrationItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [creds, setCreds] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    def.fields.forEach((f) => {
      initial[f.key] = (existing?.credentials as any)?.[f.key] ?? (f.type === 'checkbox' ? false : '');
    });
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const Icon = def.icon;

  const handleSave = async () => {
    // validar required
    for (const f of def.fields) {
      if (f.required && !creds[f.key]) {
        toast.error(`${f.label} obrigatorio`);
        return;
      }
    }
    setLoading(true);
    try {
      if (existing) {
        await api.patch(`/integrations/${existing.id}`, {
          name: def.name,
          credentials: creds,
          isActive: true,
        });
      } else {
        await api.post('/integrations', {
          type: def.backendType,
          name: def.name,
          credentials: creds,
          isActive: true,
        });
      }
      toast.success('Integracao guardada');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: def.bg }}>
              <Icon size={20} style={{ color: def.color }} />
            </div>
            <div>
              <h3 className="text-lg font-bold">{def.name}</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{def.desc}</p>
            </div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-3">
          {def.fields.map((f) => (
            <div key={f.key}>
              {f.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!creds[f.key]} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.checked })} />
                  {f.label}
                </label>
              ) : (
                <>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                    {f.label}{f.required && ' *'}
                  </label>
                  <input
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    value={creds[f.key] || ''}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                    className="input-base"
                    placeholder={f.placeholder}
                  />
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleSave} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TestSendModal({
  type, onClose,
}: {
  type: IntegrationType;
  onClose: () => void;
}) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!to || !message) { toast.error('Destinatario e mensagem obrigatorios'); return; }
    setLoading(true);
    try {
      let endpoint = '';
      let payload: any = { to, message };
      if (type === 'WHATSAPP_CLOUD') endpoint = '/integrations/whatsapp-cloud/send';
      else if (type === 'EVOLUTION') endpoint = '/integrations/evolution/send';
      else if (type === 'EMAIL') {
        endpoint = '/integrations/email/send';
        payload = { to, subject, html: message };
      }
      await api.post(endpoint, payload);
      toast.success('Enviado!');
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a enviar');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Teste de envio</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={type === 'EMAIL' ? 'email@destino.com' : '+25884...'} className="input-base" />
          {type === 'EMAIL' && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" className="input-base" />}
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Mensagem" className="input-base" rows={4} />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleSend} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <><Send size={14} /> Enviar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============= Modal específico Evolution: configurar + QR =============
function EvolutionConnectModal({ existing, onClose, onChanged }: {
  existing: IntegrationItem | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<'config' | 'qr'>(existing ? 'qr' : 'config');
  const [baseUrl, setBaseUrl] = useState((existing?.credentials as any)?.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string>('loading');
  const [instanceName, setInstanceName] = useState<string>((existing?.credentials as any)?.instanceName || '');
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; contactsCreated: number; messagesImported: number } | null>(null);
  const [syncPromptShown, setSyncPromptShown] = useState(false);
  const [fixingNames, setFixingNames] = useState(false);
  const [syncingContactNames, setSyncingContactNames] = useState(false);
  const lastSyncAt: string | null = (existing?.credentials as any)?.lastSyncAt || null;

  const saveConfig = async () => {
    if (!baseUrl || !apiKey) { toast.error('URL base e API key obrigatórios'); return; }
    setSaving(true);
    try {
      await api.post('/integrations/evolution/configure', { baseUrl, apiKey });
      toast.success('Servidor Evolution configurado');
      setStep('qr');
      await connect();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a configurar');
    } finally { setSaving(false); }
  };

  const connect = async () => {
    setRefreshing(true);
    setQr(null);
    try {
      const res = await api.post('/integrations/evolution/connect', {});
      if (res.data.instanceName) setInstanceName(res.data.instanceName);
      const b64 = res.data.base64;
      if (b64) {
        setQr(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`);
      }
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a obter QR');
    } finally { setRefreshing(false); }
  };

  const refreshQr = async () => {
    setRefreshing(true);
    try {
      const res = await api.get('/integrations/evolution/qr');
      const b64 = res.data.base64;
      if (b64) setQr(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`);
    } catch {} finally { setRefreshing(false); }
  };

  const disconnect = async () => {
    if (!confirm('Desligar a sessão WhatsApp?')) return;
    setDisconnecting(true);
    try {
      await api.post('/integrations/evolution/disconnect');
      toast.success('Desligado');
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    } finally { setDisconnecting(false); }
  };

  // Polling do estado E do QR a cada 3s enquanto não ligar
  useEffect(() => {
    if (step !== 'qr') return;
    let qrAttempts = 0;
    const tick = async () => {
      try {
        const res = await api.get('/integrations/evolution/status');
        const s = res.data.state;
        setState(s || 'unknown');
        if (s === 'open') {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.success('WhatsApp ligado!');
          onChanged();
          return;
        }
        // Se ainda não temos QR, tenta buscar
        if (!qr && qrAttempts < 30) {
          qrAttempts++;
          try {
            const qrRes = await api.get('/integrations/evolution/qr');
            const b64 = qrRes.data.base64;
            if (b64) setQr(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`);
          } catch {}
        }
      } catch {}
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, qr]);

  // Ao abrir em modo QR, se ainda não temos QR e não está ligado, pedir
  useEffect(() => {
    if (step === 'qr' && !qr && state !== 'open' && existing) {
      connect();
    }
  }, [step]);

  // Sync de conversas existentes
  // limitChats=0, messagesPerChat=0 => sem limites
  const startSync = async (silent = false, opts?: { limitChats?: number; messagesPerChat?: number; throttleMs?: number }) => {
    if (syncing) return;
    setSyncing(true);
    setSyncProgress({ current: 0, total: 0, contactsCreated: 0, messagesImported: 0 });
    try {
      await api.post('/integrations/evolution/sync-chats', {
        limitChats: opts?.limitChats ?? 0,
        messagesPerChat: opts?.messagesPerChat ?? 0,
        throttleMs: opts?.throttleMs ?? 200,
      });
      if (!silent) toast.success('Sincronização iniciada — vai aparecendo na Caixa de Entrada');
    } catch (e: any) {
      setSyncing(false);
      setSyncProgress(null);
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Erro ao iniciar sincronização');
    }
  };

  // Listener de progresso da sync
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onSync = (p: any) => {
      if (p.stage === 'chats_listed') {
        setSyncProgress((prev) => ({ ...(prev || { contactsCreated: 0, messagesImported: 0, current: 0, total: 0 }), total: p.total || 0 }));
      } else if (p.stage === 'progress') {
        setSyncProgress({
          current: p.current || 0,
          total: p.total || 0,
          contactsCreated: p.contactsCreated || 0,
          messagesImported: p.messagesImported || 0,
        });
      } else if (p.stage === 'done') {
        setSyncing(false);
        setSyncProgress(null);
        toast.success(`Importadas ${p.messagesImported} mensagens de ${p.chatsScanned} conversas`);
        onChanged();
      } else if (p.stage === 'error') {
        setSyncing(false);
        setSyncProgress(null);
        toast.error('Sincronização falhou: ' + (p.error || 'erro desconhecido'));
      }
    };
    socket.on('evolution:sync', onSync);
    return () => { socket.off('evolution:sync', onSync); };
  }, [onChanged]);

  // Corrigir nomes (contactos que ficaram com nome do dono ou só dígitos)
  const fixNames = async () => {
    if (fixingNames) return;
    setFixingNames(true);
    try {
      const { data } = await api.post('/integrations/evolution/fix-names');
      if (data.fixed > 0) {
        toast.success(`Corrigidos ${data.fixed} contactos${data.ownerName ? ` (dono: ${data.ownerName})` : ''}`);
      } else {
        toast.success(`Nada para corrigir (${data.candidates} candidatos verificados)`);
      }
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Erro ao corrigir');
    } finally {
      setFixingNames(false);
    }
  };

  // Sincronizar nomes a partir do livro de contactos do telefone (Evolution findContacts)
  // Modos:
  //   'update'  — apenas actualiza nomes dos contactos que já existem no CRM
  //   'import'  — também cria contactos novos para entradas do livro que ainda não estão no CRM
  const syncContactNames = async (mode: 'update' | 'import' = 'update') => {
    if (syncingContactNames) return;
    setSyncingContactNames(true);
    try {
      const { data } = await api.post('/integrations/evolution/sync-contact-names', {
        createMissing: mode === 'import',
      });
      const parts: string[] = [];
      if (data.created) parts.push(`${data.created} criados`);
      if (data.updated) parts.push(`${data.updated} actualizados`);
      if (data.skipped) parts.push(`${data.skipped} sem mudança`);
      toast.success(parts.length ? parts.join(', ') : 'Nada a fazer');
      onChanged();
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.response?.data?.message || 'Erro ao sincronizar');
    } finally {
      setSyncingContactNames(false);
    }
  };

  // Prompt automático: assim que liga (state=open) e ainda nunca sincronizou
  useEffect(() => {
    if (state === 'open' && !lastSyncAt && !syncPromptShown && !syncing) {
      setSyncPromptShown(true);
      if (confirm('WhatsApp ligado! Queres importar agora TODAS as conversas existentes (sem limite) para o CRM? Pode demorar vários minutos.')) {
        startSync();
      }
    }
  }, [state, lastSyncAt, syncPromptShown, syncing]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#E7F9EE' }}>
              <Smartphone size={20} style={{ color: '#25D366' }} />
            </div>
            <div>
              <h3 className="text-lg font-bold">WhatsApp via QR</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Evolution API</p>
            </div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        {step === 'config' && (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Indica o servidor Evolution API onde a tua instância vai correr. Se ainda não tens, vê as instruções no fim da página de Integrações.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">URL do servidor *</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="input-base" placeholder="https://evolution-meta.yq6lij.easypanel.host" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API Key *</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="input-base" placeholder="API key do Evolution" />
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
              <button onClick={saveConfig} disabled={saving} className="btn btn-primary flex-1 py-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Continuar'}
              </button>
            </div>
          </div>
        )}

        {step === 'qr' && (
          <div className="space-y-3">
            {/* Estado da ligação */}
            <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--surface-2)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Estado:</span>
              <span className="text-xs font-semibold" style={{
                color: state === 'open' ? '#10B981' : state === 'connecting' ? '#F59E0B' : 'var(--text-muted)',
              }}>
                {state === 'open' ? '✓ Ligado' :
                 state === 'connecting' ? 'A ligar...' :
                 state === 'close' ? 'Desligado' :
                 state === 'loading' ? 'A verificar...' :
                 state === 'error' ? 'Erro' :
                 state}
              </span>
            </div>

            {state === 'open' ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: '#D1FAE5' }}>
                  <CheckCircle2 size={32} style={{ color: '#10B981' }} />
                </div>
                <p className="font-semibold mb-1">WhatsApp ligado</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  Instância: <code>{instanceName}</code>
                </p>

                {/* Importar conversas existentes */}
                <div className="mb-4 p-3 rounded-lg text-left" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Importar conversas existentes
                  </p>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                    Traz para a Caixa de Entrada <strong>todas</strong> as conversas, contactos e mensagens disponíveis no WhatsApp (sem limite).
                    Pode demorar vários minutos consoante o histórico.
                    <br />
                    <strong>Atenção:</strong> a Evolution só consegue importar o que está na cache do dispositivo. Mensagens muito antigas só ficam disponíveis depois de abrires a conversa no telefone e fazeres scroll para cima — depois clica "Sincronizar novamente" e o histórico extra entra.
                    {lastSyncAt && <><br />Última sync: {new Date(lastSyncAt).toLocaleString('pt-PT')}.</>}
                  </p>

                  {syncing && syncProgress ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        <span>
                          {syncProgress.total > 0
                            ? `${syncProgress.current}/${syncProgress.total} conversas`
                            : 'A listar conversas...'}
                        </span>
                        <span>{syncProgress.messagesImported} msgs</span>
                      </div>
                      {syncProgress.total > 0 && (
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                          <div
                            className="h-full transition-all"
                            style={{
                              background: '#25D366',
                              width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <button
                        onClick={() => startSync()}
                        className="btn text-xs py-1.5 w-full"
                        style={{ background: '#25D366', color: 'white' }}
                      >
                        <Download size={12} /> {lastSyncAt ? 'Sincronizar novamente' : 'Importar agora'}
                      </button>
                      <button
                        onClick={() => syncContactNames('import')}
                        disabled={syncingContactNames}
                        className="btn text-xs py-1.5 w-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
                        title="Importa todos os contactos do livro de contactos do telefone — cria os que faltam e actualiza nomes dos que existem"
                      >
                        {syncingContactNames ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Importar contactos da agenda
                      </button>
                      <button
                        onClick={() => syncContactNames('update')}
                        disabled={syncingContactNames}
                        className="btn text-xs py-1.5 w-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
                        title="Apenas actualiza nomes dos contactos que já existem no CRM (sem criar novos)"
                      >
                        {syncingContactNames ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Sincronizar só nomes (sem criar)
                      </button>
                      <button
                        onClick={fixNames}
                        disabled={fixingNames}
                        className="btn text-xs py-1.5 w-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
                        title="Substitui nomes incorrectos (do dono do WhatsApp ou só dígitos) pelo número formatado ou pushName real"
                      >
                        {fixingNames ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        Corrigir nomes de contactos
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={disconnect}
                  disabled={disconnecting || syncing}
                  className="btn text-xs py-2 px-4 mx-auto"
                  style={{ background: '#FEF2F2', color: '#EF4444' }}
                >
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <><Power size={12} /> Desligar</>}
                </button>
              </div>
            ) : (
              <>
                {/* QR Display */}
                <div className="flex flex-col items-center gap-3 py-4">
                  {qr ? (
                    <img src={qr} alt="QR Code" style={{ width: 240, height: 240, borderRadius: 8, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ width: 240, height: 240, background: 'var(--surface-3)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {refreshing ? <Loader2 className="animate-spin" size={32} /> : <QrCode size={48} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                  )}
                  <button
                    onClick={refreshQr}
                    disabled={refreshing}
                    className="btn btn-outline text-xs py-1.5 gap-1"
                  >
                    {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Atualizar QR
                  </button>
                </div>

                <ol className="text-xs space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <li><strong>1.</strong> No telefone, abre o WhatsApp.</li>
                  <li><strong>2.</strong> Vai a <strong>Definições</strong> (ou ⋮) → <strong>Aparelhos ligados</strong>.</li>
                  <li><strong>3.</strong> Toca em <strong>Ligar um aparelho</strong>.</li>
                  <li><strong>4.</strong> Aponta a câmara para o QR acima.</li>
                </ol>

                <div className="text-[11px] p-2 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  <strong>Dica:</strong> o QR refresca-se sozinho via servidor. Se não ligar em 60s, clica "Atualizar QR".
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ def: IntegrationDef; existing: IntegrationItem | null } | null>(null);
  const [testing, setTesting] = useState<IntegrationType | null>(null);
  const [showEvoConnect, setShowEvoConnect] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/integrations').then(({ data }) => setItems(Array.isArray(data) ? data : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const findExisting = (def: IntegrationDef): IntegrationItem | null => {
    if (def.type === 'EVOLUTION') {
      return items.find((i) => i.type === 'WEBHOOK' && i.name?.toLowerCase().includes('evolution')) || null;
    }
    return items.find((i) => i.type === def.backendType) || null;
  };

  const handleDelete = async (item: IntegrationItem) => {
    if (!confirm('Eliminar esta integracao?')) return;
    try {
      await api.delete(`/integrations/${item.id}`);
      toast.success('Eliminada');
      load();
    } catch { toast.error('Erro'); }
  };

  const toggleActive = async (item: IntegrationItem) => {
    try {
      await api.patch(`/integrations/${item.id}`, { isActive: !item.isActive });
      load();
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Integrações</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Liga o CRM a canais externos para enviar mensagens reais.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {DEFINITIONS.map((def) => {
            const Icon = def.icon;
            const existing = findExisting(def);
            const configured = !!existing;
            const active = existing?.isActive;
            return (
              <div key={def.type} className="card p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: def.bg }}>
                    <Icon size={20} style={{ color: def.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{def.name}</p>
                    {configured ? (
                      <span className="flex items-center gap-1 text-xs" style={{ color: active ? '#10B981' : 'var(--text-muted)' }}>
                        <CheckCircle2 size={11} /> {active ? 'Activa' : 'Desactivada'}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Nao configurada</span>
                    )}
                  </div>
                </div>
                <p className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>{def.desc}</p>
                <div className="flex gap-2">
                  {def.type === 'EVOLUTION' ? (
                    configured ? (
                      <>
                        <button onClick={() => setShowEvoConnect(true)} className="btn flex-1 text-xs py-1.5 text-white" style={{ background: '#25D366' }}>
                          <Smartphone size={12} /> {active ? 'Gerir ligação' : 'Ligar via QR'}
                        </button>
                        <button onClick={() => setTesting(def.type)} className="btn text-xs py-1.5 px-2" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }} title="Testar envio">
                          <Send size={12} />
                        </button>
                        <button onClick={() => handleDelete(existing!)} className="btn text-xs py-1.5 px-2" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setShowEvoConnect(true)} className="btn w-full text-xs py-1.5 text-white" style={{ background: '#25D366' }}>
                        <Smartphone size={12} /> Ligar WhatsApp via QR
                      </button>
                    )
                  ) : configured ? (
                    <>
                      <button onClick={() => setEditing({ def, existing })} className="btn flex-1 text-xs py-1.5" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                        <Settings size={12} /> Editar
                      </button>
                      <button onClick={() => toggleActive(existing!)} className="btn text-xs py-1.5 px-2" style={{ background: active ? '#FEF3C7' : '#D1FAE5', color: active ? '#92400E' : '#065F46' }}>
                        {active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button onClick={() => setTesting(def.type)} className="btn text-xs py-1.5 px-2" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }} title="Testar envio">
                        <Send size={12} />
                      </button>
                      <button onClick={() => handleDelete(existing!)} className="btn text-xs py-1.5 px-2" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setEditing({ def, existing: null })} className="btn w-full text-xs py-1.5 text-white" style={{ background: def.color }}>
                      <Plus size={12} /> Configurar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Como ligar o WhatsApp via QR (Evolution)</p>
        <ol className="text-xs space-y-1.5 list-decimal pl-4" style={{ color: 'var(--text-secondary)' }}>
          <li>No Easypanel, cria um serviço novo a partir da imagem oficial: <code>atendai/evolution-api:latest</code> (porta 8080).</li>
          <li>Define as variáveis de ambiente mínimas: <code>AUTHENTICATION_API_KEY</code> (qualquer string longa), <code>SERVER_URL</code> (URL público do serviço), <code>DATABASE_PROVIDER=postgresql</code>, <code>DATABASE_CONNECTION_URI</code> (apontar para uma BD nova), <code>CACHE_REDIS_ENABLED=false</code>.</li>
          <li>Faz deploy. Anota a URL pública do Evolution (ex: <code>https://evolution-meta.yq6lij.easypanel.host</code>).</li>
          <li>Volta aqui e clica <strong>Ligar WhatsApp via QR</strong>. Mete a URL e a API key.</li>
          <li>Escaneia o QR com o WhatsApp do telefone (Definições → Aparelhos ligados).</li>
        </ol>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          O webhook da Evolution é configurado automaticamente para <code>{window.location.origin.replace(':3000', ':3001').replace('crm-frontend', 'crm-backend')}/api/webhooks/evolution</code>.
        </p>
      </div>

      <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Como ligar Instagram + Facebook Messenger</p>
        <ol className="text-xs space-y-1.5 list-decimal pl-4" style={{ color: 'var(--text-secondary)' }}>
          <li>Cria uma <strong>App Meta</strong> em <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--primary)' }}>developers.facebook.com</a>.</li>
          <li>Adiciona os produtos <strong>Messenger</strong> e/ou <strong>Instagram Graph API</strong>.</li>
          <li>Liga a tua Página Facebook (e a conta Instagram Business à página).</li>
          <li>Gera um <strong>Page Access Token</strong> de longa duração (60 dias).</li>
          <li>Configura o webhook URL: <code>{window.location.origin.replace(':3000', ':3001').replace('crm-frontend', 'crm-backend')}/api/webhooks/meta</code></li>
          <li>Verify token: define <code>META_VERIFY_TOKEN</code> nas vars de ambiente do backend (qualquer string secreta) e usa a mesma string na configuração do webhook na Meta.</li>
          <li>Subscreve os campos: <strong>messages, messaging_postbacks, message_deliveries, message_reads</strong>.</li>
          <li>Subscreve a tua Página ao webhook.</li>
          <li>Volta aqui e configura os cards de Instagram/Facebook com Page Access Token + Page ID (e Instagram Business Account ID para Instagram).</li>
        </ol>
      </div>

      <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Como ligar TikTok Lead Forms</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
          <strong>Nota:</strong> a TikTok <strong>não tem API pública de DMs</strong>. Só é possível receber leads gerados via Lead Forms dos anúncios TikTok.
        </p>
        <ol className="text-xs space-y-1.5 list-decimal pl-4" style={{ color: 'var(--text-secondary)' }}>
          <li>No TikTok Ads Manager → Tools → Events Manager → <strong>Lead Generation</strong>.</li>
          <li>Configura webhook URL: <code>{window.location.origin.replace(':3000', ':3001').replace('crm-frontend', 'crm-backend')}/api/webhooks/tiktok</code></li>
          <li>Quando alguém preencher um Lead Form num anúncio teu, será automaticamente criado um lead no CRM.</li>
        </ol>
      </div>

      <div className="card p-4" style={{ background: 'var(--surface-2)' }}>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Outras integrações</p>
        <ul className="text-xs space-y-1 list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
          <li><strong>WhatsApp Cloud (Meta)</strong>: alternativa ao QR via API oficial. Precisa de número Business + aprovação Meta.</li>
          <li><strong>Email SMTP</strong>: Gmail (app password), Outlook, SendGrid, ou outro servidor SMTP.</li>
        </ul>
      </div>

      {editing && (
        <ConfigModal
          def={editing.def}
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {testing && <TestSendModal type={testing} onClose={() => setTesting(null)} />}
      {showEvoConnect && (
        <EvolutionConnectModal
          existing={items.find((i) => i.type === 'WEBHOOK' && i.name?.toLowerCase().includes('evolution')) || null}
          onClose={() => setShowEvoConnect(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
