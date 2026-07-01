// Faz download de um ficheiro forcando o nome original.
//
// Porque nao usar simplesmente <a href download="...">?
// Porque o atributo `download` do HTML e ignorado quando a URL e cross-origin.
// Como o backend (sawa-backend.*) e o frontend (sawa-frontend.*) estao em
// dominios diferentes, o browser usa sempre o nome do URL (que e o nome
// mangled no disco: `wa_1234_xyz.doc`).
//
// Solucao: fetch do ficheiro como blob (a mesma request cross-origin, mas
// controlada por JS) e criar um objectURL que ja e same-origin, o que
// permite ao browser respeitar o atributo download.

import toast from 'react-hot-toast';

export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'arquivo';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Libertar memoria (com pequeno delay para o browser processar)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
  } catch (e: any) {
    toast.error(`Não foi possível baixar: ${e.message || 'erro desconhecido'}`);
    // Fallback: abre em nova aba (sem nome correcto mas pelo menos abre)
    window.open(url, '_blank');
  }
}
