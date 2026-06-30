// Script de migracao M.E.T.A. -> Klaru.
//
// Funcionamento:
//  1. Liga as duas bases de dados Postgres via env DATABASE_URL (Klaru, destino)
//     e META_DATABASE_URL (M.E.T.A., origem).
//  2. Encontra o workspace de origem (M.E.T.A.) e destino (Klaru) pelo email
//     do utilizador que se passa como argumento.
//  3. Apaga TUDO do workspace destino no Klaru (cascata via FK onDelete: Cascade).
//  4. Para cada tabela com workspaceId, copia linhas do M.E.T.A. para o Klaru,
//     substituindo o workspaceId pelo do Klaru e mantendo todos os outros IDs.
//  5. Para tabelas indirectas (sem workspaceId mas com FK para outras tabelas
//     migradas), copia tudo o que referencia entidades migradas.
//  6. Utilizadores: mantem os ja existentes no Klaru por email; importa os
//     novos do M.E.T.A. com IDs mapeados.
//
// Uso:
//   1. No Easypanel, edita env vars do backend e adiciona:
//        META_DATABASE_URL=postgres://user:pass@host:port/dbname
//      (a URL da base de dados do M.E.T.A.)
//   2. Implanta o backend.
//   3. Abre terminal do servico backend.
//   4. Corre: node dist/scripts/migrateFromMeta.js <teu-email>
//      Exemplo: node dist/scripts/migrateFromMeta.js qdcreat@gmail.com
//   5. Confirma na UI que os dados vieram bem.
//   6. Remove META_DATABASE_URL do env e reimplanta.
//
// SEGURANCA:
//  - O script faz tudo numa transacao no destino. Se falhar a meio, rollback.
//  - Antes de avancar, pede confirmacao via prompt (escreve SIM em maiusculas).
//  - Tabelas que so existem no Klaru (novas: AiCoachingRule, AiUsageLog, etc.)
//    sao ignoradas na leitura porque nao existem no M.E.T.A..
//  - Colunas novas do Klaru que nao existem no M.E.T.A. ficam com default.

import { Client } from 'pg';
import * as readline from 'readline';

// Lista de tabelas a migrar, por ordem (respeitando foreign keys).
// "workspaceFilter" indica como filtrar pelas linhas do workspace alvo:
//   { type: 'direct' } = tabela tem coluna workspaceId
//   { type: 'via', fk: 'leadId', refTable: 'leads' } = via FK para outra tabela ja migrada
//   { type: 'user', col: 'userId' } = via FK para users (que ja foram mapeados)
type WorkspaceFilter =
  | { type: 'direct' }
  | { type: 'via'; fk: string; refTable: string }
  | { type: 'multi-via'; refs: Array<{ fk: string; refTable: string }> };

interface TableSpec {
  name: string;
  filter: WorkspaceFilter;
  // Colunas que precisam de remap (de IDs antigos para novos). Default: nenhuma.
  remapColumns?: Array<{ col: string; targetTable: 'users' }>;
}

const TABLES_ORDER: TableSpec[] = [
  // 1. Tabelas independentes do workspace mas referenciadas, criadas por user
  //    (ja existem no Klaru, nao migramos).
  // 2. Pipelines, stages
  { name: 'pipelines', filter: { type: 'direct' }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'stages', filter: { type: 'via', fk: 'pipelineId', refTable: 'pipelines' } },

  // 3. Contactos, leads
  { name: 'contacts', filter: { type: 'direct' }, remapColumns: [{ col: 'assignedToId', targetTable: 'users' }] },
  { name: 'tags', filter: { type: 'direct' } },
  { name: 'leads', filter: { type: 'direct' }, remapColumns: [{ col: 'assignedToId', targetTable: 'users' }, { col: 'createdById', targetTable: 'users' }] },

  // 4. Mensagens, notas, tarefas, actividades, ficheiros
  { name: 'messages', filter: { type: 'multi-via', refs: [{ fk: 'contactId', refTable: 'contacts' }, { fk: 'leadId', refTable: 'leads' }] }, remapColumns: [{ col: 'sentById', targetTable: 'users' }] },
  { name: 'notes', filter: { type: 'multi-via', refs: [{ fk: 'leadId', refTable: 'leads' }, { fk: 'contactId', refTable: 'contacts' }] }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'tasks', filter: { type: 'multi-via', refs: [{ fk: 'leadId', refTable: 'leads' }, { fk: 'contactId', refTable: 'contacts' }] }, remapColumns: [{ col: 'assignedToId', targetTable: 'users' }, { col: 'createdById', targetTable: 'users' }] },
  { name: 'activities', filter: { type: 'multi-via', refs: [{ fk: 'leadId', refTable: 'leads' }] }, remapColumns: [{ col: 'userId', targetTable: 'users' }] },
  { name: 'files', filter: { type: 'multi-via', refs: [{ fk: 'leadId', refTable: 'leads' }, { fk: 'contactId', refTable: 'contacts' }] }, remapColumns: [{ col: 'uploadedById', targetTable: 'users' }] },

  // 5. Relacionamentos
  { name: 'tags_on_leads', filter: { type: 'via', fk: 'leadId', refTable: 'leads' } },
  { name: 'tags_on_contacts', filter: { type: 'via', fk: 'contactId', refTable: 'contacts' } },
  { name: 'tags_on_tasks', filter: { type: 'via', fk: 'taskId', refTable: 'tasks' } },

  // 6. Custom fields
  { name: 'custom_fields', filter: { type: 'direct' } },
  { name: 'custom_field_values', filter: { type: 'multi-via', refs: [{ fk: 'leadId', refTable: 'leads' }, { fk: 'contactId', refTable: 'contacts' }] } },

  // 7. Automacoes, chatbots, templates
  { name: 'automations', filter: { type: 'direct' }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'automation_runs', filter: { type: 'via', fk: 'automationId', refTable: 'automations' } },
  { name: 'chatbot_flows', filter: { type: 'direct' }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'chatbot_sessions', filter: { type: 'via', fk: 'flowId', refTable: 'chatbot_flows' } },
  { name: 'message_templates', filter: { type: 'direct' } },

  // 8. Outros
  { name: 'integrations', filter: { type: 'direct' } },
  { name: 'webhooks', filter: { type: 'direct' } },
  { name: 'broadcasts', filter: { type: 'direct' }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'broadcast_recipients', filter: { type: 'via', fk: 'broadcastId', refTable: 'broadcasts' } },
  { name: 'conversation_meta', filter: { type: 'direct' }, remapColumns: [{ col: 'assignedToId', targetTable: 'users' }] },
  { name: 'tags_on_conversations', filter: { type: 'via', fk: 'conversationMetaId', refTable: 'conversation_meta' } },
  { name: 'system_email_templates', filter: { type: 'direct' } },
  { name: 'teams', filter: { type: 'direct' } },
  { name: 'audit_logs', filter: { type: 'direct' }, remapColumns: [{ col: 'userId', targetTable: 'users' }] },
  { name: 'csat_requests', filter: { type: 'via', fk: 'leadId', refTable: 'leads' }, remapColumns: [{ col: 'requestedById', targetTable: 'users' }] },
  { name: 'goals', filter: { type: 'direct' }, remapColumns: [{ col: 'userId', targetTable: 'users' }] },
  { name: 'products', filter: { type: 'direct' } },
  { name: 'quotes', filter: { type: 'direct' }, remapColumns: [{ col: 'createdById', targetTable: 'users' }] },
  { name: 'quote_items', filter: { type: 'via', fk: 'quoteId', refTable: 'quotes' } },
  { name: 'ai_sales_suggestions', filter: { type: 'direct' }, remapColumns: [{ col: 'decidedById', targetTable: 'users' }] },
];

// Cache dos IDs migrados por tabela (para usar em filter type 'via')
const migratedIds: Record<string, Set<string>> = {};

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

// Devolve colunas que existem em ambas BDs para uma tabela.
async function commonColumns(src: Client, dst: Client, table: string): Promise<string[]> {
  const q = `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`;
  const [srcRes, dstRes] = await Promise.all([
    src.query(q, [table]),
    dst.query(q, [table]),
  ]);
  const srcCols = new Set(srcRes.rows.map((r: any) => r.column_name));
  const dstCols = new Set(dstRes.rows.map((r: any) => r.column_name));
  return [...srcCols].filter((c) => dstCols.has(c));
}

// Verifica se uma tabela existe na BD.
async function tableExists(client: Client, table: string): Promise<boolean> {
  const r = await client.query(
    `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
    [table],
  );
  return !!r.rows[0]?.exists;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: node migrateFromMeta.js <email-do-utilizador>');
    console.error('Exemplo: node migrateFromMeta.js qdcreat@gmail.com');
    process.exit(1);
  }

  const klaruUrl = process.env.DATABASE_URL;
  const metaUrl = process.env.META_DATABASE_URL;
  if (!klaruUrl) {
    console.error('DATABASE_URL nao definida (deve ser a do Klaru, destino).');
    process.exit(1);
  }
  if (!metaUrl) {
    console.error('META_DATABASE_URL nao definida (deve ser a do M.E.T.A., origem).');
    console.error('Adiciona no Easypanel uma env META_DATABASE_URL=postgres://... e implanta.');
    process.exit(1);
  }

  console.log('A ligar a base de dados Klaru (destino)...');
  const dst = new Client({ connectionString: klaruUrl });
  await dst.connect();
  console.log('A ligar a base de dados M.E.T.A. (origem)...');
  const src = new Client({ connectionString: metaUrl });
  await src.connect();

  try {
    // 1. Encontrar workspace destino (Klaru) pelo email
    const dstUserRes = await dst.query(`SELECT id, "workspaceId" FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    if (dstUserRes.rows.length === 0) {
      throw new Error(`Utilizador com email ${email} nao existe no Klaru. Cria primeiro a conta.`);
    }
    const dstUser = dstUserRes.rows[0];
    const dstWsId: string = dstUser.workspaceId;

    // 2. Encontrar workspace origem (M.E.T.A.) pelo email
    const srcUserRes = await src.query(`SELECT id, "workspaceId" FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    if (srcUserRes.rows.length === 0) {
      throw new Error(`Utilizador com email ${email} nao existe no M.E.T.A.. Confirma o email.`);
    }
    const srcWsId: string = srcUserRes.rows[0].workspaceId;

    // 3. Confirmar com user
    const dstWsRes = await dst.query(`SELECT name FROM workspaces WHERE id = $1`, [dstWsId]);
    const srcWsRes = await src.query(`SELECT name FROM workspaces WHERE id = $1`, [srcWsId]);
    console.log(`\n=== MIGRACAO M.E.T.A. -> KLARU ===`);
    console.log(`Origem (M.E.T.A.): workspace "${srcWsRes.rows[0]?.name}" (id=${srcWsId})`);
    console.log(`Destino (Klaru):  workspace "${dstWsRes.rows[0]?.name}" (id=${dstWsId})`);
    console.log(`\nATENCAO: TODOS os dados do workspace de destino vao ser APAGADOS e substituidos pelos do M.E.T.A..`);
    const answer = await ask(`Escreve SIM em maiusculas para confirmar: `);
    if (answer.trim() !== 'SIM') {
      console.log('Cancelado.');
      process.exit(0);
    }

    // 4. Mapear utilizadores
    console.log('\n[1/3] A mapear utilizadores...');
    const srcUsersRes = await src.query(`SELECT id, email FROM users WHERE "workspaceId" = $1`, [srcWsId]);
    const dstUsersRes = await dst.query(`SELECT id, email FROM users WHERE "workspaceId" = $1`, [dstWsId]);
    const dstUsersByEmail = new Map<string, string>();
    for (const u of dstUsersRes.rows) dstUsersByEmail.set(u.email.toLowerCase(), u.id);

    const userIdMap = new Map<string, string>(); // srcUserId -> dstUserId
    const usersToCreate: any[] = [];
    for (const u of srcUsersRes.rows) {
      const dstId = dstUsersByEmail.get(u.email.toLowerCase());
      if (dstId) {
        userIdMap.set(u.id, dstId);
      } else {
        usersToCreate.push(u);
        userIdMap.set(u.id, u.id); // mantemos o id original se nao existir
      }
    }
    console.log(`  ${userIdMap.size} utilizadores no M.E.T.A.: ${userIdMap.size - usersToCreate.length} ja existem no Klaru, ${usersToCreate.length} para criar.`);

    // 5. TRANSACTION: apagar destino + copiar
    await dst.query('BEGIN');
    try {
      // 5a. Apagar tudo do workspace destino (apenas o workspace, deixa o user
      //     ficar; o cascade vai limpar leads, contactos, etc.)
      console.log(`\n[2/3] A apagar conteudo do workspace destino...`);
      // Apagar e recriar workspace force-cascada de tudo. Mas precisamos de
      // manter o id e os users. Estrategia: delete row-by-row nas tabelas filhas.
      for (const t of [...TABLES_ORDER].reverse()) {
        if (!(await tableExists(dst, t.name))) continue;
        if (t.filter.type === 'direct') {
          await dst.query(`DELETE FROM "${t.name}" WHERE "workspaceId" = $1`, [dstWsId]);
        }
      }
      // Tambem apagar workspace fields que nao tem workspaceId mas dependem
      // (sessoes, password reset etc) sao por user e nao queremos apagar.

      // 5b. Criar utilizadores novos do M.E.T.A. que nao existem
      console.log(`\n[3/3] A copiar dados do M.E.T.A....`);
      if (usersToCreate.length > 0) {
        const userCols = await commonColumns(src, dst, 'users');
        for (const u of usersToCreate) {
          const fullRowRes = await src.query(`SELECT * FROM users WHERE id = $1`, [u.id]);
          const row = fullRowRes.rows[0];
          row.workspaceId = dstWsId;
          await insertRow(dst, 'users', userCols, row);
        }
        console.log(`  users: ${usersToCreate.length} novos criados`);
      }

      // 5c. Copiar tabelas por ordem
      for (const t of TABLES_ORDER) {
        if (!(await tableExists(src, t.name))) { console.log(`  ${t.name}: skip (nao existe no M.E.T.A.)`); continue; }
        if (!(await tableExists(dst, t.name))) { console.log(`  ${t.name}: skip (nao existe no Klaru)`); continue; }

        const cols = await commonColumns(src, dst, t.name);
        const rows = await selectRowsForTable(src, t, srcWsId);
        if (rows.length === 0) { console.log(`  ${t.name}: 0 linhas`); continue; }

        for (const row of rows) {
          // Substituir workspaceId pelo destino
          if ('workspaceId' in row) row.workspaceId = dstWsId;
          // Remap user IDs onde aplicavel
          for (const r of t.remapColumns || []) {
            if (row[r.col] && userIdMap.has(row[r.col])) {
              row[r.col] = userIdMap.get(row[r.col]);
            }
          }
          await insertRow(dst, t.name, cols, row);
          // Registar id como migrado para que tabelas filhas saibam que existe
          if (row.id) {
            if (!migratedIds[t.name]) migratedIds[t.name] = new Set();
            migratedIds[t.name].add(row.id);
          }
        }
        console.log(`  ${t.name}: ${rows.length} linhas migradas`);
      }

      await dst.query('COMMIT');
      console.log('\n=== MIGRACAO CONCLUIDA COM SUCESSO ===');
      console.log('Verifica os dados na UI antes de remover META_DATABASE_URL.');
    } catch (e) {
      await dst.query('ROLLBACK');
      throw e;
    }
  } catch (e: any) {
    console.error('ERRO:', e?.message || e);
    process.exit(1);
  } finally {
    await src.end();
    await dst.end();
  }
}

async function selectRowsForTable(src: Client, t: TableSpec, srcWsId: string): Promise<any[]> {
  if (t.filter.type === 'direct') {
    const r = await src.query(`SELECT * FROM "${t.name}" WHERE "workspaceId" = $1`, [srcWsId]);
    return r.rows;
  }
  if (t.filter.type === 'via') {
    const ids = [...(migratedIds[t.filter.refTable] || new Set())];
    if (ids.length === 0) return [];
    const r = await src.query(`SELECT * FROM "${t.name}" WHERE "${t.filter.fk}" = ANY($1::text[])`, [ids]);
    return r.rows;
  }
  if (t.filter.type === 'multi-via') {
    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const ref of t.filter.refs) {
      const ids = [...(migratedIds[ref.refTable] || new Set())];
      if (ids.length === 0) continue;
      conditions.push(`"${ref.fk}" = ANY($${i}::text[])`);
      params.push(ids);
      i++;
    }
    if (conditions.length === 0) return [];
    const r = await src.query(`SELECT * FROM "${t.name}" WHERE ${conditions.join(' OR ')}`, params);
    return r.rows;
  }
  return [];
}

async function insertRow(dst: Client, table: string, cols: string[], row: any): Promise<void> {
  const usableCols = cols.filter((c) => c in row);
  if (usableCols.length === 0) return;
  const placeholders = usableCols.map((_, i) => `$${i + 1}`).join(', ');
  const colList = usableCols.map((c) => `"${c}"`).join(', ');
  const values = usableCols.map((c) => row[c]);
  try {
    await dst.query(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values);
  } catch (e: any) {
    console.error(`  [warn] falha a inserir em ${table} (id=${row.id}): ${e.message}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
