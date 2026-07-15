import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, GitBranch, Users, MessageSquare, CheckSquare,
  Zap, Bot, BarChart3, FileText, Plug, Settings, LogOut,
  Bell, Search, ChevronDown, Menu, X, UserPlus, Radio, Loader2, Check, Phone,
  ScrollText, Sparkles
} from 'lucide-react';
import { useAuthStore, useUIStore } from '../../store';
import { useTerminology } from '../../lib/terminology';
import { KlaruMark } from '../KlaruLogo';
import CopilotPanel from '../ai/CopilotPanel';
import DesktopNotifications from '../DesktopNotifications';
import toast from 'react-hot-toast';
import api, { Lead, Contact } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useT } from '../../lib/i18n';
import { useIsMobile } from '../../lib/useIsMobile';

// desktopOnly=true esconde este item do menu quando em mobile. A pagina
// continua acessivel por URL directa, mas nao aparece no drawer, porque a
// UX naquele tamanho de ecra e demasiado apertada (drag-and-drop com dedo,
// builders com muitos nos, etc.).
// Sidebar operacional definitiva do Klaru (posicionamento clinico).
// Pipeline (funil comercial) eliminado do menu principal. Rotas /pipeline,
// /leads, /quotes, /calls, /chatbots continuam acessiveis por URL para nao
// quebrar links antigos ou dados existentes, mas nao aparecem em lado nenhum.
const navConfig: { path: string; icon: any; key: string; exact?: boolean; desktopOnly?: boolean }[] = [
  { path: '/', icon: LayoutDashboard, key: 'nav.dashboard', exact: true },
  { path: '/inbox', icon: MessageSquare, key: 'nav.inbox' },
  { path: '/contacts', icon: UserPlus, key: 'nav.contacts' },
  { path: '/tasks', icon: CheckSquare, key: 'nav.tasks' },
  { path: '/automations', icon: Zap, key: 'nav.automations', desktopOnly: true },
  { path: '/analytics', icon: BarChart3, key: 'nav.analytics' },
];

// Itens de menu para o dropdown do avatar (canto superior direito).
// Tudo o que se configura uma vez e raramente se toca.
const userMenuConfig: { path: string; icon: any; key: string }[] = [
  { path: '/team', icon: Users, key: 'nav.team' },
  { path: '/integrations', icon: Plug, key: 'nav.integrations' },
  { path: '/templates', icon: FileText, key: 'nav.templates' },
  { path: '/settings', icon: Settings, key: 'nav.settings' },
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
  const location = useLocation();
  const isMobile = useIsMobile();
  // Em mobile: sidebar comeca fechada (drawer overlay). Em desktop: aberta.
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  // Fechar sidebar automaticamente ao navegar em mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile]);
  // Nas Definições recolhe a barra lateral automaticamente (mais espaço); ao sair,
  // devolve o estado anterior. O botao de menu no topo expande/recolhe a qualquer momento.
  const wasSettingsRef = useRef(false);
  const beforeSettingsOpenRef = useRef(true);
  useEffect(() => {
    const isSettings = location.pathname === '/settings';
    if (isSettings && !wasSettingsRef.current) {
      beforeSettingsOpenRef.current = sidebarOpen;
      setSidebarOpen(false);
    } else if (!isSettings && wasSettingsRef.current) {
      setSidebarOpen(beforeSettingsOpenRef.current);
    }
    wasSettingsRef.current = isSettings;
  }, [location.pathname]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [t] = useT();
  const terms = useTerminology();
  const navItems = navConfig
    .filter((n) => !(isMobile && n.desktopOnly))
    .map((n) => ({
      ...n,
      // Item Contactos usa a label customizada do workspace (Fase 3).
      label: n.key === 'nav.contacts' ? terms.contacts : t(n.key),
    }));

  const changeStatus = async (status: string) => {
    try {
      const res = await api.patch('/users/me', { status });
      updateUser({ status: res.data.status });
      toast.success(`Estado: ${STATUS_LABELS[status] || status}`);
      setShowProfileMenu(false);
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

  // Pesquisa global (partilhada via store para destacar também no kanban)
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
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
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
      {/* Backdrop em mobile quando sidebar aberta */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className="flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden"
        style={{
          width: isMobile ? (sidebarOpen ? 260 : 0) : (sidebarOpen ? 240 : 64),
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 50,
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-3 mb-2" style={{ minHeight: 64 }}>
          {sidebarOpen ? (
            <>
              <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(250,246,238,0.06)' }}>
                <KlaruMark size={24} ringColor="#FAF6EE" dotColor="#C8553D" />
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <p className="font-semibold text-sm text-white truncate" style={{ fontFamily: 'Fraunces, serif', fontSize: 17 }}>
                  {workspace?.name || 'Klaru'}
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)' }}>Onde tudo fica claro.</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-md transition-colors flex-shrink-0 hover:bg-white/10"
                style={{ color: 'var(--sidebar-text)' }}
                title="Recolher menu"
              >
                <X size={16} />
              </button>
            </>
          ) : (
            <button
              onClick={() => setSidebarOpen(true)}
              className="mx-auto p-2 rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--sidebar-text)' }}
              title="Expandir menu"
            >
              <Menu size={18} />
            </button>
          )}
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
          {/* Leizy destacada — camada de inteligencia que atravessa tudo,
              nao mais um modulo. Fica separada do menu operacional para
              comunicar essa distincao visualmente. */}
          <NavLink
            to="/sales-agent"
            className={({ isActive }) =>
              `leizy-attention ${isActive ? 'leizy-active' : ''} flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? 'text-white' : 'text-white/85 hover:text-white'}`
            }
            style={({ isActive }) => ({
              background: isActive
                ? 'linear-gradient(135deg, rgba(200,85,61,0.35), rgba(200,85,61,0.15))'
                : 'linear-gradient(135deg, rgba(200,85,61,0.18), rgba(200,85,61,0.06))',
              border: '1px solid rgba(200,85,61,0.35)',
            })}
            title={!sidebarOpen ? t('nav.salesAgent') : undefined}
          >
            <Sparkles size={18} className="leizy-sparkle flex-shrink-0" style={{ color: '#FFB8A7' }} />
            {sidebarOpen && <span className="truncate">{t('nav.salesAgent')}</span>}
          </NavLink>

          {/* Avatar do utilizador no rodape. Ao carregar abre dropdown para cima
              com selector de estado + itens administrativos + terminar sessao.
              O topbar nao tem avatar duplicado. */}
          <div ref={profileMenuRef} className="relative">
            <button
              onClick={() => setShowProfileMenu((v) => !v)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left"
              style={{ background: showProfileMenu ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)' }}
              title={!sidebarOpen ? user?.name : undefined}
            >
              <div className="relative flex-shrink-0">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'var(--primary)' }}>
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                  style={{ background: STATUS_COLORS[user?.status || 'OFFLINE'], borderColor: 'var(--sidebar-bg)' }}
                />
              </div>
              {sidebarOpen && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{user?.name}</p>
                  <p className="text-xs truncate flex items-center gap-1" style={{ color: 'var(--sidebar-text)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[user?.status || 'OFFLINE'], display: 'inline-block' }} />
                    {STATUS_LABELS[user?.status || 'OFFLINE']}
                  </p>
                </div>
              )}
              {sidebarOpen && (
                <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} style={{ color: 'var(--sidebar-text)' }} />
              )}
            </button>

            {showProfileMenu && (
              <div
                className="absolute bottom-full mb-1 left-0 right-0 rounded-lg shadow-lg py-1 z-50"
                style={{ background: 'var(--sidebar-bg-2, #1F2937)', border: '1px solid rgba(255,255,255,0.1)', minWidth: 220 }}
              >
                <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-sm font-medium text-white truncate">{user?.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--sidebar-text)' }}>{user?.email}</p>
                </div>

                {/* Seccao 'Estado' removida: era ruido para recepcionistas
                    de clinica que estao sempre disponiveis ao balcao. Se
                    algum caso pedir de volta, reactivar com feature flag. */}

                {/* Itens administrativos */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />
                {userMenuConfig.map(({ path, icon: Icon, key }) => (
                  <button
                    key={path}
                    onClick={() => { setShowProfileMenu(false); navigate(path); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 text-left text-white"
                  >
                    <Icon size={14} style={{ color: 'var(--sidebar-text)' }} />
                    {t(key)}
                  </button>
                ))}

                {/* Terminar sessao */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />
                <button
                  onClick={() => { setShowProfileMenu(false); handleLogout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-500/20 text-left"
                  style={{ color: '#FCA5A5' }}
                >
                  <LogOut size={14} />
                  Terminar sessão
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {/* Topbar */}
        <header
          className="flex items-center gap-2 sm:gap-4 flex-shrink-0"
          style={{
            height: 56,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            boxShadow: 'var(--shadow-sm)',
            paddingLeft: isMobile ? 12 : 24,
            paddingRight: isMobile ? 12 : 24,
          }}
        >
          {/* Hamburger em mobile */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-md hover:bg-black/5 flex-shrink-0"
              title="Abrir menu"
            >
              <Menu size={20} style={{ color: 'var(--text-primary)' }} />
            </button>
          )}
          {/* Search */}
          <div ref={searchBoxRef} className={`relative flex-1 ${isMobile ? '' : 'max-w-xs'}`}>
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
                type="search"
                name="sawa-omni-search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
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

          <div className="flex items-center gap-1 sm:gap-2 ml-auto">
            {/* Copilot */}
            <button
              onClick={() => setCopilotOpen(!copilotOpen)}
              className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: copilotOpen ? 'var(--primary)' : 'var(--surface-3)', color: copilotOpen ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
              title="Copilot"
            >
              <span style={{ fontSize: 14 }}>✨</span>
              {!isMobile && <span>Copilot</span>}
            </button>

            {/* Notifications */}
            <DesktopNotifications />
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
        <div
          className="animate-slide-right"
          style={{
            position: 'fixed',
            right: 0,
            top: isMobile ? 0 : 56,
            bottom: 0,
            width: isMobile ? '100%' : 360,
            background: 'var(--surface)',
            borderLeft: '1px solid var(--border)',
            zIndex: 60,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <CopilotPanel onClose={() => setCopilotOpen(false)} />
        </div>
      )}

    </div>
  );
}
