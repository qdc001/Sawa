// Barra de tabs para navegacao entre paginas irmas (ex.: dentro de
// "Conversas" tem-se Inbox / Chamadas / Broadcasts). Usada no topo das
// paginas que a Fase 2 uniu no menu principal.
//
// Cada item pode ter um path (usa NavLink com match exacto), um icone
// opcional e um label. O tab activo e destacado com a cor primaria.

import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface SubNavItem {
  path: string;
  label: string;
  icon?: LucideIcon;
}

interface Props {
  items: SubNavItem[];
  className?: string;
}

export default function SubNav({ items, className = '' }: Props) {
  return (
    <div
      className={`flex items-center gap-1 border-b px-2 sm:px-4 overflow-x-auto ${className}`}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {items.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              isActive ? '' : 'hover:text-white'
            }`
          }
          style={({ isActive }) => ({
            borderColor: isActive ? 'var(--primary)' : 'transparent',
            color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
          })}
        >
          {Icon && <Icon size={14} />}
          {label}
        </NavLink>
      ))}
    </div>
  );
}
