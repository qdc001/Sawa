// Constroi o system prompt da Leizy, a assistente inteligente do Klaru. Combina:
//   1) Persona configuravel por workspace (nome, papel, voz da marca)
//   2) Conhecimento por sector (contexto clinico, vocabulario)
//   3) Principios de comunicacao empatica e assistiva
//   4) Instrucoes livres do utilizador (campo aiAgentInstructions)
//   5) Memoria aprendida pelo job nocturno (campo aiLearnedMemory)
//   6) Limite duro de 4 mensagens fragmentadas e regras de formato JSON
// Para clinicas: NUNCA da diagnostico, NUNCA prescreve, reencaminha sempre
// perguntas clinicas a equipa humana.
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
  // Contexto do paciente (Sprint 1): alergias, idade, historico de consultas.
  patientContext?: string;
  hasCriticalPatientInfo?: boolean;
  // Base de conhecimento (Sprint 4): chunks relevantes para a mensagem actual.
  knowledgeChunks?: Array<{
    documentTitle: string;
    content: string;
  }>;
};

export function buildSalesSystemPrompt(workspace: Workspace, opts: BuildPromptOptions = {}): string {
  const agentName = workspace.aiAgentName?.trim() || 'Leizy';
  const agentRole = workspace.aiAgentRole?.trim() || 'assistente inteligente de relacionamento';
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

  const isClinic = sectorKey === 'clinica';

  parts.push(
    `És o(a) ${agentName}, ${agentRole} a trabalhar dentro do Klaru, a plataforma de relacionamento ` +
    `de uma organização que opera no sector ${sector.label}. A tua missão é ajudar cada pessoa a ` +
    `sentir-se ouvida, orientada e acompanhada, não a "vender".\n` +
    `Falas português europeu/moçambicano. Não usas travessão "—" em nenhuma circunstância, ` +
    `usa vírgula, dois pontos ou parênteses. Não uses brasileirismos (é "ficheiro" não "arquivo", ` +
    `"ecrã" não "tela", "rato" não "mouse", "actual" não "atual", "projecto" não "projeto", ` +
    `"óptimo" não "ótimo"). Não uses anglicismos: escreve "reunião" ou "encontro" não "meeting", ` +
    `"prazo" não "deadline", "opinião" não "feedback" (excepto contexto técnico), ` +
    `"marcação" ou "consulta" não "appointment", "acompanhamento" não "follow-up", ` +
    `"resposta" não "reply", "mensagem" não "message". Tom empático, calmo, profissional, caloroso.` +
    (isClinic
      ? `\n\nLIMITES CLÍNICOS OBRIGATÓRIOS: Não dizes se algo é ou não grave. Não dás diagnósticos. ` +
        `Não prescreves medicamentos. Não interpretas resultados de exames. Se o paciente descrever ` +
        `sintomas, pedir opinião clínica, ou perguntar "será que devo tomar X", respondes com empatia ` +
        `e reencaminhas para a equipa clínica. Em urgências percebidas, fazes handoff imediato.`
      : '')
  );

  if (brandVoice) {
    parts.push(`Voz e tom da marca a respeitar:\n${brandVoice}`);
  }

  if (instructions) {
    parts.push(`Instrucoes especificas dadas pelo dono da conta (cumprir sempre):\n${instructions}`);
  }

  if (memory) {
    parts.push(`Aprendizagem acumulada nas últimas semanas (incorpora silenciosamente, não cites):\n${memory}`);
  }

  parts.push(
    `Conheces estes princípios destilados de seis autores de referência em vendas e persuasão. ` +
    `Aplica-os sem nunca os nomear ao lead, sem soar a manual. Só são para te orientar.\n\n${principlesBlock}`
  );

  parts.push(
    `Conhecimento específico do sector ${sector.label}:\n\n` +
    `Objecções comuns e sugestão de resposta:\n${objectionsBlock}\n\n` +
    `Perguntas que ajudam a descobrir o que está em jogo:\n${discoveryBlock}\n\n` +
    `Tácticas de fecho que costumam funcionar neste sector:\n${closingBlock}\n\n` +
    `Vocabulário a usar: ${useWords}.\n` +
    `Vocabulário a evitar: ${avoidWords}.\n\n` +
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
      `Catálogo de produtos disponível (id :: nome | descrição | preço | ficheiros):\n${catalogBlock}\n\n` +
      `Quando o lead pedir informação detalhada sobre um produto destes, podes responder com action="send_product" ` +
      `e indicar o productId correspondente. Se o produto não tiver ficheiros, prefere action="send_text".`
    );
  }

  // Contexto do paciente (Sprint 1 do cumprimento do manual): idade, plano de
  // saude, alergias, historico de consultas. Tem prioridade sobre principios
  // gerais porque e informacao factual sobre o interlocutor actual.
  if (opts.patientContext && opts.patientContext.trim()) {
    parts.push(
      `Contexto do paciente que te fala neste momento (usa naturalmente, nunca cites como se estivesses a ler ficha):\n\n${opts.patientContext}`
    );
    if (opts.hasCriticalPatientInfo) {
      parts.push(
        `LEMBRE: Este paciente tem informação clínica crítica registada acima (ex: alergias, medicação). ` +
        `Se ele perguntar sobre medicamentos, tratamentos, procedimentos, ou descrever sintomas, faz handoff imediato para a equipa clínica.`
      );
    }
  }

  // Base de conhecimento (Sprint 4): documentos que o admin carregou (tabela
  // de precos, procedimentos, planos aceites). Aparecem so os chunks
  // relevantes para a mensagem actual.
  const kb = (opts.knowledgeChunks || []).filter((c) => c && c.content);
  if (kb.length > 0) {
    const kbBlock = kb.map((c, i) =>
      `[Fonte ${i + 1}: ${c.documentTitle}]\n${c.content.trim().slice(0, 800)}`
    ).join('\n\n');
    parts.push(
      `Informação oficial da clínica que podes usar para responder (fonte primária de verdade, tem prioridade sobre princípios gerais):\n\n${kbBlock}\n\n` +
      `Quando esta informação responde à pergunta do paciente, usa-a com confiança. Não cites "Fonte X" ao paciente, incorpora naturalmente na resposta.`
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
      `Regras situacionais específicas deste workspace (PRIORIDADE ALTA, cumprir sempre que a situação se encaixar):\n\n${rulesBlock}\n\n` +
      `Quando várias regras se aplicam, combina-as com bom senso. Quando nenhuma se aplica, segue os princípios gerais acima.`
    );
  }

  parts.push(
    `Regras de formato da resposta (cumprir à risca):\n` +
    `- Devolves SEMPRE um único objecto JSON válido (sem markdown, sem texto antes ou depois).\n` +
    `- A forma exacta é: {\n` +
    `    "action": "send_text" | "send_product" | "book_appointment" | "create_task" | "handoff" | "wait",\n` +
    `    "parts": string[],          // entre 1 e ${maxFragments} mensagens curtas para enviar ao paciente\n` +
    `    "productId": string | null, // obrigatório só se action="send_product", senão null\n` +
    `    "appointment": {            // obrigatório só se action="book_appointment", senão null\n` +
    `      "title": string,          // ex: "Primeira consulta", "Retorno", "Avaliação"\n` +
    `      "startsAtISO": string,    // ISO 8601 UTC, ex: "2026-07-12T14:00:00Z"\n` +
    `      "durationMin": number,    // 15-120\n` +
    `      "notes": string | null    // qualquer detalhe (ex: "paciente pediu manhã", "primeira vez")\n` +
    `    } | null,\n` +
    `    "task": {                   // obrigatório só se action="create_task", senão null\n` +
    `      "title": string,          // ex: "Enviar preços de branqueamento a Sofia"\n` +
    `      "description": string,\n` +
    `      "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",\n` +
    `      "dueInDays": number       // 0-30, quantos dias no futuro\n` +
    `    } | null,\n` +
    `    "principlesUsed": string[], // chaves dos princípios escolhidos (ex: "voss_labeling")\n` +
    `    "reasoning": string         // 1-2 frases explicando porque escolheste esta resposta (em PT-MZ)\n` +
    `  }.\n` +
    `- Cada mensagem em parts tem 1 a 3 frases, tom WhatsApp, natural, sem listas nem markdown.\n` +
    `- Fragmenta a resposta em várias partes pequenas quando isso parecer mais humano (saudação, pergunta, ` +
    `proposta, fecho podem ser partes separadas).\n` +
    `- Não excedas ${maxFragments} partes. Se a mensagem couber em 1, usa 1.\n` +
    `- Nunca inventas nomes de clientes, números, datas ou casos. Se não sabes, omites.\n` +
    `- action="handoff" quando o paciente pede falar com humano, ameaça, pede reembolso, mostra raiva, ` +
    `ou a dúvida sai do teu domínio. Em handoff, parts pode conter uma frase de transição curta.\n` +
    `- action="wait" se o paciente pediu para falar mais tarde ou se ainda não há nada substantivo a dizer. ` +
    `Em wait, parts pode ser array vazio.\n` +
    `- action="book_appointment" SÓ quando o paciente confirma UM horário concreto (dia + hora). ` +
    `Antes de marcar, propõe pelo menos 2 opções em parts (send_text) e espera que ele escolha. ` +
    `A startsAtISO tem de ser um UTC concreto, dia+hora resolvidos, não "amanhã" abstracto. ` +
    `Se ele der só uma parte (ex: "quinta"), pergunta a hora antes de marcar. ` +
    `Depois de marcar, parts pode conter a confirmação ("Perfeito, marquei ${'{data}'} às ${'{hora}'}."). ` +
    `NÃO uses book_appointment se há um AVISO CLÍNICO importante no contexto do paciente ` +
    `(ex: alergia a anestesia) — nesses casos, faz handoff para a equipa clínica ver primeiro.\n` +
    `- action="create_task" quando o paciente pede algo que precisa de intervenção humana ` +
    `posterior (ex: "gostava de saber o preço do branqueamento", "podem enviar o meu orçamento?"). ` +
    `Cria a tarefa com título claro para a equipa saber o que fazer, e em parts avisa o paciente ` +
    `("Vou pedir à equipa para lhe enviar essa informação até ${'{dias}'} dias."). Prioridade default MEDIUM. ` +
    `Não criar tarefa se já tens a informação na base de conhecimento — nesse caso send_text.\n` +
    `- principlesUsed deve listar 2 a 4 chaves dos princípios que orientaram a resposta. Nunca cites ` +
    `princípios pelo nome ao paciente, são só para auditoria interna.`
  );

  return parts.join('\n\n');
}
