// Hook para obter a terminologia customizada do workspace.
// Actualmente cobre so os labels de "Contacto/Contactos" mas pode
// crescer para outros termos (Lead, Oportunidade, Marcacao, etc.).
//
// Uso:
//   const { contact, contacts } = useTerminology();
//   <h1>{contacts}</h1>

import { useAuthStore } from '../store';

export interface Terminology {
  contact: string;     // singular, ex: "Paciente"
  contacts: string;    // plural, ex: "Pacientes"
}

export function useTerminology(): Terminology {
  const workspace = useAuthStore((s) => s.workspace) as any;
  return {
    contact: (workspace?.contactLabelSingular?.trim() || 'Contacto'),
    contacts: (workspace?.contactLabelPlural?.trim() || 'Contactos'),
  };
}

// Presets rapidos para o selector nas Definicoes.
export const CONTACT_LABEL_PRESETS: Array<{ singular: string; plural: string; hint: string }> = [
  { singular: 'Contacto',   plural: 'Contactos',   hint: 'Genérico (default)' },
  { singular: 'Paciente',   plural: 'Pacientes',   hint: 'Clínicas, hospitais, consultórios' },
  { singular: 'Cliente',    plural: 'Clientes',    hint: 'Comércio, serviços, freelancers' },
  { singular: 'Formando',   plural: 'Formandos',   hint: 'Formação, ONGs, treinos' },
  { singular: 'Aluno',      plural: 'Alunos',      hint: 'Escolas, universidades, explicações' },
  { singular: 'Membro',     plural: 'Membros',     hint: 'Ginásios, clubes, associações' },
  { singular: 'Hóspede',    plural: 'Hóspedes',    hint: 'Hotelaria, alojamentos' },
];
