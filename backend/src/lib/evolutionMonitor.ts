/**
 * Monitor de saúde das instâncias Evolution.
 *
 * - Verifica o estado de cada integração Evolution activa a cada 5 minutos
 * - Se detectar estado != 'open', tenta /instance/connect/{name} (auto-reconnect)
 * - Se persistir desconectada por >15 min, emite evento socket para notificar o user
 * - Mantém um Map em memória do último estado conhecido por instância
 */

import prisma from './prisma';
import { getCreds } from './integrationCrypto';

const lastStateMap = new Map<string, { state: string; since: number; warnedAt: number; lastAttemptAt: number }>();

// Sessao "surda": a Evolution diz 'open' e os envios funcionam, mas nao entra
// nenhuma mensagem. Visto em producao depois de a Evolution reiniciar: a
// instancia volta a ligar com as chaves guardadas, envia, mas deixa de
// receber ate ser ligada de novo com QR. O estado da ligacao nao denuncia
// isto, por isso olhamos para o trafego: a equipa enviou varias mensagens e
// nao entrou nenhuma durante a janela.
const SILENCE_WINDOW_MS = 45 * 60_000;
const SILENCE_MIN_OUTBOUND = 5;
const silenceMap = new Map<string, { since: number; warnedAt: number }>();

async function checkInboundSilence(integration: { id: string; workspaceId: string }, io: any): Promise<void> {
  const now = Date.now();
  const base = { channel: 'WHATSAPP' as const, isInternal: false, contact: { workspaceId: integration.workspaceId } };
  const since = new Date(now - SILENCE_WINDOW_MS);
  const [outCount, inCount] = await Promise.all([
    prisma.message.count({ where: { ...base, direction: 'OUTBOUND', createdAt: { gte: since } } }),
    prisma.message.count({ where: { ...base, direction: 'INBOUND', createdAt: { gte: since } } }),
  ]);
  const prev = silenceMap.get(integration.id);

  if (inCount > 0) {
    if (prev) {
      silenceMap.delete(integration.id);
      if (io) io.to(`workspace:${integration.workspaceId}`).emit('evolution:state', { state: 'open', recovered: true });
      console.log(`evolutionMonitor: workspace ${integration.workspaceId} voltou a receber mensagens`);
    }
    return;
  }
  if (outCount < SILENCE_MIN_OUTBOUND) return; // pouca actividade: o silencio pode ser normal

  const lastIn = await prisma.message.findFirst({
    where: { ...base, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const minutesSilent = Math.round((now - (lastIn?.createdAt.getTime() ?? since.getTime())) / 60_000);
  const isFirstWarning = !prev;
  if (prev && now - prev.warnedAt < 30 * 60_000) return;
  silenceMap.set(integration.id, { since: prev?.since ?? now, warnedAt: now });

  const message = `Foram enviadas ${outCount} mensagens nos últimos ${SILENCE_WINDOW_MS / 60_000} min e não entrou nenhuma. `
    + 'A sessão pode estar ligada mas sem receber: desliga e volta a ligar o WhatsApp com um QR novo.';
  console.warn(`evolutionMonitor: workspace ${integration.workspaceId} sem mensagens recebidas ha ${minutesSilent} min (${outCount} enviadas)`);
  if (io) {
    io.to(`workspace:${integration.workspaceId}`).emit('evolution:disconnected', {
      state: 'open', minutesDown: minutesSilent,
      title: `WhatsApp sem receber mensagens há ${minutesSilent} min.`, message,
    });
  }
  if (isFirstWarning) {
    try {
      const recipients = await prisma.user.findMany({
        where: { workspaceId: integration.workspaceId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] }, isActive: true },
        select: { id: true },
      });
      await prisma.notification.createMany({
        data: recipients.map((u) => ({
          userId: u.id,
          title: 'WhatsApp não está a receber mensagens',
          body: message,
          type: 'evolution_inbound_silent',
          link: '/integrations',
        })),
      });
    } catch (e: any) {
      console.error('evolutionMonitor: falha a criar notificação de silêncio:', e.message);
    }
  }
}

async function evolutionGet(creds: any, path: string): Promise<any> {
  const r = await fetch(`${creds.baseUrl.replace(/\/$/, '')}${path}`, {
    headers: { apikey: creds.apiKey },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function evolutionPost(creds: any, path: string, body: any = {}): Promise<any> {
  const r = await fetch(`${creds.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function checkEvolutionInstances(): Promise<void> {
  // Só monitorizamos integrações que o utilizador quer ligadas (isActive=true).
  // Quando ele desliga manualmente, isActive passa a false e o monitor deixa de
  // reconectar; senão o auto-reconnect desfazia logo o "Desligar".
  const integrations = await prisma.integration.findMany({
    where: { type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' }, isActive: true },
  });

  const io = (global as any).io;

  for (const integration of integrations) {
    const creds: any = getCreds(integration);
    if (!creds.baseUrl || !creds.apiKey || !creds.instanceName) continue;

    const key = integration.id;
    const now = Date.now();

    let state = 'unknown';
    try {
      const data = await evolutionGet(creds, `/instance/connectionState/${creds.instanceName}`);
      state = data?.instance?.state || data?.state || 'unknown';
    } catch (e: any) {
      state = 'error';
    }

    const prev = lastStateMap.get(key);
    if (state === 'open') {
      // Tudo bem
      if (prev?.state !== 'open') {
        // recuperou — notificar
        if (io) io.to(`workspace:${integration.workspaceId}`).emit('evolution:state', { state: 'open', recovered: true });
      }
      lastStateMap.set(key, { state, since: now, warnedAt: 0, lastAttemptAt: 0 });
      try {
        await checkInboundSilence(integration, io);
      } catch (e: any) {
        console.error('evolutionMonitor: falha a verificar mensagens recebidas:', e.message);
      }
      continue;
    }

    // Estado != 'open'. Registar quando começou
    const sinceStart = prev?.state === state ? prev.since : now;
    const lastAttemptAt = prev?.state === state ? prev.lastAttemptAt : 0;
    lastStateMap.set(key, { state, since: sinceStart, warnedAt: prev?.warnedAt || 0, lastAttemptAt });

    const elapsedMs = now - sinceStart;

    // Tentar reconectar se 'close' ou 'unknown'/'error'. Nos primeiros 30 min
    // tentamos a cada ciclo (5 min); depois disso a instância provavelmente
    // precisa mesmo de um novo QR, mas continuamos a tentar uma vez por hora
    // em vez de desistir de vez — sessões Evolution por vezes recuperam
    // sozinhas horas depois (reinício do servidor, rede instável), e sem
    // reentrada isso ficava para sempre pendente de intervenção humana.
    //
    // 'connecting' é tratado à parte: nesse estado a Evolution/Baileys já
    // está a meio de um handshake (retry interno ou rede instável a
    // recuperar sozinha). Chamar /instance/connect por cima disso cria uma
    // segunda tentativa de ligação em paralelo com a mesma identidade de
    // dispositivo, e o WhatsApp resolve esse conflito desligando a sessão
    // (visto em produção como disconnectionReasonCode 401,
    // tag "conflict"/"device_removed"). Só forçamos reconnect se 'connecting'
    // persistir tempo a mais (>3min), sinal de que ficou preso e não vai
    // resolver-se sozinho.
    const isStuckConnecting = state === 'connecting' && elapsedMs > 3 * 60_000;
    const shouldAttempt =
      (state === 'close' || state === 'unknown' || state === 'error' || isStuckConnecting) &&
      (elapsedMs < 30 * 60_000 || now - lastAttemptAt > 60 * 60_000);
    if (shouldAttempt) {
      try {
        await evolutionPost(creds, `/instance/connect/${creds.instanceName}`, {});
        console.log(`Evolution auto-reconnect tentado para ${creds.instanceName} (state era ${state}, desde ha ${Math.round(elapsedMs / 60_000)}min)`);
      } catch (e) {
        // silent
      }
      lastStateMap.set(key, { state, since: sinceStart, warnedAt: prev?.warnedAt || 0, lastAttemptAt: now });
    }

    // Se persistir desligado >15 min, notificar (apenas uma vez por 30min via
    // socket, mais uma notificação persistida no primeiro aviso para quem
    // não estiver com o Klaru aberto nesse momento).
    if (elapsedMs > 15 * 60_000 && (!prev?.warnedAt || now - prev.warnedAt > 30 * 60_000)) {
      const isFirstWarning = !prev?.warnedAt;
      lastStateMap.set(key, { state, since: sinceStart, warnedAt: now, lastAttemptAt: prev?.lastAttemptAt || 0 });
      const minutesDown = Math.round(elapsedMs / 60_000);
      const message = 'WhatsApp desligado há mais de 15 minutos. Pode ser preciso re-escanear o QR.';
      if (io) {
        io.to(`workspace:${integration.workspaceId}`).emit('evolution:disconnected', { state, minutesDown, message });
      }
      if (isFirstWarning) {
        try {
          const recipients = await prisma.user.findMany({
            where: { workspaceId: integration.workspaceId, role: { in: ['OWNER', 'MANAGER'] }, isActive: true },
            select: { id: true },
          });
          await prisma.notification.createMany({
            data: recipients.map((u) => ({
              userId: u.id,
              title: 'WhatsApp desligado',
              body: message,
              type: 'evolution_disconnected',
              link: '/settings?tab=integrations',
            })),
          });
        } catch (e: any) {
          console.error('evolutionMonitor: falha a criar notificação persistida:', e.message);
        }
      }
    }
  }
}
