/**
 * Monitor de saúde das instâncias Evolution.
 *
 * - Verifica o estado de cada integração Evolution activa a cada 5 minutos
 * - Se detectar estado != 'open', tenta /instance/connect/{name} (auto-reconnect)
 * - Se persistir desconectada por >15 min, emite evento socket para notificar o user
 * - Mantém um Map em memória do último estado conhecido por instância
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const lastStateMap = new Map<string, { state: string; since: number; warnedAt: number }>();

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
  const integrations = await prisma.integration.findMany({
    where: { type: 'WEBHOOK', name: { contains: 'evolution', mode: 'insensitive' } },
  });

  const io = (global as any).io;

  for (const integration of integrations) {
    const creds: any = integration.credentials || {};
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
      lastStateMap.set(key, { state, since: now, warnedAt: 0 });
      // garantir que integration está active
      if (!integration.isActive) {
        await prisma.integration.update({ where: { id: integration.id }, data: { isActive: true } });
      }
      continue;
    }

    // Estado != 'open'. Registar quando começou
    const sinceStart = prev?.state === state ? prev.since : now;
    lastStateMap.set(key, { state, since: sinceStart, warnedAt: prev?.warnedAt || 0 });

    const elapsedMs = now - sinceStart;

    // Tentar reconectar se 'close' ou 'unknown'/'error'
    if (state === 'close' || state === 'connecting' || state === 'unknown' || state === 'error') {
      try {
        await evolutionPost(creds, `/instance/connect/${creds.instanceName}`, {});
        console.log(`Evolution auto-reconnect tentado para ${creds.instanceName} (state era ${state})`);
      } catch (e) {
        // silent
      }
    }

    // Se persistir desligado >15 min, notificar (apenas uma vez por 30min)
    if (elapsedMs > 15 * 60_000 && (!prev?.warnedAt || now - prev.warnedAt > 30 * 60_000)) {
      lastStateMap.set(key, { state, since: sinceStart, warnedAt: now });
      if (io) {
        io.to(`workspace:${integration.workspaceId}`).emit('evolution:disconnected', {
          state,
          minutesDown: Math.round(elapsedMs / 60_000),
          message: 'WhatsApp desligado há mais de 15 minutos. Pode ser preciso re-escanear o QR.',
        });
      }
      // marcar integração inactiva
      await prisma.integration.update({ where: { id: integration.id }, data: { isActive: false } }).catch(() => {});
    }
  }
}
