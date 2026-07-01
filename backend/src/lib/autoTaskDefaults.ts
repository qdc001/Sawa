// Defaults e renderizacao de templates da funcionalidade auto-tarefa.
//
// A config e guardada em Workspace.autoTaskConfig (Json). Quando null,
// usamos os defaults abaixo. Os templates aceitam placeholders:
//
//   {nome}         nome do contacto
//   {assunto}      texto livre que o utilizador escreve
//   {tipo}         label do tipo de trabalho (ex: "monografia")
//   {artigo}       artigo definido do tipo ("a", "o", "os")
//   {possessivo}   possessivo do tipo ("tua", "teu", "teus")
//   {data}         data limite formatada DD/MM
//
// Concordancia: para portugues correcto ("da tua monografia" vs "do teu
// projecto"), cada tipo tem article + possessive editaveis.

export type WorkType = {
  key: string;
  label: string;
  article: string;       // 'a' | 'o' | 'os'
  possessive: string;    // 'tua' | 'teu' | 'teus' | 'tuas'
};

export type AutoTaskConfig = {
  workTypes: WorkType[];
  subjects: string[];  // Assuntos frequentes para dropdown rapido
  announceTemplate: string;
  deliverTemplate: string;
  announceTaskTitleTemplate: string;
  followupTitleTemplate: string;
  followupDays: number;
};

export const DEFAULT_AUTO_TASK_CONFIG: AutoTaskConfig = {
  workTypes: [
    { key: 'dissertacao', label: 'Dissertação', article: 'a', possessive: 'tua' },
    { key: 'monografia',  label: 'Monografia',  article: 'a', possessive: 'tua' },
    { key: 'projecto',    label: 'Projecto',    article: 'o', possessive: 'teu' },
    { key: 'slides',      label: 'Slides',      article: 'os', possessive: 'teus' },
    { key: 'artigo',      label: 'Artigo',      article: 'o', possessive: 'teu' },
    { key: 'outros',      label: 'Outros',      article: 'o', possessive: 'teu' },
  ],
  subjects: [
    'Capítulo 1',
    'Capítulo 2',
    'Capítulo 3',
    'Introdução',
    'Revisão',
    'Primeira versão',
    'Versão final',
    'Feedback do orientador',
    'Sinopse',
  ],
  // {artigo} e {possessivo} referem-se sempre ao {tipo} (nao ao {assunto},
  // porque o assunto e texto livre e nao sabemos o genero). O utilizador pode
  // adicionar artigo inline no proprio assunto se quiser (ex: "a Versao revista").
  // "de + a" = "da"; "de + o" = "do". Contraccao aplicada pelo renderer via d{artigo}.
  announceTemplate: 'Olá {nome}, irei enviar {assunto} d{artigo} {possessivo} {tipo} até {data}.',
  deliverTemplate: 'Olá {nome}, envio em anexo {assunto}. Peço para analisares e depois deixares o teu feedback.',
  announceTaskTitleTemplate: 'Enviar {assunto} d{artigo} {possessivo} {tipo}',
  followupTitleTemplate: 'Pedir feedback de {assunto}',
  followupDays: 3,
};

export function getEffectiveConfig(saved: any): AutoTaskConfig {
  if (!saved || typeof saved !== 'object') return DEFAULT_AUTO_TASK_CONFIG;
  return {
    workTypes: Array.isArray(saved.workTypes) && saved.workTypes.length > 0
      ? saved.workTypes.map((t: any) => ({
          key: String(t.key || t.label || 'outros').toLowerCase(),
          label: String(t.label || 'Outros'),
          article: String(t.article || 'o'),
          possessive: String(t.possessive || 'teu'),
        }))
      : DEFAULT_AUTO_TASK_CONFIG.workTypes,
    subjects: Array.isArray(saved.subjects)
      ? saved.subjects.filter((s: any) => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim()).slice(0, 40)
      : DEFAULT_AUTO_TASK_CONFIG.subjects,
    announceTemplate: typeof saved.announceTemplate === 'string' && saved.announceTemplate.trim()
      ? saved.announceTemplate : DEFAULT_AUTO_TASK_CONFIG.announceTemplate,
    deliverTemplate: typeof saved.deliverTemplate === 'string' && saved.deliverTemplate.trim()
      ? saved.deliverTemplate : DEFAULT_AUTO_TASK_CONFIG.deliverTemplate,
    announceTaskTitleTemplate: typeof saved.announceTaskTitleTemplate === 'string' && saved.announceTaskTitleTemplate.trim()
      ? saved.announceTaskTitleTemplate : DEFAULT_AUTO_TASK_CONFIG.announceTaskTitleTemplate,
    followupTitleTemplate: typeof saved.followupTitleTemplate === 'string' && saved.followupTitleTemplate.trim()
      ? saved.followupTitleTemplate : DEFAULT_AUTO_TASK_CONFIG.followupTitleTemplate,
    followupDays: Number.isFinite(saved.followupDays) && saved.followupDays > 0 && saved.followupDays < 90
      ? Math.trunc(saved.followupDays) : DEFAULT_AUTO_TASK_CONFIG.followupDays,
  };
}

// Aplica contraccoes "de + artigo" para renderizar naturalmente.
//   d + a  -> da
//   d + o  -> do
//   d + os -> dos
//   d + as -> das
function contract(prefix: string, article: string): string {
  if (prefix === 'd') {
    if (article === 'a') return 'da';
    if (article === 'o') return 'do';
    if (article === 'os') return 'dos';
    if (article === 'as') return 'das';
  }
  return prefix + article;
}

// Preenche um template substituindo placeholders. Aplica contraccao
// quando ha um 'd' imediatamente antes de {artigo}.
export function renderTemplate(
  template: string,
  vars: {
    nome: string;
    assunto?: string;
    tipo?: string;
    artigo?: string;
    possessivo?: string;
    data?: string;
  },
): string {
  let out = template;

  // Contraccao: "d{artigo}" vira "da" ou "do" etc
  if (vars.artigo) {
    out = out.replace(/d\{artigo\}/g, contract('d', vars.artigo));
    out = out.replace(/\{artigo\}/g, vars.artigo);
  } else {
    out = out.replace(/d\{artigo\}\s*/g, '');
    out = out.replace(/\{artigo\}\s*/g, '');
  }

  const replacements: Record<string, string> = {
    '{nome}': vars.nome || '',
    '{assunto}': vars.assunto || '',
    '{tipo}': vars.tipo || '',
    '{possessivo}': vars.possessivo || '',
    '{data}': vars.data || '',
  };
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }

  // Se nao houver tipo, remover a construcao "d{possessivo} {tipo}" que ficou vazia
  out = out.replace(/\s+d(a|o|os|as)\s+\s+/g, ' ');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

export function formatDDMM(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
