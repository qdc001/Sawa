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
    const shouldAttempt =
      (state === 'close' || state === 'connecting' || state === 'unknown' || state === 'error') &&
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
