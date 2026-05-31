import { useEffect, useState } from 'react';
import {
  Plus, X, Loader2, Trash2, Edit3, Check, KeyRound, UserCheck, UserX,
  Crown, ShieldCheck, UserCog, User as UserIcon, Mail, Phone, Users as UsersIcon, Eye, EyeOff,
  StickyNote, Building,
} from 'lucide-react';
import api, { User, Team } from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', AGENT: 'Agente',
};
const ROLE_COLORS: Record<string, { bg: string; fg: string; icon: any }> = {
  OWNER: { bg: '#FEF3C7', fg: '#92400E', icon: Crown },
  ADMIN: { bg: '#F6E3DC', fg: '#4338CA', icon: ShieldCheck },
  MANAGER: { bg: '#D1FAE5', fg: '#065F46', icon: UserCog },
  AGENT: { bg: '#F3F4F6', fg: '#374151', icon: UserIcon },
};

function InviteModal({ onClose, onCreated, currentRole }: {
  onClose: () => void; onCreated: (u: User) => void; currentRole: string;
}) {
  const [mode, setMode] = useState<'email' | 'manual'>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('AGENT');
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const generatePwd = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setPassword(p);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || (mode === 'manual' && !password)) {
      toast.error('Preenche os campos obrigatórios');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'email') {
        const { data } = await api.post('/users/invite-by-email', { name, email, role });
        if (data.emailSent) {
          toast.success('Convite enviado por email');
          onCreated(data.user);
          onClose();
        } else {
          // SMTP não configurado - mostrar link
          setInviteLink(data.inviteLink);
          toast(data.emailError || 'SMTP não configurado. Partilha o link manualmente.', { icon: 'ℹ️' });
        }
      } else {
        const { data } = await api.post('/users', { name, email, password, role });
        toast.success('Membro criado');
        onCreated(data);
        onClose();
      }
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  if (inviteLink) {
    return (
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
        <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-3">Membro criado</h3>
          <div className="p-3 rounded mb-3" style={{ background: '#FEF3C7', color: '#92400E' }}>
            <p className="text-sm font-medium">Email não foi enviado</p>
            <p className="text-xs mt-1">Configura SMTP nas Integrações ou partilha este link com o membro:</p>
          </div>
          <div className="p-2 rounded mb-3" style={{ background: 'var(--surface-2)' }}>
            <code className="text-xs break-all">{inviteLink}</code>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success('Copiado'); }} className="btn btn-primary w-full py-2 mb-2">
            Copiar link
          </button>
          <button onClick={onClose} className="btn w-full py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Fechar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Convidar membro</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex gap-1 mb-3 p-1 rounded" style={{ background: 'var(--surface-2)' }}>
          <button type="button" onClick={() => setMode('email')} className="text-xs px-3 py-1.5 rounded font-medium flex-1"
            style={{ background: mode === 'email' ? 'var(--surface)' : 'transparent', color: 'var(--text-primary)', boxShadow: mode === 'email' ? 'var(--shadow-sm)' : 'none' }}>
            Convidar por email
          </button>
          <button type="button" onClick={() => setMode('manual')} className="text-xs px-3 py-1.5 rounded font-medium flex-1"
            style={{ background: mode === 'manual' ? 'var(--surface)' : 'transparent', color: 'var(--text-primary)', boxShadow: mode === 'manual' ? 'var(--shadow-sm)' : 'none' }}>
            Definir password manual
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          {mode === 'email'
            ? 'O membro recebe um email com link para definir a sua própria password (requer SMTP configurado).'
            : 'Cria a conta com password temporaria. Partilha as credenciais com o membro.'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" className="input-base" required />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" className="input-base" required />
          {mode === 'manual' && (
            <div>
              <div className="flex gap-2">
                <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min. 6)" className="input-base" required />
                <button type="button" onClick={generatePwd} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }} title="Gerar password aleatoria">
                  <KeyRound size={14} />
                </button>
              </div>
            </div>
          )}
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-base">
            <option value="AGENT">Agente — acesso básico</option>
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

function MemberDetailModal({ user, teams, onClose, onChanged }: {
  user: User; teams: Team[]; onClose: () => void; onChanged: () => void;
}) {
  const [internalNotes, setInternalNotes] = useState((user as any).internalNotes || '');
  const [viewOnlyOwn, setViewOnlyOwn] = useState((user as any).viewOnlyOwn || false);
  const [teamId, setTeamId] = useState((user as any).teamId || '');
  const [phone, setPhone] = useState((user as any).phone || '');
  const [digestGroupJid, setDigestGroupJid] = useState((user as any).digestGroupJid || '');
  const [groups, setGroups] = useState<{ jid: string; name: string }[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loading, setLoading] = useState(false);

  // Carregar grupos da Evolution para o selector
  useEffect(() => {
    setLoadingGroups(true);
    api.get('/integrations/evolution/groups')
      .then(({ data }) => setGroups(data.groups || []))
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await api.patch(`/users/${user.id}`, {
        internalNotes, viewOnlyOwn, teamId: teamId || null,
        phone: phone || null,
        digestGroupJid: digestGroupJid || null,
      });
      toast.success('Guardado');
      onChanged();
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Detalhes de {user.name}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Equipa / Departamento</label>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="input-base">
              <option value="">— Sem equipa —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telefone WhatsApp</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base" placeholder="+258 84 ..." />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Usado para envio do digest se não houver grupo configurado.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Grupo WhatsApp para digest diário</label>
            <select value={digestGroupJid} onChange={(e) => setDigestGroupJid(e.target.value)} className="input-base">
              <option value="">— Não enviar para grupo (usa telefone acima) —</option>
              {groups.map((g) => (
                <option key={g.jid} value={g.jid}>{g.name}</option>
              ))}
            </select>
            {loadingGroups ? (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>A carregar grupos...</p>
            ) : groups.length === 0 ? (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Nenhum grupo encontrado na Evolution. Garante que o WhatsApp está ligado e que pertences a algum grupo.</p>
            ) : (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Digest diário é enviado para este grupo (prioridade sobre o telefone).</p>
            )}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={viewOnlyOwn} onChange={(e) => setViewOnlyOwn(e.target.checked)} />
              <span style={{ color: 'var(--text-primary)' }}>Restringir visibilidade aos seus próprios leads/conversas</span>
            </label>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Útil para Agentes que só devem ver o que lhes pertence.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 flex items-center gap-1">
              <StickyNote size={12} /> Notas internas (HR)
            </label>
            <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className="input-base" rows={4} placeholder="Notas privadas sobre o membro (só visíveis para Owner/Admin)" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
          <button onClick={save} disabled={loading} className="btn btn-primary flex-1 py-2">
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamsModal({ teams, onClose, onChanged }: {
  teams: Team[]; onClose: () => void; onChanged: () => void;
}) {
  const [list, setList] = useState<Team[]>(teams);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#C8553D');

  useEffect(() => setList(teams), [teams]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      const { data } = await api.post('/teams', { name: newName.trim(), color: newColor });
      setList((p) => [...p, data]);
      setNewName(''); setNewColor('#C8553D');
      toast.success('Equipa criada');
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const handleSave = async (t: Team) => {
    try {
      await api.patch(`/teams/${t.id}`, { name: t.name, color: t.color });
      onChanged();
    } catch { toast.error('Erro'); }
  };

  const handleDelete = async (t: Team) => {
    if (!confirm(`Eliminar a equipa "${t.name}"? Os membros ficam sem equipa.`)) return;
    try {
      await api.delete(`/teams/${t.id}`);
      setList((p) => p.filter((x) => x.id !== t.id));
      toast.success('Eliminada');
      onChanged();
    } catch { toast.error('Erro'); }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><Building size={16} /> Equipas / Departamentos</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-2 mb-4">
          {list.length === 0 && <p className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>Sem equipas ainda</p>}
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--surface-2)' }}>
              <input type="color" value={t.color}
                onChange={(e) => setList((p) => p.map((x) => (x.id === t.id ? { ...x, color: e.target.value } : x)))}
                onBlur={() => handleSave(list.find((x) => x.id === t.id)!)}
                className="w-8 h-8 rounded cursor-pointer border-0" />
              <input value={t.name}
                onChange={(e) => setList((p) => p.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
                onBlur={() => handleSave(list.find((x) => x.id === t.id)!)}
                className="input-base flex-1" />
              <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                {(t._count?.members ?? t.members?.length ?? 0)} membros
              </span>
              <button onClick={() => handleDelete(t)} className="p-1.5 rounded hover:bg-red-50">
                <Trash2 size={14} style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium">Nova equipa</p>
          <div className="flex items-center gap-2">
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome (ex: Vendas, Suporte)" className="input-base flex-1" />
            <button onClick={handleAdd} className="btn btn-primary py-2 px-3"><Plus size={16} /></button>
          </div>
        </div>
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
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [editingDetails, setEditingDetails] = useState<User | null>(null);
  const [showTeams, setShowTeams] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/users'), api.get('/teams')])
      .then(([u, t]) => {
        setUsers(Array.isArray(u.data) ? u.data : []);
        setTeams(Array.isArray(t.data) ? t.data : []);
      })
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
    if (!confirm(`Eliminar o membro "${u.name}"? Esta acção não pode ser desfeita.`)) return;
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
          <h1 className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>Equipa</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {users.length} membro{users.length !== 1 ? 's' : ''} na workspace
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => setShowTeams(true)} className="btn py-2 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              <Building size={14} /> Equipas ({teams.length})
            </button>
            <button onClick={() => setInviting(true)} className="btn btn-primary py-2 px-3">
              <Plus size={14} /> Convidar membro
            </button>
          </div>
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
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Equipa</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Último login</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Acções</th>
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
                      {(() => {
                        const team = teams.find((t) => t.id === u.teamId);
                        return team ? (
                          <span className="text-xs px-2 py-0.5 rounded font-medium inline-flex items-center gap-1" style={{ background: team.color + '22', color: team.color }}>
                            <Building size={10} /> {team.name}
                          </span>
                        ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {u.viewOnlyOwn && <span title="Visibilidade restrita"><EyeOff size={11} style={{ color: '#F59E0B' }} /></span>}
                        <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                          background: u.isActive ? '#D1FAE5' : '#FEE2E2',
                          color: u.isActive ? '#065F46' : '#991B1B',
                        }}>
                          {u.isActive ? 'Activo' : 'Desactivado'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('pt-PT') : 'Nunca'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <button onClick={() => setEditingDetails(u)} className="p-1.5 rounded hover:bg-slate-100" title="Detalhes (equipa, notas, visibilidade)">
                            <Edit3 size={14} style={{ color: 'var(--text-secondary)' }} />
                          </button>
                        )}
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
      {editingDetails && (
        <MemberDetailModal
          user={editingDetails}
          teams={teams}
          onClose={() => setEditingDetails(null)}
          onChanged={load}
        />
      )}
      {showTeams && <TeamsModal teams={teams} onClose={() => setShowTeams(false)} onChanged={load} />}
    </div>
  );
}
