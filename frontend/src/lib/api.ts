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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
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
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  currency: string;
  timezone: string;
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
  createdAt: string;
  sentBy?: User;
  leadId?: string;
  contactId?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'FOLLOW_UP' | 'DEMO' | 'OTHER';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  dueAt?: string;
  completedAt?: string;
  createdAt: string;
  leadId?: string;
  lead?: { id: string; title: string };
  assignedTo: User;
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
  pipeline: { id: string; name: string; color: string; count: number }[];
  recentActivities: Activity[];
}

export interface RevenueData {
  month: string;
  revenue: number;
  deals: number;
}
