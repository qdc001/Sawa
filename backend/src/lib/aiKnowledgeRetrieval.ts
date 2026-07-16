// Retrieval da base de conhecimento (Sprint 4 do cumprimento do manual).
//
// Estrategia v1: pesquisa full-text nativa do PostgreSQL (pg_trgm / to_tsvector).
// Nao usamos embeddings (evita dependencia OpenAI ou pgvector para ja).
// Quando a colleccao crescer para >5k chunks, migramos para pgvector.
//
// A query e a ultima mensagem do paciente. Devolvemos os N chunks com
// score mais alto, cada um com o titulo do documento pai.

import prisma from './prisma';

// Palavras vazias em PT que ignoramos para nao poluir o match.
const STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'para', 'com', 'sem', 'e', 'ou', 'mas', 'que', 'se', 'ja',
  'nao', 'sim', 'ola', 'boa', 'bom', 'tarde', 'noite', 'dia',
  'muito', 'muita', 'pouco', 'mais', 'menos',
  'seu', 'sua', 'seus', 'suas', 'meu', 'minha', 'meus', 'minhas',
]);

function extractKeywords(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove acentos
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface KnowledgeMatch {
  documentTitle: string;
  content: string;
  score: number;
}

export async function retrieveRelevantKnowledge(
  workspaceId: string,
  query: string,
  topK = 3,
): Promise<KnowledgeMatch[]> {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  // Carregar todos os chunks activos do workspace. Se crescer, otimizar
  // com indice GIN + to_tsvector.
  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      workspaceId,
      document: { isActive: true },
    },
    include: { document: { select: { title: true } } },
    take: 500,
  });
  if (chunks.length === 0) return [];

  // Scoring: contagem de keywords que aparecem no chunk. Bonus se palavras
  // aparecem proximas no texto original.
  const scored = chunks.map((c) => {
    const contentLower = c.content.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let score = 0;
    for (const kw of keywords) {
      // Escapar caracteres especiais de regex do keyword antes de o usar num pattern
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const occurrences = (contentLower.match(new RegExp(`\\b${escaped}\\b`, 'g')) || []).length;
      score += occurrences;
    }
    return { chunk: c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({
      documentTitle: s.chunk.document.title,
      content: s.chunk.content,
      score: s.score,
    }));
}

// Fatia o texto em chunks de ~500 palavras (default). Preserva paragrafos.
export function chunkDocumentText(fullText: string, maxWordsPerChunk = 500): string[] {
  const paragraphs = fullText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    const words = p.split(/\s+/).length;
    if (count + words > maxWordsPerChunk && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [];
      count = 0;
    }
    current.push(p);
    count += words;
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}
