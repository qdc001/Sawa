// Constroi o system prompt da IA Vendedora, combinando:
//   1) Persona configuravel por workspace (nome, papel, voz da marca)
//   2) Conhecimento por sector (objeccoes, vocabulario, prova social)
//   3) Principios destilados dos 6 livros, escolhidos pelo workspace ou os defaults
//   4) Instrucoes livres do utilizador (campo aiAgentInstructions)
//   5) Memoria aprendida pela Fase 4 (campo aiLearnedMemory)
//   6) Limite duro de 4 mensagens fragmentadas e regras de formato JSON
//
// Tudo PT europeu/mocambicano, sem travessoes, sem reproducao integral
// de texto das obras de referencia.

import { Workspace } from '@prisma/client';
import { SALES_PRINCIPLES, DEFAULT_ACTIVE_PRINCIPLES, getPrinciple } from '../data/salesKnowledge';
import { getSectorKnowledge } from '../data/sectorKnowledge';

export type BuildPromptOptions = {
  // Permite forcar um conjunto especifico de principios em vez do default.
  // Usado em testes e pelo endpoint de preview.
  activePrincipleKeys?: string[];
  // Limite de mensagens fragmentadas (default 4 conforme plano).
  maxFragments?: number;
};

export function buildSalesSystemPrompt(workspace: Workspace, opts: BuildPromptOptions = {}): string {
  const agentName = workspace.aiAgentName?.trim() || 'Klaru';
  const agentRole = workspace.aiAgentRole?.trim() || 'consultor';
  const brandVoice = workspace.aiBrandVoice?.trim();
  const instructions = workspace.aiAgentInstructions?.trim();
  const memory = workspace.aiLearnedMemory?.trim();
  const maxFragments = Math.max(1, Math.min(opts.maxFragments ?? 4, 6));

  const sectorKey = (workspace.sector || 'outro');
  const sector = getSectorKnowledge(sectorKey);

  const principleKeys = (opts.activePrincipleKeys && opts.activePrincipleKeys.length > 0)
    ? opts.activePrincipleKeys.filter((k) => SALES_PRINCIPLES[k])
    : DEFAULT_ACTIVE_PRINCIPLES;

  const principlesBlock = principleKeys.map((k) => {
    const p = getPrinciple(k);
    if (!p) return '';
    return [
      `# ${p.title} (${p.author})`,
      `Resumo: ${p.summary}`,
      `Quando aplicar: ${p.usage}`,
      `Exemplos:`,
      ...p.phrases.map((s) => `- ${s}`),
    ].join('\n');
  }).filter(Boolean).join('\n\n');

  const objectionsBlock = sector.objections.map((o, i) =>
    `${i + 1}. Quando o lead diz "${o.objection}", podes responder: "${o.response}"`
  ).join('\n');

  const discoveryBlock = sector.discoveryQuestions.map((q) => `- ${q}`).join('\n');
  const closingBlock = sector.closingTactics.map((t) => `- ${t}`).join('\n');
  const useWords = sector.vocabulary.use.join(', ');
  const avoidWords = sector.vocabulary.avoid.join(', ');
  const socialProofBlock = sector.socialProofHints.map((s) => `- ${s}`).join('\n');

  const parts: string[] = [];

  parts.push(
    `Es o(a) ${agentName}, ${agentRole} de vendas a trabalhar dentro do CRM de uma empresa que opera no sector ${sector.label}.\n` +
    `Falas portugues europeu/mocambicano. Nao usas travessao "—" em nenhuma circunstancia, ` +
    `usa virgula, dois pontos ou parenteses. Nao uses brasileirismos (e "ficheiro" nao "arquivo", ` +
    `"ecra" nao "tela", "rato" nao "mouse", "actual" nao "atual", "projecto" nao "projeto", ` +
    `"optimo" nao "otimo"). Tom directo, profissional, caloroso.`
  );

  if (brandVoice) {
    parts.push(`Voz e tom da marca a respeitar:\n${brandVoice}`);
  }

  if (instructions) {
    parts.push(`Instrucoes especificas dadas pelo dono da conta (cumprir sempre):\n${instructions}`);
  }

  if (memory) {
    parts.push(`Aprendizagem acumulada nas ultimas semanas (incorpora silenciosamente, nao cites):\n${memory}`);
  }

  parts.push(
    `Conheces estes principios destilados de seis autores de referencia em vendas e persuasao. ` +
    `Aplica-os sem nunca os nomear ao lead, sem soar a manual. So sao para te orientar.\n\n${principlesBlock}`
  );

  parts.push(
    `Conhecimento especifico do sector ${sector.label}:\n\n` +
    `Objeccoes comuns e sugestao de resposta:\n${objectionsBlock}\n\n` +
    `Perguntas que ajudam a descobrir o que esta em jogo:\n${discoveryBlock}\n\n` +
    `Taticas de fecho que costumam funcionar neste sector:\n${closingBlock}\n\n` +
    `Vocabulario a usar: ${useWords}.\n` +
    `Vocabulario a evitar: ${avoidWords}.\n\n` +
    `Pistas para prova social:\n${socialProofBlock}`
  );

  parts.push(
    `Regras de formato da resposta:\n` +
    `- Devolves SEMPRE um JSON valido com a forma { "messages": string[], "principlesUsed": string[] }.\n` +
    `- O array messages tem entre 1 e ${maxFragments} mensagens curtas, como se estivesses a digitar no WhatsApp.\n` +
    `- Cada mensagem com 1 a 3 frases. Sem listas, sem markdown, sem emojis em excesso.\n` +
    `- O array principlesUsed contem as chaves dos principios usados, escolhidas da lista que conheces.\n` +
    `- Nunca inventas nomes, numeros ou casos de clientes. Se nao tens dado, omites.\n` +
    `- Quando deves enviar ficheiros do catalogo, usas as tools disponiveis para o efeito.\n` +
    `- Em caso de duvida grande, usa a tool de handoff para passar a conversa a um humano.`
  );

  return parts.join('\n\n');
}
