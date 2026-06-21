import { io, Socket } from 'socket.io-client';

// Singleton: criamos UM socket por sessao e deixamos o Socket.io tratar
// da reconexao internamente. Antes, getSocket criava um NOVO socket quando
// o antigo estava desconectado (mesmo durante a janela de reconexao
// automatica), o que perdia os listeners ja registados nos componentes e
// fazia parecer que o tempo real estava partido (mensagens novas so
// apareciam ao recarregar a conversa).
//
// Quem precisa saber quando a conexao volta deve registar:
//   socket.on('connect', () => { ... re-join rooms ... })
// que o Socket.io dispara em todas as reconexoes automaticas.

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (socket) return socket;
  const url = (import.meta.env as any).VITE_API_URL;
  if (!url) return null;
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
