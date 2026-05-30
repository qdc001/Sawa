import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, GitBranch, Users, MessageSquare, CheckSquare,
  Zap, Bot, BarChart3, FileText, Plug, Settings, LogOut,
  Bell, Search, ChevronDown, Menu, X, UserPlus, Radio, Loader2, Check, Phone,
  Package, ScrollText
} from 'lucide-react';
import { useAuthStore, useUIStore } from '../../store';
import { SawaMark } from '../SawaLogo';
import CopilotPanel from '../ai/CopilotPanel';
import DesktopNotifications from '../DesktopNotifications';
import toast from 'react-hot-toast';
import api, { Lead, Contact } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useT } from '../../lib/i18n';

const navConfig: { path: string; icon: any; key: string; exact?: boolean }[] = [
  { path: '/', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
  { path: '/pipeline', icon: GitBranch, key: 'nav.pipeline' },
  { path: '/leads', icon: Users, key: 'nav.leads' },
  { path: '/contacts', icon: UserPlus, key: 'nav.contacts' },
  { path: '/products', icon: Package, key: 'nav.products' },
  { path: '/quotes', icon: ScrollText, key: 'nav.quotes' },
  { path: '/inbox', icon: MessageSquare, key: 'nav.inbox' },
  { path: '/calls', icon: Phone, key: 'nav.calls' },
  { path: '/tasks', icon: CheckSquare, key: 'nav.tasks' },
  { path: '/automations', icon: Zap, key: 'nav.automations' },
  { path: '/broadcasts', icon: Radio, key: 'nav.broadcasts' },
  { path: '/chatbots', icon: Bot, key: 'nav.chatbots' },
  { path: '/analytics', icon: BarChart3, key: 'nav.analytics' },
  { path: '/templates', icon: FileText, key: 'nav.templates' },
  { path: '/integrations', icon: Plug, key: 'nav.integrations' },
  { path: '/team', icon: Users, key: 'nav.team' },
];

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#10B981', AWAY: '#F59E0B', BUSY: '#EF4444', DND: '#7C3AED', OFFLINE: '#64748B',
};
const STATUS_LABELS: Record<string, string> = {
  ONLINE: 'Online', AWAY: 'Ausente', BUSY: 'Ocupado', DND: 'Não incomodar', OFFLINE: 'Offline',
};

export default function AppLayout() {
  const { user, workspace, logout, updateUser, updateWorkspace } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [t] = useT();
  const navItems = navConfig.map((n) => ({ ...n, label: t(n.key) }));

  const changeStatus = async (status: string) => {
    try {
      const res = await api.patch('/users/me', { status });
      updateUser({ status: res.data.status });
      toast.success(`Estado: ${STATUS_LABELS[status] || status}`);
      setShowStatusMenu(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro');
    }
  };

  // Banner de desconexão Evolution
  const [evoDown, setEvoDown] = useState<{ minutes: number; message: string } | null>(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onDown = (data: any) => setEvoDown({ minutes: data.minutesDown || 0, message: data.message || 'WhatsApp desligado' });
    const onState = (data: any) => { if (data.state === 'open' || data.recovered) setEvoDown(null); };
    // Quando OWNER/ADMIN actualiza as Definições do workspace, todos os membros
    // ligados recebem o evento. Fazemos refetch completo (em vez de só aplicar o
    // payload do evento) para garantir que campos novos do schema também entram.
    const onWsUpdate = async (ws: any) => {
      if (ws) updateWorkspace(ws);
      try {
        const { data: fresh } = await api.get('/workspaces/me');
        if (fresh) updateWorkspace(fresh);
      } catch {}
    };
    socket.on('evolution:disconnected', onDown);
    socket.on('evolution:state', onState);
    socket.on('workspace:updated', onWsUpdate);
    return () => {
      socket.off('evolution:disconnected', onDown);
      socket.off('evolution:state', onState);
      socket.off('workspace:updated', onWsUpdate);
    };
  }, [updateWorkspace]);

  // Pesquisa global (partilhada via store para destacar tambem no kanban)
  const { globalSearchQuery: query, setGlobalSearchQuery: setQuery } = useUIStore();
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ leads: Lead[]; contacts: Contact[] }>({ leads: [], contacts: [] });
  const [showResults, setShowResults] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = () => {
    logout();
    toast.success('Sessão terminada');
    navigate('/login');
  };

  // Pesquisa com debounce
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults({ leads: [], contacts: [] });
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const q = encodeURIComponent(query.trim());
        const [leadsRes, contactsRes] = await Promise.all([
          api.get(`/leads?search=${q}&limit=15`),
          api.get(`/contacts?search=${q}&limit=20`),
        ]);
        setResults({
          leads: leadsRes.data.leads || [],
          contacts: contactsRes.data.contacts || [],
        });
      } catch {
        // silencioso
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fechar dropdown com clique fora
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Atalho Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowResults(true);
      }
      if (e.key === 'Escape') {
        setShowResults(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goToLead = (lead: Lead) => {
    setShowResults(false);
    setQuery('');
    navigate(`/pipeline?leadId=${lead.id}`);
  };

  const goToContact = (contact: Contact) => {
    setShowResults(false);
    setQuery('');
    navigate(`/contacts?contactId=${contact.id}`);
  };

  const totalResults = results.leads.length + results.contacts.length;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-2)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden"
        style={{
          width: sidebarOpen ? 240 : 64,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 mb-2" style={{ minHeight: 64 }}>
          <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(250,246,238,0.06)' }}>
            <SawaMark size={24} ringColor="#FAF6EE" dotColor="#C8553D" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="font-semibold text-sm text-white truncate" style={{ fontFamily: 'Fraunces, serif', fontSize: 17 }}>
                {workspace?.name || 'Sawa'}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)' }}>Onde nasce o sim.</p>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto p-1 rounded-md transition-colors flex-shrink-0"
            style={{ color: 'var(--sidebar-text)' }}
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {navItems.map(({ path, icon: Icon, label, exact }) => (
            <NavLink
              key={path}
              to={path}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                  isActive
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white'
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'rgba(200, 85, 61, 0.18)' : 'transparent',
                color: isActive ? '#fff' : undefined,
              })}
              title={!sidebarOpen ? label : undefined}
            >
              <Icon size={18} className="flex-shrink-0" style={{ color: 'inherit' }} />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-2 space-y-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-gray-400 hover:text-white'}`
            }
            title={!sidebarOpen ? t('nav.settings') : undefined}
          >
            <Settings size={18} className="flex-shrink-0" />
            {sidebarOpen && <span>{t('nav.settings')}</span>}
          </NavLink>

          {/* User */}
          <div className="relative">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <button onClick={() => setShowStatusMenu(!showStatusMenu)} className="relative flex-shrink-0" title={`Estado: ${STATUS_LABELS[user?.status || 'OFFLINE']}`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: STATUS_COLORS[user?.status || 'OFFLINE'], borderColor: 'var(--sidebar-bg)' }}
                />
              </button>
              {sidebarOpen && (
                <>
                  <button onClick={() => setShowStatusMenu(!showStatusMenu)} className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-medium text-white truncate">{user?.name}</p>
                    <p className="text-xs truncate flex items-center gap-1" style={{ color: 'var(--sidebar-text)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[user?.status || 'OFFLINE'], display: 'inline-block' }} />
                      {STATUS_LABELS[user?.status || 'OFFLINE']}
                    </p>
                  </button>
                  <button onClick={handleLogout} className="text-gray-500 hover:text-red-400 transition-colors">
                    <LogOut size={15} />
                  </button>
                </>
              )}
            </div>
            {showStatusMenu && (
              <div className="absolute bottom-full mb-1 left-0 right-0 rounded-lg shadow-lg py-1 z-30" style={{ background: 'var(--sidebar-bg-2, #1F2937)', border: '1px solid rgba(255,255,255,0.1)' }} onMouseLeave={() => setShowStatusMenu(false)}>
                {Object.keys(STATUS_LABELS).map((s) => (
                  <button key={s} onClick={() => changeStatus(s)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 text-left text-white">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s], display: 'inline-block' }} />
                    {STATUS_LABELS[s]}
                    {user?.status === s && <Check size={12} className="ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center gap-4 px-6 flex-shrink-0" style={{ height: 64, background: 'var(--surface)', borderBottom: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          {/* Search */}
          <div ref={searchBoxRef} className="relative flex-1 max-w-xs">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
            >
              <Search size={14} style={{ color: 'var(--text-muted)' }} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Pesquisar leads, contactos..."
                className="flex-1 bg-transparent outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {searching ? (
                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
              ) : query ? (
                <button
                  onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
                  className="p-0.5 rounded hover:bg-white/40"
                >
                  <X size={12} style={{ color: 'var(--text-muted)' }} />
                </button>
              ) : (
                <kbd className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>Ctrl+K</kbd>
              )}
            </div>

            {/* Dropdown de resultados */}
            {showResults && query.trim().length >= 2 && (
              <div
                className="absolute top-full mt-1 left-0 right-0 z-50 card overflow-hidden"
                style={{ background: 'var(--surface)', maxHeight: 400, overflowY: 'auto' }}
              >
                {searching && totalResults === 0 && (
                  <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    A pesquisar...
                  </div>
                )}

                {!searching && totalResults === 0 && (
                  <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Nenhum resultado para "{query}"
                  </div>
                )}

                {results.leads.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      Leads ({results.leads.length})
                    </div>
                    {results.leads.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => goToLead(lead)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2"
                      >
                        <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {lead.title}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            {lead.pipeline?.name} · {lead.stage?.name}
                            {lead.value ? ` · MZN ${Number(lead.value).toLocaleString()}` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {results.contacts.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      Contactos ({results.contacts.length})
                    </div>
                    {results.contacts.map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => goToContact(contact)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2"
                      >
                        <UserPlus size={14} style={{ color: 'var(--text-muted)' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {contact.firstName} {contact.lastName || ''}
                          </p>
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                            {contact.email || contact.phone || contact.company || '—'}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Copilot */}
            <button onClick={() => setCopilotOpen(!copilotOpen)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{ background: copilotOpen ? 'var(--primary)' : 'var(--surface-3)', color: copilotOpen ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14 }}>✨</span> Copilot
            </button>

            {/* Notifications */}
            <DesktopNotifications />

            {/* Profile */}
            <button className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg transition-colors hover:bg-gray-100">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                {user?.name?.[0]?.toUpperCase()}
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user?.name?.split(' ')[0]}</span>
              <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
        </header>

        {/* Banner de desconexão Evolution */}
        {evoDown && (
          <div className="px-4 py-2 flex items-center gap-3 text-sm" style={{ background: '#FEF3C7', borderBottom: '1px solid #FBBF24', color: '#92400E' }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span className="flex-1">
              <strong>WhatsApp desligado há {evoDown.minutes} min.</strong> {evoDown.message}
            </span>
            <button onClick={() => navigate('/integrations')} className="btn text-xs py-1 px-3" style={{ background: '#F59E0B', color: 'white' }}>
              Re-ligar
            </button>
            <button onClick={() => setEvoDown(null)} className="text-xs underline">Fechar</button>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Copilot Panel */}
      {copilotOpen && (
        <div className="animate-slide-right" style={{ position: 'fixed', right: 0, top: 64, bottom: 0, width: 360, background: 'var(--surface)', borderLeft: '1px solid var(--border)', zIndex: 40, boxShadow: 'var(--shadow-lg)' }}>
          <CopilotPanel onClose={() => setCopilotOpen(false)} />
        </div>
      )}

    </div>
  );
}
