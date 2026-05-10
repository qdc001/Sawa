import { useEffect, useState } from 'react';
import {
  Plus, X, Loader2, Trash2, Edit3, Check, KeyRound, UserCheck, UserX,
  Crown, ShieldCheck, UserCog, User as UserIcon, Mail, Phone,
} from 'lucide-react';
import api, { User } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', AGENT: 'Agente',
};
const ROLE_COLORS: Record<string, { bg: string; fg: string; icon: any }> = {
  OWNER: { bg: '#FEF3C7', fg: '#92400E', icon: Crown },
  ADMIN: { bg: '#EEF2FF', fg: '#4338CA', icon: ShieldCheck },
  MANAGER: { bg: '#D1FAE5', fg: '#065F46', icon: UserCog },
  AGENT: { bg: '#F3F4F6', fg: '#374151', icon: UserIcon },
};

function InviteModal({ onClose, onCreated, currentRole }: {
  onClose: () => void; onCreated: (u: User) => void; currentRole: string;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('AGENT');
  const [loading, setLoading] = useState(false);

  const generatePwd = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setPassword(p);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) { toast.error('Todos os campos obrigatorios'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/users', { name, email, password, role });
      toast.success('Membro convidado. Partilha as credenciais com ele.');
      onCreated(data);
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Convidar membro</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Cria a conta com password temporaria. Partilha as credenciais com o membro para ele entrar.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="input-base" required />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" className="input-base" required />
          <div>
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 6)" className="input-base" required />
              <button type="button" onClick={generatePwd} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Gerar password aleatoria">
                <KeyRound size={14} />
              </button>
            </div>
          </div>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base">
            <option value="AGENT">Agente — acesso basico</option>
            <option value="MANAGER">Manager — gere leads e equipa</option>
            <option value="ADMIN">Admin — quase tudo excepto eliminar workspace</option>
            {currentRole === 'OWNER' && <option value="OWNER">Owner — controlo total</option>}
          </select>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
            <button type="submit" disabled={loading} className="btn btn-primary flex-1 py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Convidar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [pwd, setPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setPwd(p);
  };

  const handleSubmit = async () => {
    if (pwd.length < 6) { toast.error('Password tem de ter pelo menos 6 caracteres'); return; }
    setLoading(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword: pwd });
      toast.success('Password actualizada. Partilha com o membro.');
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Repor password de {user.name}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex gap-2 mb-3">
          <input value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Nova password" className="input-base" />
          <button type="button" onClick={generate} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            <KeyRound size={14} />
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Repor'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/users').then(({ data }) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Erro a carregar equipa'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const isOwner = me?.role === 'OWNER';
  const canManage = isOwner || me?.role === 'ADMIN';

  const handleChangeRole = async (u: User, role: string) => {
    try {
      const { data } = await api.patch(`/users/${u.id}`, { role });
      setUsers((p) => p.map((x) => (x.id === u.id ? data : x)));
      toast.success('Role actualizada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const toggleActive = async (u: User) => {
    try {
      const { data } = await api.patch(`/users/${u.id}`, { isActive: !(u as any).isActive });
      setUsers((p) => p.map((x) => (x.id === u.id ? data : x)));
      toast.success((data as any).isActive ? 'Activado' : 'Desactivado');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Eliminar o membro "${u.name}"? Esta accao nao pode ser desfeita.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      setUsers((p) => p.filter((x) => x.id !== u.id));
      toast.success('Eliminado');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Equipa</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {users.length} membro{users.length !== 1 ? 's' : ''} na workspace
          </p>
        </div>
        {canManage && (
          <button onClick={() => setInviting(true)} className="btn btn-primary py-2 px-3">
            <Plus size={14} /> Convidar membro
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--surface-2)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Membro</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Contacto</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Ultimo login</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Accoes</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => {
                const RoleIcon = ROLE_COLORS[u.role]?.icon || UserIcon;
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {u.avatar ? (
                          <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                            {u.name?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{u.name} {isMe && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>(eu)</span>}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-1"><Mail size={11} /> {u.email}</div>
                      {u.phone && <div className="flex items-center gap-1 mt-0.5"><Phone size={11} /> {u.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && !isMe ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleChangeRole(u, e.target.value)}
                          className="text-xs px-2 py-1 rounded font-medium border-0"
                          style={{ background: ROLE_COLORS[u.role]?.bg, color: ROLE_COLORS[u.role]?.fg }}
                        >
                          {isOwner && <option value="OWNER">Owner</option>}
                          <option value="ADMIN">Admin</option>
                          <option value="MANAGER">Manager</option>
                          <option value="AGENT">Agente</option>
                        </select>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded font-medium inline-flex items-center gap-1"
                          style={{ background: ROLE_COLORS[u.role]?.bg, color: ROLE_COLORS[u.role]?.fg }}>
                          <RoleIcon size={11} /> {ROLE_LABELS[u.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                        background: u.isActive ? '#D1FAE5' : '#FEE2E2',
                        color: u.isActive ? '#065F46' : '#991B1B',
                      }}>
                        {u.isActive ? 'Activo' : 'Desactivado'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('pt-PT') : 'Nunca'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && !isMe && (
                          <>
                            <button onClick={() => setResetting(u)} className="p-1.5 rounded hover:bg-slate-100" title="Repor password">
                              <KeyRound size={14} style={{ color: 'var(--text-secondary)' }} />
                            </button>
                            <button onClick={() => toggleActive(u)} className="p-1.5 rounded hover:bg-slate-100" title={u.isActive ? 'Desactivar' : 'Activar'}>
                              {u.isActive ? <UserX size={14} style={{ color: '#F59E0B' }} /> : <UserCheck size={14} style={{ color: '#10B981' }} />}
                            </button>
                            {isOwner && (
                              <button onClick={() => handleDelete(u)} className="p-1.5 rounded hover:bg-red-50" title="Eliminar">
                                <Trash2 size={14} style={{ color: '#EF4444' }} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
          Apenas Owner e Admin podem gerir a equipa
        </p>
      )}

      {inviting && (
        <InviteModal
          currentRole={me?.role || 'AGENT'}
          onClose={() => setInviting(false)}
          onCreated={(u) => setUsers((p) => [...p, u])}
        />
      )}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
