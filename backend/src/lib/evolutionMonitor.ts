/**
 * Monitor de saúde das instâncias Evolution.
 *
 * - Verifica o estado de cada integração Evolution activa a cada 5 minutos
 * - Se detectar estado != 'open', tenta /instance/connect/{name} (auto-reconnect)
 * - Se persistir desconectada por >15 min, emite evento socket para notificar o user
 * - Mantém um Map em memória do último estado conhecido por instância
 */

import prisma from './prisma';
import { getCreds, encryptForStore } from './integrationCrypto';

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
      lastStateMap.set(key, { state, since: now, warnedAt: 0 });
      continue;
    }

    // Estado != 'open'. Registar quando começou
    const sinceStart = prev?.state === state ? prev.since : now;
    lastStateMap.set(key, { state, since: sinceStart, warnedAt: prev?.warnedAt || 0 });

    const elapsedMs = now - sinceStart;

    // Tentar reconectar se 'close' ou 'unknown'/'error', mas só nos primeiros 30 min após cair.
    // Depois disso a instância está provavelmente morta e só re-escanear o QR resolve — continuar
    // a martelar /instance/connect só polui logs e gera carga inútil.
    if (
      (state === 'close' || state === 'connecting' || state === 'unknown' || state === 'error') &&
      elapsedMs < 30 * 60_000
    ) {
      try {
        await evolutionPost(creds, `/instance/connect/${creds.instanceName}`, {});
        // só logar a 1ª vez por cada janela de 5 min
        if (!prev || prev.state !== state || now - prev.since > 5 * 60_000) {
          console.log(`Evolution auto-reconnect tentado para ${creds.instanceName} (state era ${state})`);
        }
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
    }
  }
}
