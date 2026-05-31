import { useEffect, useState } from 'react';

/**
 * Pan-scroll com botao do rato.
 * scrollButton: 0 = esquerdo, 1 = meio, 2 = direito; -1 = desactivado.
 * A configuração e partilhada via localStorage (kommo:scrollButton).
 */
export function useDragScroll(ref: React.RefObject<HTMLElement | null>, scrollButton: number) {
  useEffect(() => {
    const el = ref.current;
    if (!el || scrollButton < 0) return;

    let isPanning = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== scrollButton) return;
      const target = e.target as HTMLElement;
      // ignorar elementos draggables (cards) e controlos
      if (target.closest('[data-lead-card="true"]')) return;
      if (target.closest('[data-no-pan="true"]')) return;
      if (target.closest('button, input, select, textarea, a')) return;

      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
      if (scrollButton !== 0) e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      el.scrollLeft = startLeft - (e.clientX - startX);
      el.scrollTop = startTop - (e.clientY - startY);
    };

    const stop = () => {
      if (!isPanning) return;
      isPanning = false;
      el.style.cursor = '';
      el.style.userSelect = '';
    };

    const onContextMenu = (e: MouseEvent) => {
      if (scrollButton === 2) e.preventDefault();
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('mouseleave', stop);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('mouseleave', stop);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [ref, scrollButton]);
}

const SCROLL_BTN_KEY = 'kommo:scrollButton';

export function useScrollButton(): [number, (n: number) => void] {
  const [scrollButton, setScrollButton] = useState<number>(() => {
    const saved = localStorage.getItem(SCROLL_BTN_KEY);
    return saved !== null ? parseInt(saved, 10) : 1; // default: meio
  });
  useEffect(() => {
    localStorage.setItem(SCROLL_BTN_KEY, String(scrollButton));
    window.dispatchEvent(new CustomEvent('scroll-button-changed'));
  }, [scrollButton]);
  useEffect(() => {
    const handler = () => {
      const saved = localStorage.getItem(SCROLL_BTN_KEY);
      if (saved !== null) setScrollButton(parseInt(saved, 10));
    };
    window.addEventListener('scroll-button-changed', handler);
    return () => window.removeEventListener('scroll-button-changed', handler);
  }, []);
  return [scrollButton, setScrollButton];
}
