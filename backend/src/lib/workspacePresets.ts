// Presets de workspace: configuracao completa de terminologia, tipos,
// templates e campos personalizados para verticais especificos.
// Aplicados via POST /api/workspaces/me/apply-preset.
//
// Cada preset e non-destrutivo: so preenche o que nao esta ja configurado.
// Campos criados (templates, custom fields) sao criados com skip se ja
// existir um com o mesmo key/nome.

export interface PresetTaskType { value: string; label: string; color?: string }
export interface PresetWorkType { key: string; label: string; article: string; possessive: string }
export interface PresetSubject { label: string; article: string; possessive: string }
export interface PresetAppointmentType { key: string; label: string; defaultDurationMin: number }
export interface PresetTemplate { name: string; content: string; category: 'UTILITY' | 'MARKETING' | 'SERVICE'; channel: 'WHATSAPP' | 'EMAIL' }
export interface PresetCustomField { name: string; key: string; type: 'TEXT' | 'DATE' | 'SELECT' | 'NUMBER' | 'PHONE'; entity: string; options?: string[]; position: number }

export interface WorkspacePreset {
  key: string;
  label: string;
  // Terminologia
  contactLabelSingular: string;
  contactLabelPlural: string;
  appointmentLabelSingular: string;
  appointmentLabelPlural: string;
  // Sector para a IA
  sector: string;
  aiAgentName: string;
  aiAgentRole: string;
  aiAgentInstructions: string;
  aiBrandVoice: string;
  // Tarefas
  taskTypes: PresetTaskType[];
  // Auto-tarefa
  autoTaskWorkTypes: PresetWorkType[];
  autoTaskSubjects: PresetSubject[];
  autoTaskAnnounceTemplate: string;
  autoTaskDeliverTemplate: string;
  autoTaskAnnounceTaskTitleTemplate: string;
  autoTaskFollowupTitleTemplate: string;
  // Marcacoes/Consultas
  appointmentTypes: PresetAppointmentType[];
  // Templates de mensagem para envio rapido no Inbox
  messageTemplates: PresetTemplate[];
  // Campos personalizados adicionados ao Contact
  customFields: PresetCustomField[];
}

// ============ Preset CLINICA ============
export const CLINIC_PRESET: WorkspacePreset = {
  key: 'clinic',
  label: 'Clínica',

  contactLabelSingular: 'Paciente',
  contactLabelPlural: 'Pacientes',
  appointmentLabelSingular: 'Consulta',
  appointmentLabelPlural: 'Consultas',

  sector: 'clinica',
  aiAgentName: 'Leizy',
  aiAgentRole: 'Recepcionista virtual da clínica',
  aiAgentInstructions: [
    'És a recepcionista virtual desta clínica.',
    'Ajudas pacientes a marcar consultas, esclareces dúvidas administrativas, confirmas horários e envias lembretes.',
    'NUNCA dás diagnósticos, nunca prescreves medicação, nunca dizes que uma dor é ou não é grave.',
    'Se o paciente descrever sintomas ou pedir opinião clínica, respondes com empatia e reencaminhas: "Vou passar a sua mensagem à equipa clínica para lhe darem a resposta certa."',
    'Se o paciente pedir urgência, respondes com uma frase curta e mudas o estado da conversa para a equipa humana rever imediatamente.',
    'Trata sempre por "você". Frases curtas. Português europeu/moçambicano, sem brasileirismos.',
  ].join('\n'),
  aiBrandVoice: 'Recepcionista experiente de clínica: cordial, calma, precisa, empática. Curta e directa. Trata por "você". Nunca prescreve nem diagnostica. Assina como Equipa da Clínica.',

  taskTypes: [
    { value: 'CALL',              label: 'Ligar paciente',      color: '#3B82F6' },
    { value: 'CONFIRM',           label: 'Confirmar consulta',  color: '#10B981' },
    { value: 'SEND_PRESCRIPTION', label: 'Enviar receita',      color: '#8B5CF6' },
    { value: 'SEND_RESULT',       label: 'Enviar resultado',    color: '#06B6D4' },
    { value: 'FOLLOW_UP',         label: 'Retorno pós-consulta', color: '#F59E0B' },
    { value: 'BILLING',           label: 'Cobrança',            color: '#EF4444' },
    { value: 'RESCHEDULE',        label: 'Reagendamento',       color: '#F97316' },
    { value: 'OTHER',             label: 'Outros',              color: '#64748B' },
  ],

  autoTaskWorkTypes: [
    { key: 'receita',    label: 'Receita',              article: 'a',  possessive: 'sua' },
    { key: 'analises',   label: 'Análises',             article: 'as', possessive: 'suas' },
    { key: 'radiografia', label: 'Radiografia',         article: 'a',  possessive: 'sua' },
    { key: 'relatorio',  label: 'Relatório',            article: 'o',  possessive: 'seu' },
    { key: 'plano',      label: 'Plano de tratamento',  article: 'o',  possessive: 'seu' },
    { key: 'orcamento',  label: 'Orçamento',            article: 'o',  possessive: 'seu' },
    { key: 'outros',     label: 'Outros',               article: 'o',  possessive: 'seu' },
  ],

  autoTaskSubjects: [
    { label: 'Consulta de amanhã',       article: 'a', possessive: 'sua' },
    { label: 'Confirmação',              article: 'a', possessive: 'sua' },
    { label: 'Preparação para exame',    article: 'a', possessive: 'sua' },
    { label: 'Resultado',                article: 'o', possessive: 'seu' },
    { label: 'Orçamento',                article: 'o', possessive: 'seu' },
    { label: 'Segunda consulta',         article: 'a', possessive: 'sua' },
    { label: 'Retorno',                  article: 'o', possessive: 'seu' },
  ],

  autoTaskAnnounceTemplate: 'Olá {nome}, vamos enviar {artigoAssunto} {assunto} d{artigo} {possessivo} {tipo} até {data}.',
  autoTaskDeliverTemplate: 'Olá {nome}, segue em anexo {artigoAssunto} {assunto}. Qualquer dúvida sobre {artigo} {tipo}, respondemos por aqui.',
  autoTaskAnnounceTaskTitleTemplate: 'Enviar {artigoAssunto} {assunto} d{artigo} {possessivo} {tipo}',
  autoTaskFollowupTitleTemplate: 'Confirmar recepção d{artigoAssunto} {assunto}',

  appointmentTypes: [
    { key: 'primeira',   label: 'Primeira consulta', defaultDurationMin: 45 },
    { key: 'retorno',    label: 'Retorno',            defaultDurationMin: 20 },
    { key: 'avaliacao',  label: 'Avaliação',          defaultDurationMin: 30 },
    { key: 'urgencia',   label: 'Urgência',           defaultDurationMin: 20 },
    { key: 'exame',      label: 'Exame',              defaultDurationMin: 30 },
    { key: 'procedimento', label: 'Procedimento',     defaultDurationMin: 60 },
  ],

  messageTemplates: [
    {
      name: 'Lembrete consulta 24h',
      category: 'UTILITY',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, apenas para lembrar que temos consulta amanhã às {hora}. Se precisar reagendar, responda a esta mensagem. Obrigada.',
    },
    {
      name: 'Confirmação de marcação',
      category: 'UTILITY',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, a sua consulta está confirmada para {data} às {hora}. Endereço: {morada}. Até breve.',
    },
    {
      name: 'Preparação para exame',
      category: 'UTILITY',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, para o exame de {data} precisa de vir em jejum de 8 horas. Traga o pedido do médico. Se tiver dúvidas, responda por aqui.',
    },
    {
      name: 'Resultado disponível',
      category: 'UTILITY',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, o seu resultado já está disponível. Vamos enviar-lho por aqui em anexo. Qualquer dúvida sobre a interpretação, agende consulta de retorno.',
    },
    {
      name: 'Feliz aniversário',
      category: 'MARKETING',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, hoje é o seu dia. A equipa da clínica deseja-lhe um feliz aniversário. Saúde e alegrias.',
    },
    {
      name: 'Fim de tratamento',
      category: 'SERVICE',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, esperamos que esteja tudo bem após o tratamento. Se puder deixar-nos uma avaliação, ajuda-nos muito. Obrigada pela sua confiança.',
    },
    {
      name: 'Falta a consulta',
      category: 'UTILITY',
      channel: 'WHATSAPP',
      content: 'Olá {nome}, notámos que não conseguiu vir hoje à consulta. Está tudo bem? Podemos reagendar para outro dia?',
    },
  ],

  customFields: [
    { name: 'Data de nascimento',    key: 'birth_date',       type: 'DATE',   entity: 'contact', position: 1 },
    { name: 'Género',                key: 'gender',           type: 'SELECT', entity: 'contact', options: ['Feminino', 'Masculino', 'Outro', 'Prefiro não dizer'], position: 2 },
    { name: 'Alergias',              key: 'allergies',        type: 'TEXT',   entity: 'contact', position: 3 },
    { name: 'Medicação actual',      key: 'medication',       type: 'TEXT',   entity: 'contact', position: 4 },
    { name: 'Plano de saúde',        key: 'health_plan',      type: 'SELECT', entity: 'contact', options: ['Nenhum', 'IMS Sadec', 'Medis', 'Multicare', 'Global Alliance', 'Outro'], position: 5 },
    { name: 'NUIT',                  key: 'nuit',             type: 'TEXT',   entity: 'contact', position: 6 },
    { name: 'Contacto de emergência', key: 'emergency_contact', type: 'PHONE', entity: 'contact', position: 7 },
  ],
};

export const PRESETS: Record<string, WorkspacePreset> = {
  clinic: CLINIC_PRESET,
};
