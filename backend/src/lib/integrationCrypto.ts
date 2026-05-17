// Encriptação de credenciais de Integration.
//
// Antes: Integration.credentials era guardado como JSON plaintext na BD.
// Um dump da BD ou backup não encriptado expunha tokens (Meta accessToken,
// Evolution apiKey, SMTP password, etc.).
//
// Agora: ao gravar passa por encryptForStore() → { __enc, iv, tag, data }.
// Ao ler passa por getCreds() que detecta o formato e desencripta. Mantém
// compatibilidade com credenciais legadas em plaintext (devolve tal como
// estão), o que permite migração progressiva.
//
// Chave:
//  1. process.env.ENCRYPTION_KEY (hex 64 chars = 32 bytes), se definida
//  2. Fallback determinístico: SHA-256(JWT_SECRET) — assim arranca sem
//     env vars novas em deploys existentes, e a chave é estável enquanto
//     JWT_SECRET o for (tokens JWT já dependem disso).

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const seed = process.env.JWT_SECRET || 'fallback-secret-change-me';
  return crypto.createHash('sha256').update(seed).digest();
}

interface EncryptedCreds {
  __enc: '1';
  iv: string;
  tag: string;
  data: string;
}

function isEncrypted(obj: any): obj is EncryptedCreds {
  return obj && typeof obj === 'object' && obj.__enc === '1' && typeof obj.iv === 'string' && typeof obj.tag === 'string' && typeof obj.data === 'string';
}

// Devolve o objecto pronto para guardar em Integration.credentials (Json).
export function encryptForStore(creds: any): EncryptedCreds {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(creds ?? {}), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: '1',
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

// Recebe um Integration (ou só o campo credentials) e devolve sempre um objecto
// desencriptado. Tolera plaintext legado.
export function getCreds(integrationOrCreds: any): Record<string, any> {
  if (!integrationOrCreds) return {};
  const raw = integrationOrCreds.credentials !== undefined ? integrationOrCreds.credentials : integrationOrCreds;
  if (!raw) return {};
  if (isEncrypted(raw)) {
    try {
      const key = getKey();
      const iv = Buffer.from(raw.iv, 'hex');
      const tag = Buffer.from(raw.tag, 'hex');
      const data = Buffer.from(raw.data, 'hex');
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch (e: any) {
      console.error('[integrationCrypto] falha ao desencriptar:', e.message);
      return {};
    }
  }
  // Plaintext legado — devolve tal como está.
  return typeof raw === 'object' ? raw : {};
}

// Migra todas as integrações em plaintext para o formato encriptado.
// Idempotente: ignora as que já estão encriptadas. Chamada uma vez no arranque.
export async function migrateAllCredentialsToEncrypted(prisma: any): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;
  try {
    const all = await prisma.integration.findMany({ select: { id: true, credentials: true } });
    for (const i of all) {
      if (isEncrypted(i.credentials)) {
        skipped++;
        continue;
      }
      const plain = i.credentials || {};
      const encrypted = encryptForStore(plain);
      await prisma.integration.update({ where: { id: i.id }, data: { credentials: encrypted } });
      migrated++;
    }
    if (migrated > 0) console.log(`[integrationCrypto] migradas ${migrated} integrações para formato encriptado (${skipped} já estavam).`);
  } catch (e: any) {
    console.error('[integrationCrypto] erro na migração inicial:', e.message);
  }
  return { migrated, skipped };
}
