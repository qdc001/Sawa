// Faz download de um ficheiro forcando o nome original.
//
// O disco guarda os anexos com um nome mangled (`wa_1234_xyz.doc`), e o
// atributo HTML `download="..."` e ignorado pelo browser quando a URL e
// cross-origin (frontend e backend estao em dominios diferentes). Por isso
// o nome certo tem de vir do proprio servidor: passamos `?filename=` na URL
// e o backend (ver server.ts, rota /uploads) responde com o header
// Content-Disposition a apontar o nome real - o browser respeita esse
// header em qualquer download, cross-origin ou nao.
export async function downloadFile(url: string, filename: string): Promise<void> {
  // Anexos antigos podem ter ficado guardados com http:// (bug de deteção de
  // protocolo atrás do proxy do Easypanel, já corrigido na origem) — o Chrome
  // bloqueia o download de documentos vindos de http:// numa página https com
  // "não pode ser descarregado com segurança". Corrigir aqui garante que
  // registos já gravados também passam a descarregar bem, sem migração de BD.
  const secureUrl = window.location.protocol === 'https:' ? url.replace(/^http:\/\//, 'https://') : url;
  const sep = secureUrl.includes('?') ? '&' : '?';
  const dlUrl = `${secureUrl}${sep}filename=${encodeURIComponent(filename || 'arquivo')}`;
  const a = document.createElement('a');
  a.href = dlUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
