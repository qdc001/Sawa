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
  const sep = url.includes('?') ? '&' : '?';
  const dlUrl = `${url}${sep}filename=${encodeURIComponent(filename || 'arquivo')}`;
  const a = document.createElement('a');
  a.href = dlUrl;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
