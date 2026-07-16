import { useState } from 'react';
import { Mouse } from 'lucide-react';
import { useScrollButton } from '../lib/useDragScroll';

const OPTIONS: Array<{ v: number; label: string }> = [
  { v: -1, label: 'Desactivado' },
  { v: 0, label: 'Esquerdo (cuidado: usa-se p/ cards)' },
  { v: 1, label: 'Meio (roda)' },
  { v: 2, label: 'Direito' },
];

export default function MouseSettingsButton() {
  const [open, setOpen] = useState(false);
  const [scrollButton, setScrollButton] = useScrollButton();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn"
        style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
        title="Configurar botão do rato para arrastar a vista"
      >
        <Mouse size={14} />
      </button>
      {open && (
        <div
          className="absolute top-full mt-2 right-0 z-40 card p-2 w-56"
          style={{ background: 'var(--surface)' }}
        >
          <p className="text-xs px-2 py-1" style={{ color: 'var(--text-muted)' }}>
            Botão do rato para arrastar a vista
          </p>
          {OPTIONS.map((opt) => (
            <button
              key={opt.v}
              onClick={() => { setScrollButton(opt.v); setOpen(false); }}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-slate-100"
              style={{
                color: 'var(--text-primary)',
                background: scrollButton === opt.v ? 'var(--primary-light)' : 'transparent',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
