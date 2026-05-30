import axios from 'axios';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '') + '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let redirectingTo401 = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Evitar loop: só redirecionar uma vez e se não estiver já em /login
      const path = window.location.pathname;
      if (!redirectingTo401 && path !== '/login' && !path.startsWith('/accept-invite') && !path.startsWith('/reset-password') && !path.startsWith('/forgot-password') && !path.startsWith('/csat')) {
        redirectingTo401 = true;
        localStorage.removeItem('token');
        localStorage.removeItem('auth-store');
        setTimeout(() => { window.location.href = '/login'; }, 50);
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ==================== TYPES ====================

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  phone?: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT';
  workspaceId: string;
  isActive?: boolean;
  status?: 'ONLINE' | 'AWAY' | 'BUSY' | 'DND' | 'OFFLINE';
  internalNotes?: string | null;
  viewOnlyOwn?: boolean;
  teamId?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  color: string;
  members?: Array<{ id: string; name: string; avatar?: string; role: string }>;
  _count?: { members: number };
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  metadata?: any;
  createdAt: string;
  userId?: string | null;
  userName?: string | null;
}

export interface Broadcast {
  id: string;
  name: string;
  channel: string;
  message?: string;
  templateName?: string;
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  createdBy?: { id: string; name: string };
  _count?: { recipients: number };
  recipients?: Array<{
    id: string;
    contactId?: string;
    contact?: { id: string; firstName: string; lastName?: string; whatsapp?: string };
    phone: string;
    status: string;
    error?: string;
    sentAt?: string;
  }>;
}

// Opções customizáveis de tarefas
export interface TaskOption { value: string; label: string; color?: string }

export const DEFAULT_TASK_TYPES: TaskOption[] = [
  { value: 'CALL', label: 'Chamada', color: '#3B82F6' },
  { value: 'EMAIL', label: 'Email', color: '#C8553D' },
  { value: 'MEETING', label: 'Reunião', color: '#10B981' },
  { value: 'FOLLOW_UP', label: 'Seguimento', color: '#F59E0B' },
  { value: 'DEMO', label: 'Demo', color: '#EC4899' },
  { value: 'OTHER', label: 'Outra', color: '#94A3B8' },
];
export const DEFAULT_TASK_PRIORITIES: TaskOption[] = [
  { value: 'LOW', label: 'Baixa', color: '#94A3B8' },
  { value: 'MEDIUM', label: 'Média', color: '#3B82F6' },
  { value: 'HIGH', label: 'Alta', color: '#F59E0B' },
  { value: 'URGENT', label: 'Urgente', color: '#EF4444' },
];
export const DEFAULT_TASK_STATUSES: TaskOption[] = [
  { value: 'PENDING', label: 'Pendente', color: '#94A3B8' },
  { value: 'IN_PROGRESS', label: 'Em curso', color: '#3B82F6' },
  { value: 'COMPLETED', label: 'Concluída', color: '#10B981' },
  { value: 'CANCELLED', label: 'Cancelada', color: '#EF4444' },
];
export const DEFAULT_TASK_RECURRENCES: TaskOption[] = [
  { value: '', label: 'Não se repete' },
  { value: 'DAILY', label: 'Diariamente' },
  { value: 'WEEKLY', label: 'Semanalmente' },
  { value: 'MONTHLY', label: 'Mensalmente' },
];
// Títulos pré-definidos para tarefa — configuráveis em Definições → Workspace.
// Valor = label (são iguais para títulos: a string é o título da tarefa).
export const DEFAULT_TASK_TITLES: TaskOption[] = [
  { value: 'Seguimento', label: 'Seguimento', color: '#C8553D' },
  { value: 'Chamada', label: 'Chamada', color: '#10B981' },
  { value: 'Reunião', label: 'Reunião', color: '#3B82F6' },
];

// Labels customizáveis dos campos do modal de tarefa.
// Cada workspace pode renomear (ex: "Título" → "Categoria").
export interface TaskFieldLabels {
  title?: string;
  description?: string;
  type?: string;
  priority?: string;
  dueAt?: string;
  assignee?: string;
  contact?: string;
}
export const DEFAULT_TASK_FIELD_LABELS: Required<TaskFieldLabels> = {
  title: 'Título',
  description: 'Descrição',
  type: 'Tipo',
  priority: 'Prioridade',
  dueAt: 'Data e hora limite',
  assignee: 'Responsável',
  contact: 'Contacto associado',
};

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  currency: string;
  timezone: string;
  primaryColor?: string;
  dateFormat?: string;
  fiscalYearStartMonth?: number;
  autoAssignEnabled?: boolean;
  taskTypes?: TaskOption[];
  taskPriorities?: TaskOption[];
  taskStatuses?: TaskOption[];
  taskRecurrences?: TaskOption[];
  taskTitles?: TaskOption[];
  taskFieldLabels?: TaskFieldLabels;
  dailyDigestEnabled?: boolean;
  dailyDigestHour?: number;
  dailyDigestMinute?: number;
  dailyDigestTemplate?: DigestTemplate;
  aiBrandVoice?: string | null;
}

export interface DigestTemplate {
  header?: string;
  overdueHeader?: string;
  todayHeader?: string;
  tomorrowHeader?: string;
  taskLine?: string;
  footer?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  stages: Stage[];
  _count?: { leads: number };
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  type: 'REGULAR' | 'WON' | 'LOST';
  pipelineId: string;
}

export interface Lead {
  id: string;
  title: string;
  value?: number;
  currency: string;
  status: 'OPEN' | 'WON' | 'LOST';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  source?: string;
  lostReason?: string;
  expectedCloseAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  stageId: string;
  pipelineId: string;
  workspaceId: string;
  stage: Stage;
  pipeline: Pipeline;
  assignedTo?: User;
  contact?: Contact;
  tags?: { tag: Tag }[];
  tasks?: Task[];
  notes?: Note[];
  messages?: Message[];
  activities?: Activity[];
  _count?: { messages: number; notes: number; files: number };
}

export interface Contact {
  id: string;
  type: 'PERSON' | 'COMPANY';
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  company?: string;
  position?: string;
  avatar?: string;
  address?: string;
  city?: string;
  country?: string;
  createdAt: string;
  tags?: { tag: Tag }[];
  _count?: { leads: number };
}

export interface Message {
  id: string;
  content: string;
  type: string;
  direction: 'INBOUND' | 'OUTBOUND';
  channel: string;
  status: string;
  mediaUrl?: string;
  mediaType?: string;
  readAt?: string | null;
  editedAt?: string | null;
  isInternal?: boolean;
  transcription?: string | null;
  createdAt: string;
  sentBy?: User;
  leadId?: string;
  contactId?: string;
  contact?: { id: string; firstName: string; lastName?: string };
  replyToId?: string | null;
  replyTo?: {
    id: string;
    content: string;
    direction: 'INBOUND' | 'OUTBOUND';
    sentBy?: { name: string };
  } | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE';
  channel: string;
  variables: string[];
}

export interface ConversationMeta {
  id: string;
  contactId: string;
  channel: string | null;
  isArchived: boolean;
  isPinned: boolean;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; avatar?: string } | null;
  tags?: { tag: Tag }[];
}

export interface CsatRequest {
  id: string;
  token: string;
  question: string;
  score: number | null;
  comment: string | null;
  sentAt: string;
  respondedAt: string | null;
  contact?: { id: string; firstName: string; lastName?: string };
  lead?: { id: string; title: string };
  createdBy?: { id: string; name: string };
}

export interface IntegrationItem {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  credentials: any;
  settings: any;
}

export interface WorkspaceFull extends Workspace {
  _count?: { users: number; leads: number; contacts: number };
}

export interface Conversation {
  key: string;
  contact: {
    id: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    avatar?: string;
    type: 'PERSON' | 'COMPANY';
  } | null;
  leadId: string | null;
  channel: string;
  channels?: string[];
  lastMessage: Message;
  unread: number;
  total: number;
  combined?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'FOLLOW_UP' | 'DEMO' | 'OTHER';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueAt?: string;
  completedAt?: string;
  recurrence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
  createdAt: string;
  leadId?: string;
  lead?: { id: string; title: string; pipelineId?: string };
  contactId?: string;
  contact?: { id: string; firstName: string; lastName?: string; phone?: string; whatsapp?: string; avatar?: string };
  assignedToId?: string;
  assignedTo: User;
  parentTaskId?: string | null;
  subtasks?: Task[];
  tags?: { tag: Tag }[];
}

export interface Note {
  id: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  leadId?: string;
  createdBy: User;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Activity {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  user?: User;
  lead?: { id: string; title: string };
}

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT' | 'MULTISELECT' | 'URL' | 'EMAIL' | 'PHONE';

export interface CustomField {
  id: string;
  name: string;
  key: string;
  type: CustomFieldType;
  entity: string;
  options: string[];
  isRequired: boolean;
  position: number;
}

export interface CustomFieldValue {
  id: string;
  value: string;
  fieldId: string;
  field?: CustomField;
  leadId?: string;
  contactId?: string;
}

export interface DashboardData {
  overview: {
    totalLeads: number;
    openLeads: number;
    wonLeads: number;
    lostLeads: number;
    totalContacts: number;
    conversionRate: number;
    tasksDue: number;
  };
  monthly: {
    leadsCreated: number;
    leadsCreatedGrowth: number;
    leadsWon: number;
    leadsWonGrowth: number;
    revenue: number;
    revenueGrowth: number;
  };
  pipeline: { id: string; name: string; color: string; count: number; position?: number; type?: string }[];
  recentActivities: Activity[];
}

export interface TeamMemberStats {
  id: string;
  name: string;
  avatar?: string;
  created: number;
  won: number;
  lost: number;
  winRate: number;
  revenue: number;
  openCount: number;
  openValue: number;
  tasksOpen: number;
}

export interface LeadSourceStat {
  source: string;
  total: number;
  won: number;
  revenue: number;
  winRate: number;
}

export interface ConversionStats {
  avgConversionDays: number;
  forecastValue: number;
  forecastBaseValue: number;
  forecastOpenCount: number;
  winRateGlobal: number;
  stagnantLeads: any[];
}

export type GoalType = 'leads_created' | 'leads_won' | 'revenue' | 'tasks_completed';

export interface Goal {
  id: string;
  type: GoalType;
  target: number;
  month: number;
  year: number;
  userId?: string | null;
  user?: { id: string; name: string } | null;
}

export interface GoalProgress extends Goal {
  current: number;
  percent: number;
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface RevenueData {
  month: string;
  revenue: number;
  deals: number;
}

// ==================== CHATBOTS ====================

export type ChatbotTrigger = 'first_message' | 'keyword' | 'always';

export type ChatbotNodeType =
  | 'trigger' | 'message' | 'template' | 'media' | 'buttons' | 'list'
  | 'condition' | 'switch' | 'action' | 'handoff' | 'delay' | 'ai'
  | 'set_var' | 'fetch_data' | 'subflow' | 'end';

export interface ChatbotButton { id: string; label: string; }

export interface ChatbotNodeData {
  label?: string;
  // message / ai (com validação opcional)
  text?: string;
  waitForReply?: boolean;
  saveAs?: string;
  aiPrompt?: string;
  validate?: 'email' | 'phone' | 'number' | 'url' | 'regex';
  validateRegex?: string;
  validateError?: string;
  // template
  templateName?: string;
  langCode?: string;
  variables?: string[];
  // media
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  caption?: string;
  // buttons
  buttons?: ChatbotButton[];
  // list (interactive list)
  buttonLabel?: string;
  sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  // handoff
  userId?: string;
  teamId?: string;
  message?: string;
  // condition
  conditionType?: 'contains' | 'equals' | 'starts_with' | 'is_number' | 'has_email' | 'has_phone';
  conditionValue?: string;
  conditionTarget?: string;
  // switch
  target?: string;
  cases?: { value: string; handle: string }[];
  default?: string;
  // action
  actionType?: 'create_task' | 'assign_user' | 'change_stage' | 'add_tag' | 'webhook' | 'set_priority' | 'create_lead';
  actionParams?: Record<string, any>;
  // delay
  delaySeconds?: number;
  // set_var
  varName?: string;
  varValue?: string;
  // fetch_data
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: string;
  body?: string;
  path?: string;
  // subflow
  flowId?: string;
  // generic raw value
  value?: string;
}

export interface ChatbotLogEntry {
  at: string;
  nodeId: string;
  nodeType: string;
  action: string;
  detail?: string;
}

export interface ChatbotNode {
  id: string;
  type: ChatbotNodeType;
  position: { x: number; y: number };
  data: ChatbotNodeData;
}

export interface ChatbotEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  animated?: boolean;
  label?: string;
  style?: any;
}

export interface ChatbotFlow {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  trigger: ChatbotTrigger;
  triggerValue?: string | null;
  channel: string;
  nodes: ChatbotNode[];
  edges: ChatbotEdge[];
  runCount: number;
  leadCount: number;
  businessHoursStart?: number | null;
  businessHoursEnd?: number | null;
  businessHoursWeekdays?: string | null;
  outOfHoursMessage?: string | null;
  language?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; avatar?: string };
  _count?: { sessions: number };
}

export interface ChatbotTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface ChatbotSession {
  id: string;
  flowId: string;
  contactId: string;
  leadId?: string | null;
  currentNodeId: string;
  variables: Record<string, any>;
  log?: ChatbotLogEntry[];
  isFinished: boolean;
  resumeAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: { id: string; firstName: string; lastName?: string; phone?: string; whatsapp?: string } | null;
}

// ==================== AUTOMATIONS ====================

export type AutomationTriggerType =
  | 'lead_created' | 'lead_stage_changed' | 'lead_won' | 'lead_lost' | 'lead_assigned' | 'lead_stagnant'
  | 'task_created' | 'task_completed' | 'task_overdue'
  | 'message_received' | 'no_response'
  | 'contact_created'
  | 'schedule';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  params?: Record<string, any>; // ex: { stageId: "..." } para lead_stage_changed
}

export type AutomationConditionOp =
  | 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than'
  | 'has_tag' | 'is_empty' | 'is_not_empty';

export interface AutomationCondition {
  field: string;
  op: AutomationConditionOp;
  value?: any;
}

export type AutomationActionType =
  | 'send_message' | 'send_email' | 'create_task' | 'assign_user'
  | 'change_stage' | 'add_tag' | 'remove_tag' | 'set_priority'
  | 'update_lead' | 'update_contact' | 'run_chatbot'
  | 'webhook' | 'send_notification';

export interface AutomationAction {
  type: AutomationActionType;
  params: Record<string, any>;
  delaySeconds?: number;
}

export interface AutomationConditionGroup {
  op: 'AND' | 'OR';
  items: AutomationCondition[];
}

export interface Automation {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[] | AutomationConditionGroup;
  actions: AutomationAction[];
  runCount: number;
  lastRunAt?: string | null;
  // Horario activo
  activeHoursStart?: number | null;
  activeHoursEnd?: number | null;
  activeWeekdays?: string | null;
  // Limites
  runLimitPerContact?: number | null;
  runLimitTotal?: number | null;
  runLimitWindow?: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; name: string; avatar?: string };
}

export interface AutomationRun {
  id: string;
  automationId: string;
  triggeredBy: string;
  entityType?: string;
  entityId?: string;
  contactId?: string | null;
  leadId?: string | null;
  status: 'OK' | 'SKIPPED' | 'FAILED';
  log: { at: string; action: string; detail?: string }[];
  createdAt: string;
  automation?: { id: string; name: string; trigger: AutomationTrigger };
}

// ==================== PRODUTOS & PROPOSTAS ====================

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  unitPrice: number;
  currency: string;
  taxRate: number;
  unit?: string | null;
  isActive: boolean;
  createdAt: string;
}

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';

export interface QuoteItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  position?: number;
  productId?: string | null;
  product?: { id: string; name: string } | null;
}

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  tax: number;
  total: number;
}

export interface Quote {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  currency: string;
  notes?: string | null;
  discountType: 'none' | 'percent' | 'amount';
  discountValue: number;
  taxRate: number;
  validUntil?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  contactId?: string | null;
  leadId?: string | null;
  contact?: { id: string; firstName: string; lastName?: string; company?: string; email?: string; phone?: string; whatsapp?: string } | null;
  lead?: { id: string; title: string } | null;
  createdBy?: { id: string; name: string };
  items: QuoteItem[];
  totals: QuoteTotals;
}
