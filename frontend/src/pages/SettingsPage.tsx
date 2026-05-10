import { useEffect, useRef, useState } from 'react';
import {
  User as UserIcon, Lock, Building2, Save, Loader2, Eye, EyeOff,
  Sun, Moon, Upload, Palette, FileDown, History, Download, Activity,
} from 'lucide-react';
import api, { WorkspaceFull, AuditLog } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';
import { useTheme, applyPrimaryColor, setDateFormatPref, getDateFormatPref } from '../lib/theme';

const TIMEZONES = [
  'Africa/Maputo', 'Europe/Lisbon', 'Africa/Johannesburg', 'Africa/Nairobi',
  'America/Sao_Paulo', 'UTC',
];
const CURRENCIES = ['MZN', 'USD', 'EUR', 'ZAR', 'BRL'];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const PRIMARY_PRESETS = ['#6366F1', '#10B981', '#0EA5E9', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];
const STATUS_OPTIONS = [
  { v: 'ONLINE', label: 'Online', color: '#10B981' },
  { v: 'AWAY', label: 'Ausente', color: '#F59E0B' },
  { v: 'BUSY', label: 'Ocupado', color: '#EF4444' },
  { v: 'DND', label: 'Nao incomodar', color: '#6B7280' },
  { v: 'OFFLINE', label: 'Offline', color: '#94A3B8' },
];
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function SettingsPage() {
  const { user, updateUser, updateWorkspace } = useAuthStore();
  const [tab, setTab] = useState<'profile' | 'preferences' | 'password' | 'workspace' | 'audit'>('profile');
  const [theme, setTheme] = useTheme();

  // Perfil
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [status, setStatus] = useState((user as any)?.status || 'ONLINE');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preferencias
  const [datePref, setDatePref] = useState(getDateFormatPref());

  // Password
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  // Workspace
  const [ws, setWs] = useState<WorkspaceFull | null>(null);
  const [wsName, setWsName] = useState('');
  const [wsLogo, setWsLogo] = useState('');
  const [wsTimezone, setWsTimezone] = useState('Africa/Maputo');
  const [wsCurrency, setWsCurrency] = useState('MZN');
  const [wsPrimaryColor, setWsPrimaryColor] = useState('#6366F1');
  const [wsDateFormat, setWsDateFormat] = useState('DD/MM/YYYY');
  const [wsFiscalMonth, setWsFiscalMonth] = useState(1);
  const [savingWs, setSavingWs] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Audit
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Estado actual do utilizador
  const isAdminOrOwner = user?.role === 'OWNER' || user?.role === 'ADMIN';

  useEffect(() => {
    api.get('/workspaces/me').then(({ data }) => {
      setWs(data);
      setWsName(data.name || '');
      setWsLogo(data.logo || '');
      setWsTimezone(data.timezone || 'Africa/Maputo');
      setWsCurrency(data.currency || 'MZN');
      setWsPrimaryColor(data.primaryColor || '#6366F1');
      setWsDateFormat(data.dateFormat || 'DD/MM/YYYY');
      setWsFiscalMonth(data.fiscalYearStartMonth || 1);
      // aplicar cor primaria persistida no servidor
      if (data.primaryColor) applyPrimaryColor(data.primaryColor);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'audit' && isAdminOrOwner) {
      setLoadingLogs(true);
      api.get('/workspaces/audit-logs?limit=200')
        .then(({ data }) => setLogs(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setLoadingLogs(false));
    }
  }, [tab, isAdminOrOwner]);

  const uploadAvatar = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('Avatar maior que 5 MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = `${(import.meta.env as any).VITE_API_URL || ''}${data.url}`;
      setAvatar(url);
      toast.success('Avatar carregado. Clica Guardar para aplicar.');
    } catch { toast.error('Erro a carregar avatar'); }
    finally { setUploading(false); }
  };

  const uploadLogo = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo maior que 5 MB'); return; }
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = `${(import.meta.env as any).VITE_API_URL || ''}${data.url}`;
      setWsLogo(url);
      toast.success('Logo carregado. Clica Guardar para aplicar.');
    } catch { toast.error('Erro a carregar logo'); }
    finally { setUploadingLogo(false); }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { data } = await api.patch('/users/me', { name, phone, avatar, status });
      updateUser({ name: data.name, phone: data.phone, avatar: data.avatar });
      toast.success('Perfil guardado');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSavingProfile(false); }
  };

  const savePassword = async () => {
    if (newPwd !== confirmPwd) { toast.error('Passwords nao coincidem'); return; }
    if (newPwd.length < 6) { toast.error('Password tem de ter pelo menos 6 caracteres'); return; }
    setSavingPwd(true);
    try {
      await api.post('/users/me/change-password', { currentPassword: curPwd, newPassword: newPwd });
      setCurPwd(''); setNewPwd(''); setConfirmPwd('');
      toast.success('Password alterada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSavingPwd(false); }
  };

  const saveWorkspace = async () => {
    setSavingWs(true);
    try {
      const { data } = await api.patch('/workspaces/me', {
        name: wsName, logo: wsLogo, timezone: wsTimezone, currency: wsCurrency,
        primaryColor: wsPrimaryColor, dateFormat: wsDateFormat, fiscalYearStartMonth: wsFiscalMonth,
      });
      updateWorkspace({ name: data.name, logo: data.logo, timezone: data.timezone, currency: data.currency });
      applyPrimaryColor(data.primaryColor);
      setDateFormatPref(data.dateFormat);
      toast.success('Workspace actualizada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSavingWs(false); }
  };

  const handleExport = async () => {
    try {
      const { data } = await api.get('/workspaces/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kommo-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Exportado');
    } catch { toast.error('Erro a exportar'); }
  };

  const tabs = [
    { v: 'profile' as const, label: 'Perfil', icon: UserIcon },
    { v: 'preferences' as const, label: 'Preferencias', icon: Palette },
    { v: 'password' as const, label: 'Password', icon: Lock },
    ...(isAdminOrOwner ? [{ v: 'workspace' as const, label: 'Workspace', icon: Building2 }] : []),
    ...(isAdminOrOwner ? [{ v: 'audit' as const, label: 'Auditoria', icon: History }] : []),
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-6" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Definições</h1>

      <div className="flex gap-1 mb-6 border-b flex-wrap" style={{ borderColor: 'var(--border)' }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.v} onClick={() => setTab(t.v)} className="px-4 py-2 text-sm font-medium flex items-center gap-2"
              style={{
                borderBottom: tab === t.v ? '2px solid var(--primary)' : '2px solid transparent',
                color: tab === t.v ? 'var(--primary)' : 'var(--text-secondary)',
                marginBottom: -1,
              }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'profile' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              {avatar ? (
                <img src={avatar} className="w-20 h-20 rounded-full object-cover" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              ) : (
                <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: 'var(--primary)' }}>
                  {name?.[0]?.toUpperCase() || 'U'}
                </div>
              )}
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center text-white shadow-md"
                style={{ background: 'var(--primary)' }} title="Carregar avatar">
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
            </div>
            <div>
              <p className="font-semibold">{user?.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
              <span className="text-xs px-2 py-0.5 rounded inline-block mt-1" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>{user?.role}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input value={user?.email || ''} className="input-base" disabled style={{ background: 'var(--surface-3)' }} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telefone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+258 84..." className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">URL da foto (alternativa ao upload)</label>
            <input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Status</label>
            <div className="flex gap-1 flex-wrap">
              {STATUS_OPTIONS.map((s) => (
                <button key={s.v} onClick={() => setStatus(s.v)} className="text-xs px-3 py-1.5 rounded font-medium flex items-center gap-1.5"
                  style={{
                    background: status === s.v ? s.color : 'var(--surface-3)',
                    color: status === s.v ? '#fff' : 'var(--text-secondary)',
                  }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: status === s.v ? '#fff' : s.color }} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={saveProfile} disabled={savingProfile} className="btn btn-primary py-2 px-4">
            {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
        </div>
      )}

      {tab === 'preferences' && (
        <div className="card p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Tema</label>
            <div className="flex gap-2">
              <button onClick={() => setTheme('light')} className="btn py-2 px-3"
                style={{ background: theme === 'light' ? 'var(--primary)' : 'var(--surface-3)', color: theme === 'light' ? '#fff' : 'var(--text-primary)' }}>
                <Sun size={14} /> Claro
              </button>
              <button onClick={() => setTheme('dark')} className="btn py-2 px-3"
                style={{ background: theme === 'dark' ? 'var(--primary)' : 'var(--surface-3)', color: theme === 'dark' ? '#fff' : 'var(--text-primary)' }}>
                <Moon size={14} /> Escuro
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Formato de data preferido</label>
            <select value={datePref} onChange={(e) => { setDatePref(e.target.value); setDateFormatPref(e.target.value); toast.success('Guardado'); }} className="input-base">
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Esta preferencia e local. Para mudar para todos os utilizadores, edita na Workspace.</p>
          </div>
        </div>
      )}

      {tab === 'password' && (
        <div className="card p-6 space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium mb-1">Password actual</label>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} value={curPwd} onChange={(e) => setCurPwd(e.target.value)} className="input-base" />
              <button onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1">
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Nova password</label>
            <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirmar nova password</label>
            <input type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="input-base" />
          </div>
          <button onClick={savePassword} disabled={savingPwd || !curPwd || !newPwd} className="btn btn-primary py-2 px-4">
            {savingPwd ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />} Alterar password
          </button>
        </div>
      )}

      {tab === 'workspace' && isAdminOrOwner && (
        <div className="card p-6 space-y-4">
          {ws?._count && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Membros', value: ws._count.users },
                { label: 'Leads', value: ws._count.leads },
                { label: 'Contactos', value: ws._count.contacts },
              ].map((s) => (
                <div key={s.label} className="p-3 rounded text-center" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>{s.value}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Nome da workspace</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} className="input-base" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Logo</label>
            <div className="flex items-center gap-3">
              {wsLogo && <img src={wsLogo} className="w-12 h-12 rounded object-cover" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
              <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Carregar
              </button>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              <input value={wsLogo} onChange={(e) => setWsLogo(e.target.value)} placeholder="ou URL externa" className="input-base flex-1" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Cor primária</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={wsPrimaryColor} onChange={(e) => setWsPrimaryColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer border-0" />
              <div className="flex gap-1">
                {PRIMARY_PRESETS.map((c) => (
                  <button key={c} onClick={() => setWsPrimaryColor(c)} className="w-7 h-7 rounded-full" style={{ background: c, border: wsPrimaryColor === c ? '3px solid var(--text-primary)' : '1px solid var(--border)' }} />
                ))}
              </div>
              <button onClick={() => applyPrimaryColor(wsPrimaryColor)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)' }}>
                Pre-visualizar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <select value={wsTimezone} onChange={(e) => setWsTimezone(e.target.value)} className="input-base">
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Moeda</label>
              <select value={wsCurrency} onChange={(e) => setWsCurrency(e.target.value)} className="input-base">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Formato de data</label>
              <select value={wsDateFormat} onChange={(e) => setWsDateFormat(e.target.value)} className="input-base">
                {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mes inicio do ano fiscal</label>
              <select value={wsFiscalMonth} onChange={(e) => setWsFiscalMonth(Number(e.target.value))} className="input-base">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={saveWorkspace} disabled={savingWs} className="btn btn-primary py-2 px-4">
              {savingWs ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />} Guardar
            </button>
            <button onClick={handleExport} className="btn py-2 px-4" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              <FileDown size={14} /> Exportar tudo (JSON)
            </button>
          </div>
        </div>
      )}

      {tab === 'audit' && isAdminOrOwner && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><History size={16} /> Logs de auditoria</h3>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ultimas 200 alteracoes</span>
          </div>
          {loadingLogs ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem logs ainda</p>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 p-2 rounded text-xs hover:bg-slate-50">
                  <Activity size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <div className="flex-1">
                    <p style={{ color: 'var(--text-primary)' }}>
                      <strong>{l.userName || 'Sistema'}</strong> · {l.description}
                    </p>
                    <p style={{ color: 'var(--text-muted)' }}>
                      {l.entity}{l.entityId ? ` (${l.entityId.slice(0, 8)})` : ''} · {new Date(l.createdAt).toLocaleString('pt-PT')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
