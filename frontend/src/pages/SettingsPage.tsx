import { useEffect, useRef, useState } from 'react';
import {
  User as UserIcon, Lock, Building2, Save, Loader2, Eye, EyeOff,
  Sun, Moon, Upload, Palette, FileDown, History, Download, Activity,
  Shield, Bell, Globe, Mail, Smartphone, KeyRound, Trash2, X, Check, Plus, RotateCcw,
  FileText as FileTextIcon, Package, LayoutTemplate, CreditCard, Settings,
} from 'lucide-react';
import api, {
  WorkspaceFull, AuditLog, TaskOption,
  DEFAULT_TASK_TYPES, DEFAULT_TASK_PRIORITIES, DEFAULT_TASK_STATUSES, DEFAULT_TASK_RECURRENCES, DEFAULT_TASK_TITLES, DEFAULT_TASK_FIELD_LABELS, TaskFieldLabels,
  AiSalesSuggestion,
} from '../lib/api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';
import { useTheme, applyPrimaryColor, setDateFormatPref, getDateFormatPref } from '../lib/theme';
import { useT, setLang } from '../lib/i18n';
import ProductsPage from './ProductsPage';
import SectorTemplatesPage from './SectorTemplatesPage';
import BillingPage from './BillingPage';

const TIMEZONES = [
  'Africa/Maputo', 'Europe/Lisbon', 'Africa/Johannesburg', 'Africa/Nairobi',
  'America/Sao_Paulo', 'UTC',
];
const CURRENCIES = ['MZN', 'USD', 'EUR', 'ZAR', 'BRL'];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const PRIMARY_PRESETS = ['#C8553D', '#10B981', '#0EA5E9', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];
const STATUS_OPTIONS = [
  { v: 'ONLINE', label: 'Online', color: '#10B981' },
  { v: 'AWAY', label: 'Ausente', color: '#F59E0B' },
  { v: 'BUSY', label: 'Ocupado', color: '#EF4444' },
  { v: 'DND', label: 'Não incomodar', color: '#6B7280' },
  { v: 'OFFLINE', label: 'Offline', color: '#94A3B8' },
];
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function SettingsPage() {
  const { user, updateUser, updateWorkspace } = useAuthStore();
  const [tab, setTab] = useState<'profile' | 'preferences' | 'security' | 'notifications' | 'products' | 'sectors' | 'billing' | 'workspace' | 'emailTemplates' | 'audit'>('profile');
  const [theme, setTheme] = useTheme();
  const useTResult = useT();
  const currentLang = useTResult[1];
  const t = useTResult[0];

  // Perfil
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [status, setStatus] = useState((user as any)?.status || 'ONLINE');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preferências
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
  const [wsPrimaryColor, setWsPrimaryColor] = useState('#C8553D');
  const [wsDateFormat, setWsDateFormat] = useState('DD/MM/YYYY');
  const [wsFiscalMonth, setWsFiscalMonth] = useState(1);
  const [wsAiBrandVoice, setWsAiBrandVoice] = useState('');
  const [wsAutoAssign, setWsAutoAssign] = useState(false);
  const [wsTaskTypes, setWsTaskTypes] = useState<TaskOption[]>([]);
  const [wsTaskPriorities, setWsTaskPriorities] = useState<TaskOption[]>([]);
  const [wsTaskStatuses, setWsTaskStatuses] = useState<TaskOption[]>([]);
  const [wsTaskRecurrences, setWsTaskRecurrences] = useState<TaskOption[]>([]);
  const [wsTaskTitles, setWsTaskTitles] = useState<TaskOption[]>([]);
  const [wsTaskFieldLabels, setWsTaskFieldLabels] = useState<TaskFieldLabels>({});
  const [wsDigestEnabled, setWsDigestEnabled] = useState(false);
  const [wsDigestHour, setWsDigestHour] = useState(7);
  const [wsDigestMinute, setWsDigestMinute] = useState(0);
  const [wsDigestTemplate, setWsDigestTemplate] = useState<any>({});
  const [digestDefaults, setDigestDefaults] = useState<any>({});
  const [digestPreview, setDigestPreview] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testingDigest, setTestingDigest] = useState(false);
  const [wsDigestWeekdays, setWsDigestWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [wsAssignmentNotifyEnabled, setWsAssignmentNotifyEnabled] = useState(true);
  const [testingAssignmentNotify, setTestingAssignmentNotify] = useState(false);
  const [savingWs, setSavingWs] = useState(false);

  // IA Vendedora (Fase 3) - config de runtime
  const [salesAiEnabled, setSalesAiEnabled] = useState(false);
  const [salesAiMode, setSalesAiMode] = useState<'supervised' | 'auto'>('supervised');
  const [salesAiMaxParts, setSalesAiMaxParts] = useState(4);
  const [salesAiHandoffTriggers, setSalesAiHandoffTriggers] = useState<string[]>([]);
  const [salesAiHandoffInput, setSalesAiHandoffInput] = useState('');
  const [savingSalesAi, setSavingSalesAi] = useState(false);
  // Zona de perigo (reset de dados)
  const [resetMsgsLoading, setResetMsgsLoading] = useState(false);
  const [resetDataLoading, setResetDataLoading] = useState(false);
  const [showResetDataModal, setShowResetDataModal] = useState(false);
  const [resetDataConfirm, setResetDataConfirm] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Audit
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // 2FA
  const [twoFAEnabled, setTwoFAEnabled] = useState((user as any)?.twoFactorEnabled || false);
  const [setupSecret, setSetupSecret] = useState('');
  const [setupOtpUrl, setSetupOtpUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePwd, setDisablePwd] = useState('');

  // Notificações email
  const [emailPrefs, setEmailPrefs] = useState<Record<string, boolean>>(
    ((user as any)?.emailPreferences as Record<string, boolean>) || {
      newLead: true, taskOverdue: true, newMessage: false, mention: true,
    }
  );

  // Templates email
  const [systemTemplates, setSystemTemplates] = useState<any[]>([]);

  // Idioma
  const [lang, setLangState] = useState<'pt' | 'en'>(currentLang);

  // Estado actual do utilizador
  const isAdminOrOwner = user?.role === 'OWNER' || user?.role === 'ADMIN';

  useEffect(() => {
    api.get('/workspaces/me').then(({ data }) => {
      setWs(data);
      setWsName(data.name || '');
      setWsLogo(data.logo || '');
      setWsTimezone(data.timezone || 'Africa/Maputo');
      setWsCurrency(data.currency || 'MZN');
      setWsPrimaryColor(data.primaryColor || '#C8553D');
      setWsDateFormat(data.dateFormat || 'DD/MM/YYYY');
      setWsFiscalMonth(data.fiscalYearStartMonth || 1);
      setWsAiBrandVoice(data.aiBrandVoice || '');
      setWsAutoAssign(!!data.autoAssignEnabled);
      // IA Vendedora runtime
      api.get('/sales-agent/runtime-config').then(({ data: rc }) => {
        setSalesAiEnabled(!!rc.aiSalesEnabled);
        setSalesAiMode(rc.aiSalesMode === 'auto' ? 'auto' : 'supervised');
        setSalesAiMaxParts(Number(rc.aiSalesMaxParts) || 4);
        setSalesAiHandoffTriggers(Array.isArray(rc.aiSalesHandoffTriggers) ? rc.aiSalesHandoffTriggers : []);
      }).catch(() => {});
      const tt = Array.isArray(data.taskTypes) && data.taskTypes.length > 0 ? data.taskTypes : DEFAULT_TASK_TYPES;
      const tp = Array.isArray(data.taskPriorities) && data.taskPriorities.length > 0 ? data.taskPriorities : DEFAULT_TASK_PRIORITIES;
      const ts = Array.isArray(data.taskStatuses) && data.taskStatuses.length > 0 ? data.taskStatuses : DEFAULT_TASK_STATUSES;
      const tr = Array.isArray(data.taskRecurrences) && data.taskRecurrences.length > 0 ? data.taskRecurrences : DEFAULT_TASK_RECURRENCES;
      const ttt = Array.isArray(data.taskTitles) && data.taskTitles.length > 0 ? data.taskTitles : DEFAULT_TASK_TITLES;
      setWsTaskTypes(tt);
      setWsTaskPriorities(tp);
      setWsTaskStatuses(ts);
      setWsTaskRecurrences(tr);
      setWsTaskTitles(ttt);
      setWsTaskFieldLabels((data.taskFieldLabels && typeof data.taskFieldLabels === 'object') ? data.taskFieldLabels : {});
      setWsDigestEnabled(!!data.dailyDigestEnabled);
      setWsDigestWeekdays(Array.isArray(data.dailyDigestWeekdays) ? data.dailyDigestWeekdays : [0, 1, 2, 3, 4, 5, 6]);
      setWsAssignmentNotifyEnabled(data.assignmentNotifyEnabled !== false);
      setWsDigestHour(typeof data.dailyDigestHour === 'number' ? data.dailyDigestHour : 7);
      setWsDigestMinute(typeof data.dailyDigestMinute === 'number' ? data.dailyDigestMinute : 0);
      setWsDigestTemplate(data.dailyDigestTemplate && typeof data.dailyDigestTemplate === 'object' ? data.dailyDigestTemplate : {});
      // Carregar template default (para botão "Repor padrão" e placeholders)
      api.get('/workspaces/me/daily-digest/defaults').then(({ data: d }) => setDigestDefaults(d.template || {})).catch(() => {});
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
    if (tab === 'security') {
      setLoadingSessions(true);
      api.get('/users/me/sessions')
        .then(({ data }) => setSessions(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setLoadingSessions(false));
    }
    if (tab === 'emailTemplates' && isAdminOrOwner) {
      api.get('/system-email-templates')
        .then(({ data }) => setSystemTemplates(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [tab, isAdminOrOwner]);

  // 2FA handlers
  const startSetup = async () => {
    try {
      const { data } = await api.post('/users/me/2fa/setup');
      setSetupSecret(data.secret);
      setSetupOtpUrl(data.otpauthUrl);
    } catch { toast.error('Erro'); }
  };
  const enable2FA = async () => {
    try {
      await api.post('/users/me/2fa/enable', { code: verifyCode });
      setTwoFAEnabled(true);
      setSetupSecret(''); setSetupOtpUrl(''); setVerifyCode('');
      toast.success('2FA activada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };
  const disable2FA = async () => {
    try {
      await api.post('/users/me/2fa/disable', { password: disablePwd });
      setTwoFAEnabled(false); setDisablePwd('');
      toast.success('2FA desactivada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
  };

  const reloadSessions = () => {
    api.get('/users/me/sessions').then(({ data }) => setSessions(Array.isArray(data) ? data : [])).catch(() => {});
  };

  const revokeSession = async (id: string) => {
    if (!confirm('Terminar esta sessão?')) return;
    try {
      await api.delete(`/users/me/sessions/${id}`);
      reloadSessions();
      toast.success('Sessão terminada');
    } catch { toast.error('Erro'); }
  };

  const revokeOthers = async () => {
    if (!confirm('Terminar todas as outras sessões?')) return;
    try {
      await api.post('/users/me/sessions/revoke-others');
      reloadSessions();
      toast.success('Outras sessões terminadas');
    } catch { toast.error('Erro'); }
  };

  const saveEmailPrefs = async () => {
    try {
      const { data } = await api.patch('/users/me', { emailPreferences: emailPrefs });
      setEmailPrefs(data.emailPreferences as any);
      toast.success('Preferências guardadas');
    } catch { toast.error('Erro'); }
  };

  const changeLang = async (l: 'pt' | 'en') => {
    setLangState(l);
    setLang(l);
    try {
      await api.patch('/users/me', { language: l });
      toast.success('Idioma actualizado');
    } catch {}
  };

  const saveTemplate = async (type: string, subject: string, body: string, enabled: boolean) => {
    try {
      await api.put(`/system-email-templates/${type}`, { subject, body, enabled });
      toast.success('Template guardado');
      const { data } = await api.get('/system-email-templates');
      setSystemTemplates(Array.isArray(data) ? data : []);
    } catch { toast.error('Erro'); }
  };

  const resetTemplate = async (type: string) => {
    if (!confirm('Repor template ao padrao?')) return;
    try {
      await api.delete(`/system-email-templates/${type}`);
      const { data } = await api.get('/system-email-templates');
      setSystemTemplates(Array.isArray(data) ? data : []);
      toast.success('Reposto');
    } catch { toast.error('Erro'); }
  };

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
    if (newPwd !== confirmPwd) { toast.error('Passwords não coincidem'); return; }
    if (newPwd.length < 6) { toast.error('Password tem de ter pelo menos 6 caracteres'); return; }
    setSavingPwd(true);
    try {
      await api.post('/users/me/change-password', { currentPassword: curPwd, newPassword: newPwd });
      setCurPwd(''); setNewPwd(''); setConfirmPwd('');
      toast.success('Password alterada');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSavingPwd(false); }
  };

  const saveSalesAiConfig = async () => {
    setSavingSalesAi(true);
    try {
      await api.patch('/sales-agent/config', {
        aiSalesEnabled: salesAiEnabled,
        aiSalesMode: salesAiMode,
        aiSalesMaxParts: salesAiMaxParts,
        aiSalesHandoffTriggers: salesAiHandoffTriggers,
      });
      toast.success('IA Vendedora actualizada');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Erro a guardar IA Vendedora');
    } finally {
      setSavingSalesAi(false);
    }
  };

  const addHandoffTrigger = () => {
    const v = salesAiHandoffInput.trim().toLowerCase();
    if (!v) return;
    if (salesAiHandoffTriggers.includes(v)) { setSalesAiHandoffInput(''); return; }
    setSalesAiHandoffTriggers([...salesAiHandoffTriggers, v]);
    setSalesAiHandoffInput('');
  };

  const saveWorkspace = async () => {
    setSavingWs(true);
    try {
      const { data } = await api.patch('/workspaces/me', {
        name: wsName, logo: wsLogo, timezone: wsTimezone, currency: wsCurrency,
        primaryColor: wsPrimaryColor, dateFormat: wsDateFormat, fiscalYearStartMonth: wsFiscalMonth,
        autoAssignEnabled: wsAutoAssign,
        aiBrandVoice: wsAiBrandVoice,
        taskTypes: wsTaskTypes,
        taskPriorities: wsTaskPriorities,
        taskStatuses: wsTaskStatuses,
        taskRecurrences: wsTaskRecurrences,
        taskTitles: wsTaskTitles,
        taskFieldLabels: wsTaskFieldLabels,
        dailyDigestEnabled: wsDigestEnabled,
        dailyDigestWeekdays: wsDigestWeekdays,
        assignmentNotifyEnabled: wsAssignmentNotifyEnabled,
        dailyDigestHour: wsDigestHour,
        dailyDigestMinute: wsDigestMinute,
        dailyDigestTemplate: wsDigestTemplate,
      });
      updateWorkspace({
        name: data.name, logo: data.logo, timezone: data.timezone, currency: data.currency,
        autoAssignEnabled: data.autoAssignEnabled,
        taskTypes: data.taskTypes,
        taskPriorities: data.taskPriorities,
        taskStatuses: data.taskStatuses,
        taskRecurrences: data.taskRecurrences,
        taskTitles: data.taskTitles,
        taskFieldLabels: data.taskFieldLabels,
      } as any);
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

  const handleResetMessages = async () => {
    if (!window.confirm('Apagar TODAS as conversas e mensagens deste workspace? Esta acção e irreversivel.')) return;
    setResetMsgsLoading(true);
    try {
      const { data } = await api.post('/workspaces/reset/messages', { confirm: true });
      toast.success(`${data.messages} mensagens eliminadas.`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao limpar mensagens');
    } finally { setResetMsgsLoading(false); }
  };

  const handleResetData = async () => {
    setResetDataLoading(true);
    try {
      await api.post('/workspaces/reset/data', { confirmation: resetDataConfirm });
      toast.success('Dados repostos. O workspace foi limpo.');
      setShowResetDataModal(false);
      setResetDataConfirm('');
      setTimeout(() => window.location.reload(), 900);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao repor dados');
    } finally { setResetDataLoading(false); }
  };

  const tabs = [
    { v: 'profile' as const, label: t('settings.profile'), icon: UserIcon },
    { v: 'preferences' as const, label: t('settings.preferences'), icon: Palette },
    { v: 'security' as const, label: t('settings.security'), icon: Shield },
    { v: 'notifications' as const, label: t('settings.notifications'), icon: Bell },
    { v: 'products' as const, label: t('nav.products'), icon: Package },
    { v: 'sectors' as const, label: t('nav.sectorTemplates'), icon: LayoutTemplate },
    { v: 'billing' as const, label: t('nav.billing'), icon: CreditCard },
    ...(isAdminOrOwner ? [{ v: 'workspace' as const, label: t('settings.workspace'), icon: Building2 }] : []),
    ...(isAdminOrOwner ? [{ v: 'emailTemplates' as const, label: t('settings.emailTemplates'), icon: FileTextIcon }] : []),
    ...(isAdminOrOwner ? [{ v: 'audit' as const, label: t('settings.audit'), icon: History }] : []),
  ];

  return (
    <div className="p-6">
      <div className="mb-6 pb-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-light)' }}>
          <Settings size={22} style={{ color: 'var(--primary)' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight" style={{ fontFamily: 'Fraunces, serif', color: 'var(--text-primary)' }}>{t('settings.title')}</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{tabs.find((x) => x.v === tab)?.label}</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Navegação lateral */}
        <nav className="w-full md:w-56 flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:sticky md:top-6">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.v;
            return (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-left flex-shrink-0 transition-colors hover:bg-black/5"
                style={{
                  background: active ? 'var(--primary-light)' : undefined,
                  color: active ? 'var(--primary)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={16} className="flex-shrink-0" /> {t.label}
              </button>
            );
          })}
        </nav>

        {/* Conteúdo da secção activa */}
        <div className={`flex-1 min-w-0 w-full ${tab === 'products' || tab === 'sectors' || tab === 'billing' ? '' : 'max-w-2xl'}`}>

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
            <label className="block text-sm font-medium mb-2 flex items-center gap-1"><Globe size={14} /> Idioma</label>
            <div className="flex gap-2">
              <button onClick={() => changeLang('pt')} className="btn py-2 px-3"
                style={{ background: lang === 'pt' ? 'var(--primary)' : 'var(--surface-3)', color: lang === 'pt' ? '#fff' : 'var(--text-primary)' }}>
                Português (MZ)
              </button>
              <button onClick={() => changeLang('en')} className="btn py-2 px-3"
                style={{ background: lang === 'en' ? 'var(--primary)' : 'var(--surface-3)', color: lang === 'en' ? '#fff' : 'var(--text-primary)' }}>
                English
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Formato de data preferido</label>
            <select value={datePref} onChange={(e) => { setDatePref(e.target.value); setDateFormatPref(e.target.value); toast.success('Guardado'); }} className="input-base">
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          {/* Mudar password */}
          <div className="card p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Lock size={16} /> Mudar password</h3>
            <div className="space-y-3 max-w-md">
              <div>
                <label className="block text-sm font-medium mb-1">Password actual</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={curPwd} onChange={(e) => setCurPwd(e.target.value)} className="input-base" autoComplete="new-password" />
                  <button onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1">
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nova password</label>
                <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="input-base" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Confirmar</label>
                <input type={showPwd ? 'text' : 'password'} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className="input-base" autoComplete="new-password" />
              </div>
              <button onClick={savePassword} disabled={savingPwd || !curPwd || !newPwd} className="btn btn-primary py-2 px-4">
                {savingPwd ? <Loader2 size={16} className="animate-spin" /> : <Lock size={14} />} Alterar password
              </button>
            </div>
          </div>

          {/* 2FA */}
          <div className="card p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Shield size={16} /> Autenticação de 2 factores (2FA)</h3>
            {twoFAEnabled ? (
              <div className="space-y-3">
                <div className="p-3 rounded flex items-center gap-2" style={{ background: '#D1FAE5', color: '#065F46' }}>
                  <Check size={14} />
                  <span className="text-sm font-medium">2FA activa</span>
                </div>
                <div className="space-y-2 max-w-md">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Para desactivar, indica a tua password.</p>
                  <input type="password" value={disablePwd} onChange={(e) => setDisablePwd(e.target.value)} placeholder="Password actual" className="input-base" autoComplete="new-password" />
                  <button onClick={disable2FA} disabled={!disablePwd} className="btn py-2 px-3" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                    Desactivar 2FA
                  </button>
                </div>
              </div>
            ) : !setupSecret ? (
              <div>
                <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                  Adiciona uma camada extra de segurança. Vais precisar de uma app autenticadora (Google Authenticator, Authy, 1Password, etc.).
                </p>
                <button onClick={startSetup} className="btn btn-primary py-2 px-3">
                  <Smartphone size={14} /> Activar 2FA
                </button>
              </div>
            ) : (
              <div className="space-y-3 max-w-md">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Abre a tua app autenticadora e adiciona esta conta. Podes escanear o QR code ou inserir o código manualmente.
                </p>
                <div className="flex justify-center p-4 rounded" style={{ background: '#fff' }}>
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupOtpUrl)}`} alt="QR" />
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Código manual (caso não consigas usar QR):</p>
                  <code className="text-xs p-2 rounded block break-all" style={{ background: 'var(--surface-3)' }}>{setupSecret}</code>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Insere o código de 6 digitos da app</label>
                  <input value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="input-base text-center" style={{ letterSpacing: 4, fontSize: 18 }} placeholder="123456" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setSetupSecret(''); setSetupOtpUrl(''); }} className="btn flex-1 py-2" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>Cancelar</button>
                  <button onClick={enable2FA} disabled={verifyCode.length !== 6} className="btn btn-primary flex-1 py-2">Confirmar</button>
                </div>
              </div>
            )}
          </div>

          {/* Sessões */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Smartphone size={16} /> Sessões activas</h3>
              <button onClick={revokeOthers} className="text-xs px-2 py-1 rounded font-medium" style={{ background: '#FEF2F2', color: '#EF4444' }}>
                Terminar todas as outras
              </button>
            </div>
            {loadingSessions ? (
              <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Sem sessões activas</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded" style={{ background: 'var(--surface-2)' }}>
                    <Smartphone size={16} style={{ color: 'var(--text-muted)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {s.device || 'Dispositivo desconhecido'}
                        {s.isCurrent && <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ background: '#D1FAE5', color: '#065F46' }}>Esta sessão</span>}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {s.ip} · Último uso {new Date(s.lastUsedAt).toLocaleString('pt-PT')}
                      </p>
                    </div>
                    {!s.isCurrent && (
                      <button onClick={() => revokeSession(s.id)} className="p-1.5 rounded hover:bg-red-50">
                        <Trash2 size={14} style={{ color: '#EF4444' }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="card p-6 space-y-4">
          <h3 className="font-semibold flex items-center gap-2"><Mail size={16} /> Notificações por email</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Escolhe quando receber emails. Requer integração SMTP configurada nas Integrações para os emails serem enviados.
          </p>
          {[
            { k: 'newLead', label: 'Novo lead atribuido a mim' },
            { k: 'taskOverdue', label: 'Tarefa minha em atraso' },
            { k: 'newMessage', label: 'Nova mensagem em conversa minha' },
            { k: 'mention', label: 'Menção em nota interna' },
          ].map((n) => (
            <label key={n.k} className="flex items-center gap-3 p-3 rounded cursor-pointer" style={{ background: 'var(--surface-2)' }}>
              <input type="checkbox" checked={!!emailPrefs[n.k]} onChange={(e) => setEmailPrefs({ ...emailPrefs, [n.k]: e.target.checked })} />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{n.label}</span>
            </label>
          ))}
          <button onClick={saveEmailPrefs} className="btn btn-primary py-2 px-4">
            <Save size={14} /> Guardar preferências
          </button>
        </div>
      )}

      {tab === 'emailTemplates' && isAdminOrOwner && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Personaliza os emails enviados pelo sistema. Variaveis suportadas: {'{{name}}, {{email}}, {{link}}, {{workspaceName}}, {{leadTitle}}, {{taskTitle}}'}
          </p>
          {systemTemplates.map((t) => (
            <details key={t.type} className="card p-4">
              <summary className="cursor-pointer flex items-center gap-2 font-medium">
                <FileTextIcon size={14} />
                <span>{
                  t.type === 'welcome' ? 'Boas-vindas' :
                  t.type === 'password_reset' ? 'Reposicao de password' :
                  t.type === 'invite' ? 'Convite de membro' :
                  t.type === 'csat' ? 'Pedido de avaliação (CSAT)' :
                  t.type === 'lead_assigned' ? 'Lead atribuido' :
                  t.type === 'task_overdue' ? 'Tarefa em atraso' : t.type
                }</span>
                {t.isDefault && <span className="text-xs px-2 py-0.5 rounded ml-auto" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>Padrao</span>}
              </summary>
              <div className="mt-3 space-y-2">
                <input
                  defaultValue={t.subject}
                  onBlur={(e) => e.target.value !== t.subject && saveTemplate(t.type, e.target.value, t.body, t.enabled)}
                  className="input-base" placeholder="Assunto"
                />
                <textarea
                  defaultValue={t.body}
                  onBlur={(e) => e.target.value !== t.body && saveTemplate(t.type, t.subject, e.target.value, t.enabled)}
                  className="input-base" rows={6} placeholder="Corpo HTML"
                />
                {!t.isDefault && (
                  <button onClick={() => resetTemplate(t.type)} className="text-xs hover:underline" style={{ color: 'var(--primary)' }}>
                    Repor ao padrao
                  </button>
                )}
              </div>
            </details>
          ))}
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
              <label className="block text-sm font-medium mb-1">Mês início do ano fiscal</label>
              <select value={wsFiscalMonth} onChange={(e) => setWsFiscalMonth(Number(e.target.value))} className="input-base">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <label className="block text-sm font-medium mb-1">Voz da marca (IA)</label>
            <textarea
              value={wsAiBrandVoice}
              onChange={(e) => setWsAiBrandVoice(e.target.value)}
              rows={4}
              className="input-base w-full"
              placeholder="Descreve o tom e a personalidade que a IA deve usar ao redigir mensagens. Ex: tom caloroso mas profissional, tratamento por 'você', frases curtas e directas, sem gíria nem travessões. Assina como Equipa Klaru."
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Usada pelo Copilot e pelas sugestões de resposta para escrever no tom da tua marca.
            </p>
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={wsAutoAssign} onChange={(e) => setWsAutoAssign(e.target.checked)} />
              Atribuição automática de conversas (round-robin)
            </label>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Quando uma mensagem nova chega sem responsável, atribui automaticamente ao agente com menos conversas activas.
            </p>
          </div>

          {/* IA Vendedora (Fase 3): runtime config */}
          <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">IA Vendedora</p>
              <button
                onClick={saveSalesAiConfig}
                disabled={savingSalesAi}
                className="btn btn-primary py-1.5 px-3 text-xs"
              >
                {savingSalesAi ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Define se a IA Vendedora actua em todas as conversas (global) ou apenas nas que ligares manualmente no Inbox. Em modo supervisionado, cada sugestao espera aprovacao humana antes de ser enviada.
            </p>

            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={salesAiEnabled} onChange={(e) => setSalesAiEnabled(e.target.checked)} />
              Activar IA Vendedora em todas as conversas
            </label>
            <p className="text-[11px] pl-6" style={{ color: 'var(--text-muted)' }}>
              Se desligado, a IA so actua nas conversas que o utilizador liga no menu da conversa.
            </p>

            <div>
              <label className="block text-sm font-medium mb-1">Modo de operacao</label>
              <select value={salesAiMode} onChange={(e) => setSalesAiMode(e.target.value as 'supervised' | 'auto')} className="input-base">
                <option value="supervised">Supervisionado (humano aprova antes de enviar)</option>
                <option value="auto">Autonomo (envia automaticamente)</option>
              </select>
              {salesAiMode === 'auto' && (
                <p className="text-[11px] mt-1" style={{ color: '#B45309' }}>
                  Atencao: modo autonomo envia directamente para o WhatsApp do lead, sem aprovacao. So usa quando ja tiveres confianca nas respostas da IA.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Numero maximo de mensagens por resposta</label>
              <select value={salesAiMaxParts} onChange={(e) => setSalesAiMaxParts(Number(e.target.value))} className="input-base">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'mensagem' : 'mensagens'}</option>)}
              </select>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                A IA pode fragmentar a resposta em varias mensagens curtas para parecer mais natural.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Palavras que disparam passagem a humano</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {salesAiHandoffTriggers.length === 0 ? (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Nenhuma definida. A IA decide com base no contexto.</p>
                ) : (
                  salesAiHandoffTriggers.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}>
                      {t}
                      <button
                        onClick={() => setSalesAiHandoffTriggers(salesAiHandoffTriggers.filter((x) => x !== t))}
                        className="hover:text-red-500"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={salesAiHandoffInput}
                  onChange={(e) => setSalesAiHandoffInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHandoffTrigger(); } }}
                  placeholder="ex: humano, gerente, reclamar..."
                  className="input-base flex-1 text-sm"
                />
                <button onClick={addHandoffTrigger} className="btn py-1.5 px-3 text-xs" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                  <Plus size={12} /> Adicionar
                </button>
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Quando uma destas palavras aparecer na mensagem do lead, a IA passa imediatamente a conversa a um humano.
              </p>
            </div>

            <SalesAiAuditPanel />
          </div>

          <div className="border-t pt-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold">Opções de tarefas (customizar)</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Personaliza os valores que aparecem nos selectors quando crias/editas uma tarefa. <strong>Atenção:</strong> alterar valores existentes pode quebrar tarefas já criadas.
            </p>
            <OptionListEditor
              title="Títulos (selector no Título da tarefa)"
              options={wsTaskTitles}
              defaults={DEFAULT_TASK_TITLES}
              onChange={setWsTaskTitles}
            />
            <OptionListEditor
              title="Tipos"
              options={wsTaskTypes}
              defaults={DEFAULT_TASK_TYPES}
              onChange={setWsTaskTypes}
            />
            <OptionListEditor
              title="Prioridades"
              options={wsTaskPriorities}
              defaults={DEFAULT_TASK_PRIORITIES}
              onChange={setWsTaskPriorities}
            />

            {/* Renomear labels dos campos do modal de tarefa */}
            <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold mb-1">Nomes dos campos (renomear)</p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                Personaliza como os campos aparecem no modal de tarefa. Deixa vazio para usar o nome padrão.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(['title', 'description', 'type', 'priority', 'dueAt', 'assignee', 'contact'] as const).map((k) => (
                  <div key={k}>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      {DEFAULT_TASK_FIELD_LABELS[k]} <span style={{ color: 'var(--text-muted)' }}>(default)</span>
                    </label>
                    <input
                      value={wsTaskFieldLabels[k] || ''}
                      onChange={(e) => setWsTaskFieldLabels({ ...wsTaskFieldLabels, [k]: e.target.value })}
                      placeholder={DEFAULT_TASK_FIELD_LABELS[k]}
                      className="input-base text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Digest diário de tarefas */}
          <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold">Digest diário de tarefas (WhatsApp)</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Envia automaticamente para cada membro da equipa, à hora definida, um resumo via WhatsApp com as tarefas <strong>atrasadas</strong>, <strong>de hoje</strong> e <strong>de amanhã</strong>. Requer que o membro tenha telefone preenchido na ficha de utilizador e que a Evolution esteja ligada.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={wsDigestEnabled}
                onChange={(e) => setWsDigestEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Activar digest diário</span>
            </label>
            <div>
              <p className="text-[11px] mb-1.5" style={{ color: 'var(--text-muted)' }}>Dias de envio:</p>
              <div className="flex gap-1.5 flex-wrap">
                {([['Dom', 0], ['Seg', 1], ['Ter', 2], ['Qua', 3], ['Qui', 4], ['Sex', 5], ['Sáb', 6]] as [string, number][]).map(([label, day]) => {
                  const active = wsDigestWeekdays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setWsDigestWeekdays(active ? wsDigestWeekdays.filter((d) => d !== day) : [...wsDigestWeekdays, day].sort())}
                      className="btn py-1 px-2 text-[11px] font-medium"
                      style={{
                        background: active ? 'var(--primary)' : 'var(--surface-3)',
                        color: active ? '#fff' : 'var(--text-muted)',
                        border: active ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Hora de envio (Maputo):</label>
              <select value={wsDigestHour} onChange={(e) => setWsDigestHour(Number(e.target.value))} className="input-base text-sm" style={{ width: 'auto' }}>
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
              <span>:</span>
              <select value={wsDigestMinute} onChange={(e) => setWsDigestMinute(Number(e.target.value))} className="input-base text-sm" style={{ width: 'auto' }}>
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                ))}
              </select>
            </div>
            {/* Editor do template */}
            <div className="border-t pt-3 mt-2 space-y-2" style={{ borderColor: 'var(--border)' }}>
              <p className="text-xs font-semibold">Estilo da mensagem</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Edita cada parte. Usa placeholders entre chavetas. Disponíveis em todas as partes: <code>{'{firstName}'}</code>, <code>{'{fullName}'}</code>, <code>{'{date}'}</code>. Nas secções: <code>{'{count}'}</code>, <code>{'{list}'}</code>. No formato de cada linha: <code>{'{title}'}</code>, <code>{'{contact}'}</code>, <code>{'{contactDash}'}</code>, <code>{'{due}'}</code>, <code>{'{dueParen}'}</code>, <code>{'{overdueSuffix}'}</code>. Para <strong>negrito</strong> no WhatsApp usa <code>*{'{title}'}*</code>.
              </p>
              {([
                ['header', 'Saudação'],
                ['overdueHeader', 'Secção Atrasadas'],
                ['todayHeader', 'Secção Hoje'],
                ['tomorrowHeader', 'Secção Amanhã'],
                ['taskLine', 'Formato de cada tarefa'],
                ['footer', 'Rodapé'],
              ] as const).map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>{label} <span style={{ color: 'var(--text-muted)' }}>(default: {digestDefaults[k]})</span></label>
                  <textarea
                    value={wsDigestTemplate[k] ?? ''}
                    onChange={(e) => setWsDigestTemplate({ ...wsDigestTemplate, [k]: e.target.value })}
                    placeholder={digestDefaults[k] || ''}
                    className="input-base text-xs font-mono"
                    rows={k === 'overdueHeader' || k === 'todayHeader' || k === 'tomorrowHeader' ? 2 : 1}
                  />
                </div>
              ))}
              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Espaçamento entre tarefas</label>
                <select
                  className="input-base text-xs"
                  value={wsDigestTemplate.taskSeparator ?? '\n\n'}
                  onChange={(e) => setWsDigestTemplate({ ...wsDigestTemplate, taskSeparator: e.target.value })}
                >
                  <option value={'\n\n'}>Com linha em branco entre tarefas</option>
                  <option value={'\n'}>Sem linha em branco (lista compacta)</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWsDigestTemplate({})}
                  className="btn py-1 px-2 text-[11px]"
                  style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
                >
                  Repor padrão
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setLoadingPreview(true);
                    try {
                      const { data } = await api.post('/workspaces/me/daily-digest/preview', { template: wsDigestTemplate });
                      setDigestPreview(data.message || '(sem tarefas para mostrar)');
                    } catch (e: any) {
                      toast.error(e.response?.data?.message || 'Erro');
                    } finally { setLoadingPreview(false); }
                  }}
                  disabled={loadingPreview}
                  className="btn py-1 px-2 text-[11px]"
                  style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}
                >
                  {loadingPreview ? <Loader2 size={11} className="animate-spin" /> : 'Pré-visualizar'}
                </button>
              </div>
              {digestPreview && (
                <div className="p-3 rounded text-xs whitespace-pre-wrap font-mono" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {digestPreview}
                </div>
              )}
            </div>

            <button
              onClick={async () => {
                setTestingDigest(true);
                try {
                  const { data } = await api.post('/workspaces/me/daily-digest/test');
                  toast.success(`Digest enviado a ${data.sent}/${data.users} membros`);
                } catch (e: any) {
                  toast.error(e.response?.data?.message || 'Erro');
                } finally { setTestingDigest(false); }
              }}
              disabled={testingDigest}
              className="btn py-1.5 px-3 text-xs"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            >
              {testingDigest ? <Loader2 size={12} className="animate-spin" /> : 'Enviar agora (teste)'}
            </button>
          </div>

          <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold">Notificação de atribuição (WhatsApp)</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Quando um contacto ou lead é atribuído a um membro da equipa, esse membro recebe imediatamente uma mensagem WhatsApp no grupo ou número configurado no seu perfil.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={wsAssignmentNotifyEnabled}
                onChange={(e) => setWsAssignmentNotifyEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Activar notificações de atribuição</span>
            </label>
            <button
              onClick={async () => {
                setTestingAssignmentNotify(true);
                try {
                  await api.post('/workspaces/me/assignment-notify/test');
                  toast.success('Mensagem de teste enviada para o teu grupo/número.');
                } catch (e: any) {
                  toast.error(e.response?.data?.message || 'Erro ao enviar teste.');
                } finally { setTestingAssignmentNotify(false); }
              }}
              disabled={testingAssignmentNotify}
              className="btn py-1.5 px-3 text-xs"
              style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
            >
              {testingAssignmentNotify ? <Loader2 size={12} className="animate-spin" /> : 'Enviar notificação de teste'}
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={saveWorkspace} disabled={savingWs} className="btn btn-primary py-2 px-4">
              {savingWs ? <Loader2 size={16} className="animate-spin" /> : <Save size={14} />} Guardar
            </button>
            <button onClick={handleExport} className="btn py-2 px-4" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              <FileDown size={14} /> Exportar tudo (JSON)
            </button>
          </div>

          {/* Zona de perigo */}
          <div className="border-t pt-4 mt-2" style={{ borderColor: 'var(--border)' }}>
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#C8553D' }}>
              <Trash2 size={15} /> Zona de perigo
            </p>
            <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-muted)' }}>
              Acções irreversiveis. Usa com cuidado, sobretudo num workspace com dados reais.
            </p>

            <div className="rounded-lg p-3 mb-3" style={{ border: '1px solid var(--border)' }}>
              <p className="text-sm font-medium">Apagar conversas e mensagens</p>
              <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--text-muted)' }}>
                Elimina todas as conversas e mensagens da Caixa de Entrada. Leads, contactos e tudo o resto ficam intactos.
              </p>
              <button
                onClick={handleResetMessages}
                disabled={resetMsgsLoading}
                className="btn py-1.5 px-3 text-xs"
                style={{ background: 'var(--surface-3)', color: '#C8553D', border: '1px solid #C8553D' }}
              >
                {resetMsgsLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Apagar conversas e mensagens
              </button>
            </div>

            {user?.role === 'OWNER' && (
              <div className="rounded-lg p-3" style={{ border: '1px solid #C8553D' }}>
                <p className="text-sm font-medium">Repor todos os dados (reset)</p>
                <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--text-muted)' }}>
                  Apaga mensagens, conversas, leads, contactos, tarefas, propostas, broadcasts, metas e CSAT. Mantem a tua conta, a equipa, as integrações, as definições e a estrutura (pipelines, etapas, tags, campos e produtos).
                </p>
                <button
                  onClick={() => { setResetDataConfirm(''); setShowResetDataModal(true); }}
                  className="btn py-1.5 px-3 text-xs"
                  style={{ background: '#C8553D', color: '#fff' }}
                >
                  <Trash2 size={12} /> Repor todos os dados...
                </button>
              </div>
            )}
          </div>

          {showResetDataModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => !resetDataLoading && setShowResetDataModal(false)}>
              <div className="rounded-xl p-5 w-full max-w-md" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#C8553D' }}>
                  <Trash2 size={18} />
                  <h3 className="font-semibold">Repor todos os dados</h3>
                </div>
                <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
                  Esta acção e <strong>irreversivel</strong>. Vais apagar todas as mensagens, conversas, leads, contactos, tarefas, propostas, broadcasts, metas e CSAT deste workspace. A conta, a equipa, as integrações, as definições e a estrutura mantem-se.
                </p>
                <p className="text-sm mb-2">Para confirmar, escreve o nome do workspace: <strong>{ws?.name}</strong></p>
                <input
                  autoFocus
                  value={resetDataConfirm}
                  onChange={(e) => setResetDataConfirm(e.target.value)}
                  placeholder={ws?.name || 'Nome do workspace'}
                  className="input-base w-full mb-3"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowResetDataModal(false)} disabled={resetDataLoading} className="btn py-2 px-3 text-sm" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
                    Cancelar
                  </button>
                  <button
                    onClick={handleResetData}
                    disabled={resetDataLoading || resetDataConfirm.trim() !== (ws?.name || '')}
                    className="btn py-2 px-3 text-sm"
                    style={{ background: '#C8553D', color: '#fff', opacity: (resetDataLoading || resetDataConfirm.trim() !== (ws?.name || '')) ? 0.6 : 1 }}
                  >
                    {resetDataLoading ? <Loader2 size={14} className="animate-spin" /> : 'Apagar tudo'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && isAdminOrOwner && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><History size={16} /> Logs de auditoria</h3>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Últimas 200 alterações</span>
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
      {tab === 'products' && <ProductsPage />}
      {tab === 'sectors' && <SectorTemplatesPage />}
      {tab === 'billing' && <BillingPage />}
        </div>
      </div>
    </div>
  );
}

// ── Editor de lista de opções (tipos/prioridades/estados/recorrências) ───
function OptionListEditor({ title, options, defaults, onChange }: {
  title: string;
  options: TaskOption[];
  defaults: TaskOption[];
  onChange: (next: TaskOption[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const update = (i: number, patch: Partial<TaskOption>) => {
    onChange(options.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  };
  const add = () => {
    const value = `OPT_${Date.now()}`;
    onChange([...options, { value, label: 'Nova opção', color: '#94A3B8' }]);
  };
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const arr = [...options]; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; onChange(arr);
  };
  const moveDown = (i: number) => {
    if (i === options.length - 1) return;
    const arr = [...options]; [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; onChange(arr);
  };
  const reset = () => {
    if (confirm(`Repor as opções de "${title}" para os valores padrão?`)) onChange([...defaults]);
  };

  return (
    <div className="card p-3" style={{ background: 'var(--surface-2)' }}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-left"
      >
        <p className="text-sm font-semibold">{title} <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>({options.length})</span></p>
        <span style={{ color: 'var(--text-muted)' }}>{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && (
        <div className="mt-3 space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={o.color || '#94A3B8'}
                onChange={(e) => update(i, { color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer border-0 flex-shrink-0"
              />
              <input
                value={o.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Etiqueta"
                className="input-base text-xs flex-1"
              />
              <input
                value={o.value}
                onChange={(e) => update(i, { value: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                placeholder="VALOR"
                className="input-base text-xs"
                style={{ width: 100 }}
                title="Identificador interno (letras maiúsculas, números e _)"
              />
              <button type="button" onClick={() => moveUp(i)} className="p-1 rounded hover:bg-slate-100" title="Subir" disabled={i === 0}>↑</button>
              <button type="button" onClick={() => moveDown(i)} className="p-1 rounded hover:bg-slate-100" title="Descer" disabled={i === options.length - 1}>↓</button>
              <button type="button" onClick={() => remove(i)} className="p-1 rounded hover:bg-red-50" title="Eliminar">
                <Trash2 size={12} style={{ color: '#EF4444' }} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={add} className="btn text-xs py-1.5 px-3 flex-1" style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              <Plus size={12} /> Adicionar
            </button>
            <button type="button" onClick={reset} className="btn text-xs py-1.5 px-3" style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
              <RotateCcw size={12} /> Repor padrão
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Painel de auditoria da IA Vendedora. Mostra historial de sugestoes
// com filtros por estado, expande detalhe ao clicar. Usado dentro do
// tab Workspace, na seccao IA Vendedora.
function SalesAiAuditPanel() {
  const [items, setItems] = useState<AiSalesSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'EDITED' | 'DISCARDED' | 'FAILED' | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get(`/sales-agent/suggestions?status=${status}&limit=100`)
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; fg: string; label: string }> = {
      PENDING: { bg: '#FEF3C7', fg: '#92400E', label: 'Pendente' },
      APPROVED: { bg: '#DCFCE7', fg: '#166534', label: 'Aprovada' },
      EDITED: { bg: '#DBEAFE', fg: '#1E40AF', label: 'Editada' },
      DISCARDED: { bg: '#F1F5F9', fg: '#64748B', label: 'Descartada' },
      SENT: { bg: '#DCFCE7', fg: '#166534', label: 'Enviada' },
      FAILED: { bg: '#FEE2E2', fg: '#991B1B', label: 'Falhou' },
    };
    const c = map[s] || { bg: 'var(--surface-3)', fg: 'var(--text-muted)', label: s };
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: c.bg, color: c.fg }}>{c.label}</span>;
  };

  const actionLabel = (a: string) => ({
    send_text: 'Responder', send_product: 'Responder + produto', handoff: 'Passar a humano', wait: 'Aguardar',
  } as Record<string, string>)[a] || a;

  return (
    <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Historial de sugestoes</p>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input-base text-xs py-1">
            <option value="all">Todos</option>
            <option value="PENDING">Pendentes</option>
            <option value="APPROVED">Aprovadas</option>
            <option value="EDITED">Editadas</option>
            <option value="DISCARDED">Descartadas</option>
            <option value="FAILED">Falhadas</option>
          </select>
          <button onClick={load} disabled={loading} className="btn py-1 px-2 text-xs" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
            {loading ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          </button>
        </div>
      </div>
      {loading && items.length === 0 ? (
        <div className="text-center py-6"><Loader2 size={16} className="animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Sem sugestoes registadas.</p>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {items.map((s) => {
            const isOpen = expandedId === s.id;
            const contactName = s.contact ? `${s.contact.firstName} ${s.contact.lastName || ''}`.trim() : 'Sem contacto';
            const preview = (s.finalParts && s.finalParts.length > 0 ? s.finalParts : s.parts || [])[0] || '';
            return (
              <div key={s.id} className="rounded border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : s.id)}
                  className="w-full text-left p-2 flex items-center gap-2 hover:bg-slate-50"
                >
                  {statusBadge(s.status)}
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                    {actionLabel(s.action)}
                  </span>
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{contactName}</span>
                  <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }}>{preview.slice(0, 80)}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {new Date(s.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                {isOpen && (
                  <div className="p-3 space-y-2 text-xs" style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                    {s.triggerMessage && (
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Mensagem que disparou: </span>
                        <span className="italic">"{s.triggerMessage.content?.slice(0, 200) || '(sem texto)'}"</span>
                      </div>
                    )}
                    {(s.finalParts && s.finalParts.length > 0 ? s.finalParts : s.parts || []).length > 0 && (
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{s.finalParts && s.finalParts.length > 0 ? 'Enviado:' : 'Sugerido:'}</span>
                        <div className="mt-1 space-y-1">
                          {(s.finalParts && s.finalParts.length > 0 ? s.finalParts : s.parts || []).map((p, i) => (
                            <div key={i} className="px-2 py-1 rounded whitespace-pre-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>{p}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.reasoning && (
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Raciocinio: </span>
                        <span>{s.reasoning}</span>
                      </div>
                    )}
                    {s.principlesUsed && s.principlesUsed.length > 0 && (
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Principios: </span>
                        <span>{s.principlesUsed.join(', ')}</span>
                      </div>
                    )}
                    {s.decidedBy && (
                      <div>
                        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>Decidido por: </span>
                        <span>{s.decidedBy.name}</span>
                        {s.decidedAt && (
                          <span style={{ color: 'var(--text-muted)' }}> em {new Date(s.decidedAt).toLocaleString('pt-PT')}</span>
                        )}
                      </div>
                    )}
                    {s.errorDetail && (
                      <div style={{ color: '#991B1B' }}>
                        <span className="font-medium">Erro: </span>{s.errorDetail}
                      </div>
                    )}
                    {(s.modelUsed || s.promptTokens || s.completionTokens) && (
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {s.modelUsed} · {s.promptTokens || 0} prompt tokens · {s.completionTokens || 0} completion tokens
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
