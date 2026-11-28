// WhatsApp oficial (Cloud API da Meta): credenciais, canal principal,
// modelo de follow-up (para fora da janela de 24 h) e teste de envio.
import { useEffect, useState } from 'react';
import { Loader2, X, MessageCircle, Copy, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

type Status = {
  configured: boolean; isActive?: boolean; webhookUrl: string; provider?: 'meta' | 'ycloud'; ycloudWebhookCreated?: boolean;
  phoneId?: string; businessAccountId?: string; hasToken?: boolean; hasAppSecret?: boolean; hasVerifyToken?: boolean;
  primary?: boolean; fallbackEvolution?: boolean;
  followupTemplate?: { name: string; lang: string; body?: string | null } | null;
  phone?: { display_phone_number?: string; verified_name?: string; quality_rating?: string; messaging_limit_tier?: string; platform_type?: string };
  phoneError?: string;
  templates?: Array<{ name: string; language: string; status: string; category: string; body: string }>;
};

export default function WhatsAppCloudModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ provider: 'ycloud' as 'meta' | 'ycloud', token: '', phoneId: '', businessAccountId: '', verifyToken: '', appSecret: '', primary: false, fallbackEvolution: false, templateName: '', templateLang: 'pt_PT' });
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const load = async () => {
    const { data } = await api.get('/whatsapp/status');
    setSt(data);
    setF((s) => ({
      ...s,
      provider: data.configured ? (data.provider || 'meta') : s.provider,
      phoneId: data.phoneId || '', businessAccountId: data.businessAccountId || '',
      primary: !!data.primary, fallbackEvolution: !!data.fallbackEvolution,
      templateName: data.followupTemplate?.name || '', templateLang: data.followupTemplate?.lang || 'pt_PT',
    }));
  };
  useEffect(() => { load().catch(() => toast.error('Erro a carregar o estado')); }, []);

  const save = async () => {
    if (f.primary && !f.templateName) {
      if (!window.confirm('Sem modelo de follow-up, a Leiz não consegue escrever a quem não respondeu nas últimas 24 h. Guardar mesmo assim?')) return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/whatsapp/configure', f);
      toast.success(data.template?.body ? 'Guardado (modelo encontrado)' : 'Guardado');
      if (f.templateName && !data.template?.body) toast.error('Não encontrei esse modelo na conta da Meta. Confirma o nome e se já está aprovado.');
      setF((s) => ({ ...s, token: '', appSecret: '', verifyToken: '' }));
      await load();
      onSaved();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a guardar');
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.post('/whatsapp/test', { to: testTo });
      if (data.ok) toast.success(data.via === 'cloud-template' ? 'Enviado como modelo (janela de 24 h fechada)' : 'Enviado');
      else toast.error(data.error || 'Falhou');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Erro'); }
    finally { setTesting(false); }
  };

  const copy = (t: string) => { navigator.clipboard.writeText(t).then(() => toast.success('Copiado')).catch(() => {}); };
  const input = 'input w-full text-sm';
  const muted = { color: 'var(--text-muted)' };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#E7F9EE' }}>
              <MessageCircle size={20} style={{ color: '#25D366' }} />
            </div>
            <div>
              <h3 className="text-lg font-bold">WhatsApp oficial</h3>
              <p className="text-xs" style={muted}>Cloud API da Meta</p>
            </div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>

        {!st ? <div className="flex justify-center py-6"><Loader2 className="animate-spin" size={18} /></div> : (
          <div className="space-y-4 text-sm">
            {st.phone && (
              <div className="p-3 rounded-lg text-xs space-y-0.5" style={{ background: 'var(--surface-2)' }}>
                <div><b>{st.phone.verified_name}</b> · {st.phone.display_phone_number}</div>
                <div>Qualidade: <b>{st.phone.quality_rating || '-'}</b> · Limite: <b>{st.phone.messaging_limit_tier || '-'}</b></div>
              </div>
            )}
            {st.phoneError && <div className="text-xs" style={{ color: '#EF4444' }}>{st.phoneError}</div>}

            <div className="space-y-2">
              <p className="font-medium">1. Ligação</p>
              <select className={input} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as any })}>
                <option value="ycloud">YCloud (coexistência: o número continua no telemóvel)</option>
                <option value="meta">Meta directa (o número sai do telemóvel)</option>
              </select>
            </div>

            {f.provider === 'ycloud' ? (
              <div className="space-y-2">
                <p className="font-medium">2. Credenciais da YCloud</p>
                <input className={input} type="password" placeholder={st.hasToken && st.provider === 'ycloud' ? 'API key (guardada — deixa vazio para manter)' : 'API key (YCloud → Developers → API Keys)'} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
                <input className={input} placeholder="Número da empresa com indicativo (ex.: 25884…)" value={f.phoneId} onChange={(e) => setF({ ...f, phoneId: e.target.value })} />
                <p className="text-xs" style={muted}>
                  {st.ycloudWebhookCreated ? '✓ Webhook criado na YCloud.' : 'Ao guardar, o CRM cria sozinho o webhook na YCloud.'} Endereço: <code className="break-all">{st.provider === 'ycloud' ? st.webhookUrl : st.webhookUrl.replace('/webhook', '/ycloud-webhook')}</code>
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="font-medium">2. Webhook (na app da Meta: WhatsApp → Configuração)</p>
                  <div className="flex gap-2 items-center">
                    <code className="text-xs flex-1 break-all">{st.webhookUrl}</code>
                    <button className="btn text-xs py-1 px-2" onClick={() => copy(st.webhookUrl)}><Copy size={12} /></button>
                  </div>
                  <p className="text-xs" style={muted}>Subscreve o campo <b>messages</b>.</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium">Credenciais da Meta</p>
                  <input className={input} type="password" placeholder={st.hasToken ? 'Token permanente (guardado — deixa vazio para manter)' : 'Token permanente (System User)'} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
                  <input className={input} placeholder="Phone Number ID" value={f.phoneId} onChange={(e) => setF({ ...f, phoneId: e.target.value })} />
                  <input className={input} placeholder="WhatsApp Business Account ID (WABA)" value={f.businessAccountId} onChange={(e) => setF({ ...f, businessAccountId: e.target.value })} />
                  <input className={input} type="password" placeholder={st.hasVerifyToken ? 'Token de verificação (guardado)' : 'Token de verificação do webhook (inventa um)'} value={f.verifyToken} onChange={(e) => setF({ ...f, verifyToken: e.target.value })} />
                  <input className={input} type="password" placeholder={st.hasAppSecret ? 'App Secret (guardado)' : 'App Secret (valida que o webhook vem da Meta)'} value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} />
                </div>
              </>
            )}

            <div className="space-y-2">
              <p className="font-medium">3. Modelo de follow-up</p>
              <p className="text-xs" style={muted}>Usado quando passaram mais de 24 h desde a última mensagem do contacto. Tem de ter 2 variáveis: {'{{1}}'} = primeiro nome, {'{{2}}'} = texto da Leiz.</p>
              <div className="flex gap-2">
                <input className={input} placeholder="Nome do modelo (ex.: zn_seguimento)" value={f.templateName} onChange={(e) => setF({ ...f, templateName: e.target.value })} list="wa-templates" />
                <input className="input text-sm w-24" placeholder="pt_PT" value={f.templateLang} onChange={(e) => setF({ ...f, templateLang: e.target.value })} />
              </div>
              <datalist id="wa-templates">
                {(st.templates || []).filter((t) => t.status === 'APPROVED').map((t) => <option key={t.name + t.language} value={t.name}>{t.language}</option>)}
              </datalist>
              {st.followupTemplate?.body && <p className="text-xs p-2 rounded" style={{ background: 'var(--surface-2)' }}>{st.followupTemplate.body}</p>}
              {!!st.templates?.length && (
                <details className="text-xs">
                  <summary className="cursor-pointer">Modelos na conta ({st.templates.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {st.templates.map((t) => <li key={t.name + t.language}><b>{t.name}</b> ({t.language}) · {t.status} · {t.category}</li>)}
                  </ul>
                </details>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-medium">4. Canal</p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={f.primary} onChange={(e) => setF({ ...f, primary: e.target.checked })} />
                <span><b>Usar o WhatsApp oficial como canal principal.</b> Envios e receção passam pela Meta; as mensagens que chegarem pela Evolution são ignoradas (para não duplicar).</span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={f.fallbackEvolution} onChange={(e) => setF({ ...f, fallbackEvolution: e.target.checked })} />
                <span>Se a Meta falhar (erro técnico), tentar pela Evolution. Deixa desligado para não voltar a arriscar restrições.</span>
              </label>
            </div>

            <button onClick={save} disabled={saving} className="btn btn-primary w-full text-sm">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </button>

            {st.configured && (
              <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="font-medium">Teste de envio</p>
                <div className="flex gap-2">
                  <input className={input} placeholder="Número com indicativo (ex.: 25884…)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                  <button onClick={test} disabled={testing || !testTo} className="btn text-xs px-3" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                    {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
                <p className="text-xs" style={muted}>Se o número não te escreveu nas últimas 24 h, sai como modelo de follow-up.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
