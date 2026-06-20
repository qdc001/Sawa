// Servico da IA Vendedora (Fase 3, parte 1).
//
// Responsabilidade: dado um contacto/lead com uma conversa em curso,
// produzir uma sugestao de resposta estruturada e persisti-la como
// AiSalesSuggestion (estado PENDING em modo supervisionado).
//
// Quem chama este servico:
//   - Endpoint POST /api/sales-agent/suggest (modo manual, para testes
//     e botao "Sugerir resposta" no Inbox)
//   - Webhook do Inbox quando aiSalesEnabled (ou conversa especifica)
//     esta ligado (a ligar na parte 2 desta fase)
//
// Nao envia nada para o WhatsApp por si proprio. O envio depende do
// modo (supervised vs auto) e e feito pelo endpoint de aprovacao.

import prisma from './prisma';
import { buildSalesSystemPrompt } from './buildSalesSystemPrompt';
import { callGroqJsonWithLimiter } from './groqLimiter';
import { SALES_PRINCIPLES, DEFAULT_ACTIVE_PRINCIPLES } from '../data/salesKnowledge';

const MAX_HISTORY = 15; // ultimas N mensagens a incluir no prompt
const MAX_PRODUCTS_IN_CATALOG = 30; // truncar catalogo para nao estourar tokens

export type GenerateOptions = {
  workspaceId: string;
  contactId: string;
  // Lead opcional: se vier, a IA tem acesso a titulo e valor.
  leadId?: string | null;
  // Mensagem inbound que disparou a geracao (id). Opcional: se omitido,
  // usa a ultima mensagem inbound do contacto.
  triggerMessageId?: string | null;
  // Chaves de principios a forcar. Se vazio, usa o default do workspace.
  activePrincipleKeys?: string[];
  // Forca o modelo Groq. Se omitido, usa GROQ_MODEL ou llama-3.3-70b.
  model?: string;
};

export type AgentSuggestion = {
  action: 'send_text' | 'send_product' | 'handoff' | 'wait';
  parts: string[];
  productId: string | null;
  principlesUsed: string[];
  reasoning: string;
};

export class AgentError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

// Sanitiza o JSON devolvido pela Groq para a forma estavel que esperamos.
function normalizeSuggestion(raw: any, maxParts: number): AgentSuggestion {
  const allowedActions = new Set(['send_text', 'send_product', 'handoff', 'wait']);
  const action = allowedActions.has(raw?.action) ? raw.action : 'send_text';

  const partsRaw = Array.isArray(raw?.parts) ? raw.parts : (Array.isArray(raw?.messages) ? raw.messages : []);
  const parts = partsRaw
    .filter((p: any) => typeof p === 'string' && p.trim().length > 0)
    .map((p: string) => p.trim())
    .slice(0, Math.max(1, maxParts));

  const productId = typeof raw?.productId === 'string' && raw.productId.trim() ? raw.productId.trim() : null;

  const principlesRaw = Array.isArray(raw?.principlesUsed) ? raw.principlesUsed : [];
  const principlesUsed = principlesRaw
    .filter((k: any) => typeof k === 'string' && SALES_PRINCIPLES[k])
    .slice(0, 8);

  const reasoning = typeof raw?.reasoning === 'string' ? raw.reasoning.trim().slice(0, 500) : '';

  // Se action e send_text e nao ha parts, isso e invalido.
  if ((action === 'send_text' || action === 'send_product') && parts.length === 0) {
    throw new AgentError('IA devolveu resposta sem mensagens utilizaveis', 502);
  }

  // Se action e send_product mas o productId esta vazio, degrade para send_text.
  if (action === 'send_product' && !productId) {
    return { action: 'send_text', parts, productId: null, principlesUsed, reasoning };
  }

  return { action, parts, productId, principlesUsed, reasoning };
}

export async function generateSalesSuggestion(opts: GenerateOptions) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new AgentError('GROQ_API_KEY nao configurada no ambiente', 500);

  const model = opts.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  // 1. Carrega contexto: workspace, contacto, lead, ultimas mensagens, produtos.
  const [workspace, contact, lead, messages, products] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: opts.workspaceId } }),
    prisma.contact.findUnique({ where: { id: opts.contactId } }),
    opts.leadId ? prisma.lead.findUnique({ where: { id: opts.leadId } }) : Promise.resolve(null),
    prisma.message.findMany({
      where: {
        contactId: opts.contactId,
        ...(opts.leadId ? { OR: [{ leadId: opts.leadId }, { leadId: null }] } : {}),
        type: { in: ['TEXT', 'TEMPLATE', 'IMAGE', 'AUDIO', 'DOCUMENT', 'INTERACTIVE'] as any },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
    }),
    prisma.product.findMany({
      where: { workspaceId: opts.workspaceId, isActive: true },
      include: { _count: { select: { files: true } } },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PRODUCTS_IN_CATALOG,
    }),
  ]);

  if (!workspace) throw new AgentError('Workspace nao encontrado', 404);
  if (!contact) throw new AgentError('Contacto nao encontrado', 404);

  if (messages.length === 0) {
    throw new AgentError('Sem historico de conversa para basear a sugestao', 400);
  }

  // 2. Determina a mensagem trigger.
  let triggerMessageId = opts.triggerMessageId || null;
  if (!triggerMessageId) {
    const lastInbound = messages.find((m) => m.direction === 'INBOUND');
    triggerMessageId = lastInbound?.id || null;
  }

  // 3. Constroi o system prompt com catalogo + persona + principios + sector.
  const maxParts = Math.max(1, Math.min(workspace.aiSalesMaxParts || 4, 6));
  const activeKeys = (opts.activePrincipleKeys && opts.activePrincipleKeys.length > 0)
    ? opts.activePrincipleKeys
    : DEFAULT_ACTIVE_PRINCIPLES;

  const systemPrompt = buildSalesSystemPrompt(workspace, {
    activePrincipleKeys: activeKeys,
    maxFragments: maxParts,
    productCatalog: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      unitPrice: p.unitPrice,
      currency: p.currency,
      fileCount: (p as any)._count?.files || 0,
    })),
  });

  // 4. Monta o historico (ordem cronologica, mais antigo primeiro).
  const history = messages.slice().reverse().map((m) => {
    const role = m.direction === 'INBOUND' ? 'user' : 'assistant';
    // Para mensagens nao-texto, usa um placeholder util.
    let content = m.content || '';
    if (!content && m.type === 'AUDIO') content = m.transcription || '[audio]';
    if (!content && m.type === 'IMAGE') content = '[imagem enviada]';
    if (!content && m.type === 'DOCUMENT') content = '[documento enviado]';
    if (!content) content = `[${m.type}]`;
    return { role, content: content.slice(0, 2000) };
  });

  // 5. Bloco de contexto curto sobre o lead (se houver).
  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const leadContext: string[] = [];
  leadContext.push(`Contacto: ${contactName || 'sem nome'}${contact.company ? ` (${contact.company})` : ''}.`);
  if (lead) {
    leadContext.push(`Lead aberto: "${lead.title}"${lead.value ? `, valor estimado ${lead.value} ${lead.currency}` : ''}, prioridade ${lead.priority}, estado ${lead.status}.`);
  }
  const contextMessage = {
    role: 'system',
    content: `Contexto do lead actual:\n${leadContext.join('\n')}`,
  };

  // 6. Chama Groq em modo JSON.
  let groqResult: { json: any; raw: string; promptTokens?: number; completionTokens?: number };
  try {
    groqResult = await callGroqJsonWithLimiter(
      apiKey,
      model,
      [
        { role: 'system', content: systemPrompt },
        contextMessage,
        ...history,
      ],
      800,
      0.5,
    );
  } catch (e: any) {
    throw new AgentError(`Groq falhou: ${e?.message || e}`, e?.status || 502);
  }

  // 7. Normaliza e persiste.
  const suggestion = normalizeSuggestion(groqResult.json, maxParts);

  const saved = await prisma.aiSalesSuggestion.create({
    data: {
      workspaceId: opts.workspaceId,
      contactId: opts.contactId,
      leadId: opts.leadId || null,
      triggerMessageId: triggerMessageId,
      parts: suggestion.parts as any,
      action: suggestion.action,
      productId: suggestion.productId,
      productFileIds: [] as any,
      reasoning: suggestion.reasoning,
      principlesUsed: suggestion.principlesUsed as any,
      modelUsed: model,
      promptTokens: groqResult.promptTokens || null,
      completionTokens: groqResult.completionTokens || null,
      status: 'PENDING',
    },
  });

  // Se a accao for handoff, ja anotamos. Em supervised, o humano confirma.
  // Se a accao for send_product, vamos descobrir que ficheiros enviar.
  if (suggestion.action === 'send_product' && suggestion.productId) {
    const files = await prisma.file.findMany({
      where: { productId: suggestion.productId },
      select: { id: true },
    });
    if (files.length > 0) {
      await prisma.aiSalesSuggestion.update({
        where: { id: saved.id },
        data: { productFileIds: files.map((f) => f.id) as any },
      });
      (saved as any).productFileIds = files.map((f) => f.id);
    }
  }

  return { suggestion: saved, normalized: suggestion };
}
