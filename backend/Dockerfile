# ===== Etapa 1: build =====
FROM node:20-alpine AS builder
WORKDIR /app

# Instalar dependencias (inclui dev, necessarias para o tsc)
COPY package*.json ./
RUN npm ci

# Copiar codigo, gerar cliente Prisma e compilar TypeScript
COPY . .
RUN npx prisma generate && npm run build

# ===== Etapa 2: producao =====
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Trazer node_modules (com cliente Prisma gerado), build e schema
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Pasta de uploads (montar volume persistente em /app/uploads no Easypanel)
RUN mkdir -p uploads

EXPOSE 3001

# Aplica o schema a base de dados e arranca o servidor
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
