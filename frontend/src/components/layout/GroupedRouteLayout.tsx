// Layout de agrupamento de rotas: renderiza um SubNav no topo e a rota
// filha por baixo (via Outlet). Usado na Fase 2 da reconfiguracao para
// agrupar paginas irmas no menu principal.
//   /inbox, /calls, /broadcasts       -> Conversas
//   /pipeline, /leads, /quotes        -> Pipeline
//   /automations, /chatbots           -> Automacoes

import { Outlet } from 'react-router-dom';
import SubNav, { SubNavItem } from './SubNav';

interface Props {
  items: SubNavItem[];
}

export default function GroupedRouteLayout({ items }: Props) {
  return (
    <div className="flex flex-col h-full">
      <SubNav items={items} />
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
