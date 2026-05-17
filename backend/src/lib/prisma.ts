// Singleton do Prisma Client.
//
// Cada `new PrismaClient()` abre o seu próprio pool de conexões (default 10).
// Importar vários create-instances do projecto = dezenas de pools = esgotamento
// rápido do connection pool do PostgreSQL e crashes sob carga.
//
// Em desenvolvimento, o ts-node/nodemon faz hot-reload e cria novos módulos —
// guardamos a instância em `global` para sobreviver ao reload e não vazar conexões.

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export default prisma;
