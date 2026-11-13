import api from '../../lib/api';
import { downloadFile } from '../../lib/downloadFile';

// Envia o ficheiro dos slides e devolve o endereco (/uploads/...) e o nome.
export async function uploadSlides(file: File): Promise<{ slidesUrl: string; slidesName: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 300000 });
  return { slidesUrl: data.url, slidesName: data.name || file.name };
}

export function openSlides(url: string, name: string | null) {
  const base = (import.meta.env.VITE_API_URL as string | undefined) || '';
  downloadFile(`${base}${url}`, name || 'slides');
}

export const SLIDES_ACCEPT = '.pdf,.ppt,.pptx,.odp,.doc,.docx';
