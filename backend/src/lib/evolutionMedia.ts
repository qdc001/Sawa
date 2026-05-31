// Helper para descarregar media (imagem/video/audio/documento) da Evolution
// para a pasta local `uploads/`, devolvendo o caminho relativo.
//
// Usado pelo webhook (mensagens em tempo real) e pela sync inicial.

import fs from 'fs';
import path from 'path';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export async function fetchMediaFromEvolution(
  creds: any,
  baileysMessage: any,
  fallbackExt: string,
  timeoutMs: number = 15000,
): Promise<string | null> {
  if (!creds?.baseUrl || !creds?.apiKey || !creds?.instanceName) return null;
  try {
    // Timeout para evitar que um download lento bloqueie a thread do webhook
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${creds.baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${creds.instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
        body: JSON.stringify({ message: { key: baileysMessage.key, message: baileysMessage.message } }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      console.error('getBase64FromMediaMessage failed:', await res.text());
      return null;
    }
    const data = await res.json();
    const base64 = data?.base64 || data?.media || data;
    if (!base64 || typeof base64 !== 'string') return null;
    const mimeType: string = data?.mimetype || data?.mimeType || '';
    let ext = fallbackExt;
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    if (MIME_TO_EXT[cleanMime]) {
      ext = MIME_TO_EXT[cleanMime];
    } else if (cleanMime.includes('/')) {
      const t = cleanMime.split('/')[1];
      ext = t.replace(/[^a-z0-9]/g, '').substring(0, 8) || fallbackExt;
    }
    const fileName = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${fileName}`;
  } catch (e) {
    console.error('fetchMediaFromEvolution error:', e);
    return null;
  }
}

// Devolve URL público completo a partir do caminho relativo `/uploads/xxx`
export function publicMediaUrl(relativePath: string): string {
  const base = process.env.PUBLIC_API_URL || '';
  if (!base) return relativePath;
  return `${base.replace(/\/$/, '')}${relativePath.startsWith('/') ? relativePath : '/' + relativePath}`;
}
