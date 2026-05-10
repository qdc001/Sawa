import { useEffect, useState } from 'react';
import { User as UserIcon, Lock, Building2, Save, Loader2, Eye, EyeOff } from 'lucide-react';
import api, { WorkspaceFull } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

const TIMEZONES = [
  'Africa/Maputo', 'Europe/Lisbon', 'Africa/Johannesburg', 'Africa/Nairobi',
  'America/Sao_Paulo', 'UTC',
];
const CURRENCIES = ['MZN', 'USD', 'EUR', 'ZAR', 'BRL'];

export default function SettingsPage() {
  const { user, updateUser, updateWorkspace } = useAuthStore();
  const [tab, setTab] = useState<'profile' | 'password' | 'workspace'>('profile');

  // Perfil
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [savingProfile, setSavingProfile] = useState(false);

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
  const [savingWs, setSavingWs] = useState(false);

  useEffect(() => {
    api.get('/workspaces/me').then(({ data }) => {
      setWs(data);
      setWsName(data.name || '');
      setWsLogo(data.logo || '');
      setWsTimezone(data.timezone || 'Africa/Maputo');
      setWsCurrency(data.currency || 'MZN');
    }).catch(() => {});
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { data } = await api.patch('/users/me', { name, phone, avatar });
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
      });
      updateWorkspace({ name: data.name, logo: data.logo, timezone: data.timezone, currency: data.currency });
      toast.success('Workspace actualizada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSavingWs(false); }
  };

  const isAdminOrOwner = user?.role === 'OWNER' || user?.role === 'ADMIN';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-6" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Definições</h1>

      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {([
          { v: 'profile', label: 'Perfil', icon: UserIcon },
          { v: 'password', label: 'Password', icon: Lock },
          ...(isAdminOrOwner ? [{ v: 'workspace' as const, label: 'Workspace', icon: Building2 }] : []),
        ] as const).map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.v} onClick={() => setTab(t.v)}
              className="px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors"
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
            {avatar ? (
              <img src={avatar} className="w-20 h-20 rounded-full object-cover" alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            ) : (
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white" style={{ background: 'var(--primary)' }}>
                {name?.[0]?.toUpperCase() || 'U'}
              </div>
            )}
            <div>
              <p className="font-semibold">{user?.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
              <span className="text-xs px-2 py-0.5 rounded inline-block mt-1" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                {user?.role}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input value={user?.email || ''} className="input-base" disabled style={{ background: 'var(--surface-3)', cursor: 'not-allowed' }} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Email nao pode ser alterado</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telefone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+258 84..." className="input-base" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">URL da foto (avatar)</label>
            <input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." className="input-base" />
          </div>
          <button onClick={saveProfile} disabled={savingProfile} className="btn btn-primary py-2 px-4">
            {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
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
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Mínimo 6 caracteres</p>
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
            <label className="block text-sm font-medium mb-1">Logo (URL)</label>
            <input value={wsLogo} onChange={(e) => setWsLogo(e.target.value)} placeholder="https://..." className="input-base" />
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
          </div>
          <button onClick={saveWorkspace} disabled={savingWs} className="btn btn-primary py-2 px-4">
            {savingWs ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />} Guardar
          </button>
        </div>
      )}
    </div>
  );
}
