# ===== Etapa 1: build =====
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# A URL da API tem de existir no momento do build (o Vite injecta-a no bundle).
# No Easypanel, define VITE_API_URL nas variaveis/build args do servico.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ===== Etapa 2: servir estatico com nginx =====
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Fallback de SPA: todas as rotas caem no index.html
RUN printf 'server {\n    listen 80;\n    location / {\n        root /usr/share/nginx/html;\n        try_files $uri $uri/ /index.html;\n    }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
