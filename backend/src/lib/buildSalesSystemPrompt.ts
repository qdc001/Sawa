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
  // Catalogo de produtos disponiveis para a IA poder anexar via send_product.
  // Quando vazio (ou ausente), o prompt nao convida a usar send_product.
  productCatalog?: Array<{
    id: string;
    name: string;
    description?: string | null;
    unitPrice?: number | null;
    currency?: string | null;
    fileCount?: number;
  }>;
  // Regras de coaching ja seleccionadas como relevantes para esta interaccao.
  // Sao injectadas como bloco de "instrucoes situacionais" para a IA seguir.
  coachingRules?: Array<{
    situation: string;
    recommendedAction: string;
    tone?: string | null;
    category?: string | null;
    examples?: Array<{ leadMessage: string; aiResponse: string }>;
  }>;
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

  // Catalogo de produtos disponivel para a IA escolher quando faz sentido
  // anexar materiais (ficha tecnica, foto, PDF de proposta, etc.).
  const catalog = (opts.productCatalog || []).filter((p) => p && p.id);
  const catalogBlock = catalog.length === 0
    ? null
    : catalog.map((p) => {
        const price = (p.unitPrice != null) ? ` | preco: ${p.unitPrice} ${p.currency || 'MZN'}` : '';
        const files = (p.fileCount && p.fileCount > 0) ? ` | ${p.fileCount} ficheiro(s)` : ' | sem ficheiros';
        const desc = p.description ? ` | ${String(p.description).slice(0, 120)}` : '';
        return `- ${p.id} :: ${p.name}${desc}${price}${files}`;
      }).join('\n');

  if (catalogBlock) {
    parts.push(
      `Catalogo de produtos disponivel (id :: nome | descricao | preco | ficheiros):\n${catalogBlock}\n\n` +
      `Quando o lead pedir informacao detalhada sobre um produto destes, podes responder com action="send_product" ` +
      `e indicar o productId correspondente. Se o produto nao tiver ficheiros, prefere action="send_text".`
    );
  }

  // Regras situacionais ensinadas pelo admin atraves do coach ou aprendidas
  // automaticamente a partir de conversas com sinal positivo. Tem prioridade
  // sobre os principios genericos quando a situacao se encaixa.
  const rules = (opts.coachingRules || []).filter((r) => r && r.situation && r.recommendedAction);
  if (rules.length > 0) {
    const rulesBlock = rules.map((r, i) => {
      const tone = r.tone ? ` (tom: ${r.tone})` : '';
      const exs = (r.examples || []).slice(0, 2).map((e) =>
        `   Exemplo: lead diz "${e.leadMessage.slice(0, 200)}" -> respondes algo como "${e.aiResponse.slice(0, 300)}"`
      ).join('\n');
      return `${i + 1}. Quando ${r.situation}${tone}:\n   ${r.recommendedAction}${exs ? `\n${exs}` : ''}`;
    }).join('\n\n');

    parts.push(
      `Regras situacionais especificas deste workspace (PRIORIDADE ALTA, cumprir sempre que a situacao se encaixar):\n\n${rulesBlock}\n\n` +
      `Quando varias regras se aplicam, combina-as com bom senso. Quando nenhuma se aplica, segue os principios gerais acima.`
    );
  }

  parts.push(
    `Regras de formato da resposta (cumprir a risca):\n` +
    `- Devolves SEMPRE um unico objecto JSON valido (sem markdown, sem texto antes ou depois).\n` +
    `- A forma exacta e: {\n` +
    `    "action": "send_text" | "send_product" | "handoff" | "wait",\n` +
    `    "parts": string[],          // entre 1 e ${maxFragments} mensagens curtas para enviar ao lead\n` +
    `    "productId": string | null, // obrigatorio so se action="send_product", senao null\n` +
    `    "principlesUsed": string[], // chaves dos principios escolhidos (ex: "voss_labeling")\n` +
    `    "reasoning": string         // 1-2 frases explicando porque escolheste esta resposta (em PT-MZ)\n` +
    `  }.\n` +
    `- Cada mensagem em parts tem 1 a 3 frases, tom WhatsApp, natural, sem listas nem markdown.\n` +
    `- Fragmenta a resposta em varias partes pequenas quando isso parecer mais humano (saudacao, pergunta, ` +
    `proposta, fecho podem ser partes separadas).\n` +
    `- Nao excedas ${maxFragments} partes. Se a mensagem couber em 1, usa 1.\n` +
    `- Nunca inventas nomes de clientes, numeros, datas ou casos. Se nao sabes, omites.\n` +
    `- action="handoff" quando o lead pede falar com humano, ameaca, pede reembolso, mostra raiva, ` +
    `ou a duvida sai do teu dominio. Em handoff, parts pode conter uma frase de transicao curta.\n` +
    `- action="wait" se o lead pediu para falar mais tarde ou se ainda nao ha nada substantivo a dizer. ` +
    `Em wait, parts pode ser array vazio.\n` +
    `- principlesUsed deve listar 2 a 4 chaves dos principios que orientaram a resposta. Nunca cites ` +
    `principios pelo nome ao lead, sao so para auditoria interna.`
  );

  return parts.join('\n\n');
}
