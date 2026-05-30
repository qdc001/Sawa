// Catálogo de planos do Sawa. Limite -1 = ilimitado.
export const UNLIMITED = -1;

export interface PlanLimits {
  users: number;
  whatsapp: number;
  contacts: number;
  automations: number;
  aiMessages: number;
}

export interface PlanDef {
  key: string;
  label: string;
  priceUsd: number | null; // null = sob consulta
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<string, PlanDef> = {
  STARTER: {
    key: 'STARTER', label: 'Starter', priceUsd: 29,
    limits: { users: 2, whatsapp: 1, contacts: 1000, automations: 3, aiMessages: 0 },
    features: ['WhatsApp'],
  },
  GROWTH: {
    key: 'GROWTH', label: 'Growth', priceUsd: 99,
    limits: { users: 10, whatsapp: 3, contacts: 10000, automations: 20, aiMessages: 1000 },
    features: ['WhatsApp', 'Instagram + Facebook', 'Chatbot com IA', 'Broadcasts', 'Analytics'],
  },
  BUSINESS: {
    key: 'BUSINESS', label: 'Business', priceUsd: 249,
    limits: { users: UNLIMITED, whatsapp: 10, contacts: 100000, automations: UNLIMITED, aiMessages: 10000 },
    features: ['Tudo do Growth', 'Email integrado', 'Onboarding 1:1'],
  },
  ENTERPRISE: {
    key: 'ENTERPRISE', label: 'Enterprise', priceUsd: null,
    limits: { users: UNLIMITED, whatsapp: UNLIMITED, contacts: UNLIMITED, automations: UNLIMITED, aiMessages: UNLIMITED },
    features: ['Tudo do Business', 'White-label', 'Personalizado'],
  },
};

export function getPlan(key?: string | null): PlanDef {
  return (key && PLANS[key]) || PLANS.STARTER;
}
