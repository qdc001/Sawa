// A seccao Financas so existe no workspace M.E.T.A. (o servidor faz a mesma regra).
export function isMetaWorkspace(name: string | null | undefined): boolean {
  return (name || '').replace(/[^a-z0-9]/gi, '').toLowerCase() === 'meta';
}
