// Rate limiters baseados em express-rate-limit. Tres niveis:
//   - apiLimiter: geral, generoso (200/min por IP)
//   - authLimiter: estrito no login/register (10/15min por IP)
//   - expensiveLimiter: endpoints caros como LLM e uploads (30/min por IP)
//
// Ao contrario do rateLimiter caseiro que substituimos, este:
//   - Guarda estado com validacao de headers
//   - Suporta trust proxy (necessario atras do nginx)
//   - Devolve headers X-RateLimit-* padrao
//   - Tem melhor cleanup de memoria

import rateLimit from 'express-rate-limit';

// Global: 200 pedidos por minuto por IP. Alto o suficiente para uso normal
// (mesmo com socket.io polling activo), baixo o suficiente para bloquear
// bots de scraping ou brute force.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { message: 'Muitas requisicoes. Tente novamente em breve.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login/register: 10 tentativas por 15 minutos por IP. Impede brute force
// mas nao bloqueia um utilizador que se engane 2-3 vezes na password.
// Usa skipSuccessfulRequests para nao contar logins bem sucedidos (a pool
// nao esgota so por o utilizador se enganar e depois acertar).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Demasiadas tentativas de acesso. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Endpoints caros (LLM, upload grande): 30 pedidos por minuto por IP.
// Impede um cliente comprometido esgotar quota LLM ou saturar disco.
export const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { message: 'Demasiados pedidos consecutivos. Aguarda um momento.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Alias para compatibilidade com codigo antigo que importava rateLimiter.
export const rateLimiter = apiLimiter;
