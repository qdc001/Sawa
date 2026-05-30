# ===== Etapa 1: build =====
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Sem VITE_API_URL: o frontend usa caminhos relativos (/api, /uploads, /socket.io)
# e o nginx encaminha-os para o backend. Mesma origem, sem CORS, sem URL no build.
RUN npm run build

# ===== Etapa 2: servir estatico + proxy com nginx =====
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Configuracao com SPA fallback + proxy de /api, /uploads e /socket.io para o backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
