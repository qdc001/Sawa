import { useEffect, useState } from 'react';

export type Lang = 'pt' | 'en';

const dict: Record<string, Record<Lang, string>> = {
  // Comuns
  'common.save': { pt: 'Guardar', en: 'Save' },
  'common.cancel': { pt: 'Cancelar', en: 'Cancel' },
  'common.delete': { pt: 'Eliminar', en: 'Delete' },
  'common.edit': { pt: 'Editar', en: 'Edit' },
  'common.create': { pt: 'Criar', en: 'Create' },
  'common.search': { pt: 'Pesquisar', en: 'Search' },
  'common.loading': { pt: 'A carregar...', en: 'Loading...' },
  'common.error': { pt: 'Erro', en: 'Error' },
  'common.success': { pt: 'Sucesso', en: 'Success' },
  // Login
  'login.title': { pt: 'Iniciar sessão', en: 'Sign in' },
  'login.subtitle': { pt: 'Entre na sua conta para continuar', en: 'Sign in to your account to continue' },
  'login.email': { pt: 'Email', en: 'Email' },
  'login.password': { pt: 'Palavra-passe', en: 'Password' },
  'login.forgotPassword': { pt: 'Esqueceu?', en: 'Forgot?' },
  'login.signIn': { pt: 'Entrar', en: 'Sign in' },
  'login.noAccount': { pt: 'Não tem conta?', en: "Don't have an account?" },
  'login.createAccount': { pt: 'Criar conta', en: 'Create account' },
  'login.2faPrompt': { pt: 'Insere o código do teu autenticador', en: 'Enter the code from your authenticator' },
  // Settings
  'settings.title': { pt: 'Definições', en: 'Settings' },
  'settings.profile': { pt: 'Perfil', en: 'Profile' },
  'settings.preferences': { pt: 'Preferências', en: 'Preferences' },
  'settings.password': { pt: 'Password', en: 'Password' },
  'settings.workspace': { pt: 'Workspace', en: 'Workspace' },
  'settings.audit': { pt: 'Auditoria', en: 'Audit' },
  'settings.sessions': { pt: 'Sessões', en: 'Sessions' },
  'settings.security': { pt: 'Segurança', en: 'Security' },
  'settings.language': { pt: 'Idioma', en: 'Language' },
  'settings.theme': { pt: 'Tema', en: 'Theme' },
  'settings.themeLight': { pt: 'Claro', en: 'Light' },
  'settings.themeDark': { pt: 'Escuro', en: 'Dark' },
  'settings.notifications': { pt: 'Notificações', en: 'Notifications' },
  'settings.emailTemplates': { pt: 'Templates de email', en: 'Email templates' },
  // Sidebar
  'nav.dashboard': { pt: 'Início', en: 'Home' },
  'nav.pipeline': { pt: 'Pipeline', en: 'Pipeline' },
  'nav.leads': { pt: 'Leads', en: 'Leads' },
  'nav.contacts': { pt: 'Contactos', en: 'Contacts' },
  'nav.products': { pt: 'Produtos', en: 'Products' },
  'nav.quotes': { pt: 'Propostas', en: 'Quotes' },
  'nav.sectorTemplates': { pt: 'Modelos', en: 'Sectors' },
  'nav.billing': { pt: 'Plano', en: 'Plan' },
  'nav.inbox': { pt: 'Comunicação', en: 'Communication' },
  'nav.calls': { pt: 'Chamadas', en: 'Calls' },
  'nav.tasks': { pt: 'Agenda', en: 'Agenda' },
  'nav.automations': { pt: 'Rotinas Automáticas', en: 'Automated Routines' },
  'nav.broadcasts': { pt: 'Broadcasts', en: 'Broadcasts' },
  'nav.chatbots': { pt: 'Chatbots', en: 'Chatbots' },
  'nav.salesAgent': { pt: 'Leizy', en: 'Leizy' },
  'nav.analytics': { pt: 'Análises', en: 'Analytics' },
  'nav.templates': { pt: 'Templates', en: 'Templates' },
  'nav.integrations': { pt: 'Integrações', en: 'Integrations' },
  'nav.team': { pt: 'Equipa', en: 'Team' },
  'nav.settings': { pt: 'Definições', en: 'Settings' },
  'nav.config': { pt: 'Configuração', en: 'Configuration' },
  // Common extra
  'common.add': { pt: 'Adicionar', en: 'Add' },
  'common.remove': { pt: 'Remover', en: 'Remove' },
  'common.close': { pt: 'Fechar', en: 'Close' },
  'common.confirm': { pt: 'Confirmar', en: 'Confirm' },
  'common.yes': { pt: 'Sim', en: 'Yes' },
  'common.no': { pt: 'Não', en: 'No' },
  'common.all': { pt: 'Todos', en: 'All' },
  'common.none': { pt: 'Nenhum', en: 'None' },
  'common.filter': { pt: 'Filtrar', en: 'Filter' },
  'common.export': { pt: 'Exportar', en: 'Export' },
  'common.import': { pt: 'Importar', en: 'Import' },
  'common.duplicate': { pt: 'Duplicar', en: 'Duplicate' },
  'common.test': { pt: 'Testar', en: 'Test' },
  'common.history': { pt: 'Histórico', en: 'History' },
  'common.active': { pt: 'Activa', en: 'Active' },
  'common.inactive': { pt: 'Inactiva', en: 'Inactive' },
  // Lead
  'lead.title': { pt: 'Título', en: 'Title' },
  'lead.value': { pt: 'Valor', en: 'Value' },
  'lead.priority': { pt: 'Prioridade', en: 'Priority' },
  'lead.status': { pt: 'Estado', en: 'Status' },
  'lead.stage': { pt: 'Etapa', en: 'Stage' },
  'lead.pipeline': { pt: 'Pipeline', en: 'Pipeline' },
  'lead.assignedTo': { pt: 'Atribuído a', en: 'Assigned to' },
  'lead.source': { pt: 'Origem', en: 'Source' },
  'lead.createdAt': { pt: 'Criado em', en: 'Created at' },
  'lead.expectedClose': { pt: 'Fecho previsto', en: 'Expected close' },
  'lead.statusOpen': { pt: 'Aberto', en: 'Open' },
  'lead.statusWon': { pt: 'Ganho', en: 'Won' },
  'lead.statusLost': { pt: 'Perdido', en: 'Lost' },
  'lead.priorityLow': { pt: 'Baixa', en: 'Low' },
  'lead.priorityMedium': { pt: 'Média', en: 'Medium' },
  'lead.priorityHigh': { pt: 'Alta', en: 'High' },
  'lead.priorityUrgent': { pt: 'Urgente', en: 'Urgent' },
  'lead.newLead': { pt: 'Novo lead', en: 'New lead' },
  'lead.editLead': { pt: 'Editar lead', en: 'Edit lead' },
  // Tasks
  'task.title': { pt: 'Título', en: 'Title' },
  'task.dueAt': { pt: 'Prazo', en: 'Due' },
  'task.type': { pt: 'Tipo', en: 'Type' },
  'task.statusPending': { pt: 'Pendente', en: 'Pending' },
  'task.statusInProgress': { pt: 'Em curso', en: 'In progress' },
  'task.statusCompleted': { pt: 'Concluída', en: 'Completed' },
  'task.statusCancelled': { pt: 'Cancelada', en: 'Cancelled' },
  'task.typeCall': { pt: 'Chamada', en: 'Call' },
  'task.typeEmail': { pt: 'Email', en: 'Email' },
  'task.typeMeeting': { pt: 'Reunião', en: 'Meeting' },
  'task.typeFollowUp': { pt: 'Seguimento', en: 'Follow-up' },
  'task.typeDemo': { pt: 'Demo', en: 'Demo' },
  'task.typeOther': { pt: 'Outra', en: 'Other' },
  'task.viewList': { pt: 'Lista', en: 'List' },
  'task.viewAgenda': { pt: 'Agenda', en: 'Agenda' },
  'task.viewCalendar': { pt: 'Calendário', en: 'Calendar' },
  'task.viewKanban': { pt: 'Kanban', en: 'Kanban' },
  // Contacts
  'contact.firstName': { pt: 'Primeiro nome', en: 'First name' },
  'contact.lastName': { pt: 'Último nome', en: 'Last name' },
  'contact.email': { pt: 'Email', en: 'Email' },
  'contact.phone': { pt: 'Telefone', en: 'Phone' },
  'contact.company': { pt: 'Empresa', en: 'Company' },
  'contact.position': { pt: 'Cargo', en: 'Position' },
  'contact.country': { pt: 'País', en: 'Country' },
  'contact.city': { pt: 'Cidade', en: 'City' },
  'contact.types.person': { pt: 'Pessoa', en: 'Person' },
  'contact.types.company': { pt: 'Empresa', en: 'Company' },
  // Inbox
  'inbox.searchPlaceholder': { pt: 'Pesquisar conversa...', en: 'Search conversation...' },
  'inbox.allChannels': { pt: 'Todos os canais', en: 'All channels' },
  'inbox.unread': { pt: 'Não lidas', en: 'Unread' },
  'inbox.starred': { pt: 'Favoritas', en: 'Starred' },
  'inbox.archived': { pt: 'Arquivadas', en: 'Archived' },
  'inbox.notes': { pt: 'Notas internas', en: 'Internal notes' },
  'inbox.assignTo': { pt: 'Atribuir a', en: 'Assign to' },
  // Dashboard
  'dashboard.kpiOpen': { pt: 'Leads abertos', en: 'Open leads' },
  'dashboard.kpiWon': { pt: 'Ganhos', en: 'Won' },
  'dashboard.kpiContacts': { pt: 'Contactos', en: 'Contacts' },
  'dashboard.kpiTasks': { pt: 'Tarefas pendentes', en: 'Pending tasks' },
  'dashboard.revenue': { pt: 'Receita', en: 'Revenue' },
  'dashboard.conversion': { pt: 'Conversão', en: 'Conversion' },
  'dashboard.forecast': { pt: 'Previsão', en: 'Forecast' },
  'dashboard.goals': { pt: 'Metas', en: 'Goals' },
  // Automations / Chatbots
  'auto.when': { pt: 'QUANDO', en: 'WHEN' },
  'auto.if': { pt: 'SE', en: 'IF' },
  'auto.then': { pt: 'ENTÃO', en: 'THEN' },
  'auto.advanced': { pt: 'AVANÇADO', en: 'ADVANCED' },
  'auto.addCondition': { pt: 'Adicionar condição', en: 'Add condition' },
  'auto.addAction': { pt: 'Adicionar acção', en: 'Add action' },
  'chatbot.newChatbot': { pt: 'Novo Chatbot', en: 'New Chatbot' },
  'chatbot.templates': { pt: 'Templates', en: 'Templates' },
};

const LANG_KEY = 'kommo:lang';

export function getLang(): Lang {
  return (localStorage.getItem(LANG_KEY) as Lang) || 'pt';
}

export function setLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  window.dispatchEvent(new CustomEvent('lang-changed'));
}

export function t(key: string, lang?: Lang): string {
  const l = lang || getLang();
  return dict[key]?.[l] || dict[key]?.pt || key;
}

export function useT(): [(key: string) => string, Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(getLang);
  useEffect(() => {
    const handler = () => setLangState(getLang());
    window.addEventListener('lang-changed', handler);
    return () => window.removeEventListener('lang-changed', handler);
  }, []);
  return [(key) => t(key, lang), lang, setLang];
}
