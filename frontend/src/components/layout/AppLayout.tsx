import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, GitBranch, Users, MessageSquare, CheckSquare,
  Zap, Bot, BarChart3, FileText, Plug, Settings, LogOut,
  Bell, Search, ChevronDown, Menu, X, UserPlus, Radio, Loader2
} from 'lucide-react';
import { useAuthStore, useUIStore } from '../../store';
import CopilotPanel from '../ai/CopilotPanel';
import DesktopNotifications from '../DesktopNotifications';
import toast from 'react-hot-toast';
import api, { Lead, Contact } from '../../lib/api';
import { useT } from '../../lib/i18n';

const navConfig: { path: string; icon: any; key: string; exact?: boolean }[] = [
  { path: '/', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
  { path: '/pipeline', icon: GitBranch, key: 'nav.pipeline' },
  { path: '/leads', icon: Users, key: 'nav.leads' },
  { path: '/contacts', icon: UserPlus, key: 'nav.contacts' },
  { path: '/inbox', icon: MessageSquare, key: 'nav.inbox' },
  { path: '/tasks', icon: CheckSquare, key: 'nav.tasks' },
  { path: '/automations', icon: Zap, key: 'nav.automations' },
  { path: '/broadcasts', icon: Radio, key: 'nav.broadcasts' },
  { path: '/chatbots', icon: Bot, key: 'nav.chatbots' },
  { path: '/analytics', icon: BarChart3, key: 'nav.analytics' },
  { path: '/templates', icon: FileText, key: 'nav.templates' },
  { path: '/integrations', icon: Plug, key: 'nav.integrations' },
  { path: '/team', icon: Users, key: 'nav.team' },
];

export default function AppLayout() {
  const { user, workspace, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [t] = useT();
  const navItems = navConfig.map((n) => ({ ...n, label: t(n.key) }));

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
          api.get(`/leads?search=${q}&limit=6`),
          api.get(`/contacts?search=${q}&limit=6`),
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
          <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--primary)' }}>
            {workspace?.name?.[0]?.toUpperCase() || 'K'}
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="font-semibold text-sm text-white truncate" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                {workspace?.name || 'KommoCRM'}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)' }}>CRM Platform</p>
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
                background: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
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
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            {sidebarOpen && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{user?.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)' }}>{user?.role}</p>
                </div>
                <button onClick={handleLogout} className="text-gray-500 hover:text-red-400 transition-colors">
                  <LogOut size={15} />
                </button>
              </>
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
