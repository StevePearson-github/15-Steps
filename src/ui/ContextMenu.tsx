import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** A second level: choosing this item opens these instead of acting. */
  children?: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  title?: string;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * A right-click menu with an optional second level. Closes on a click
 * elsewhere, Escape, scrolling or resizing. Keys: Up/Down move, Right opens a
 * second level, Left closes it.
 */
export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = open;

  useEffect(() => {
    const menu = ref.current;
    menu?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const onPointer = (e: Event) => {
      if (!menu?.contains(e.target as Node)) onClose();
    };
    const parentOf = (label: string) =>
      Array.from(menu?.querySelectorAll<HTMLElement>('[data-parent]') ?? []).find((el) => el.dataset.parent === label);
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (e.key === 'Escape') {
        if (openRef.current) {
          const parent = parentOf(openRef.current);
          setOpen(null);
          parent?.focus();
        } else onClose();
        return;
      }
      if (e.key === 'ArrowRight' && active?.dataset.parent) {
        e.preventDefault();
        setOpen(active.dataset.parent);
        requestAnimationFrame(() => menu?.querySelector<HTMLElement>('.submenu button:not(:disabled)')?.focus());
        return;
      }
      if (e.key === 'ArrowLeft' && openRef.current) {
        e.preventDefault();
        const parent = parentOf(openRef.current);
        setOpen(null);
        parent?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const scope = active?.closest('.submenu') ?? menu?.querySelector('.menu-level');
      const buttons = Array.from(scope?.querySelectorAll<HTMLElement>(':scope > button:not(:disabled), :scope > .menu-row > button:not(:disabled)') ?? []);
      const at = buttons.indexOf(active as HTMLElement);
      buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Keep the menu on screen (the second level opens to the right, or the left near the edge).
  const width = typeof window === 'undefined' ? 800 : window.innerWidth;
  const height = typeof window === 'undefined' ? 600 : window.innerHeight;
  const left = Math.max(4, Math.min(x, width - 200));
  const top = Math.max(4, Math.min(y, height - (items.length * 34 + 40)));
  const flip = left > width - 420;

  return (
    <div ref={ref} className="context-menu" role="menu" aria-label={title ?? 'Menu'} style={{ left, top }}>
      {title && <div className="menu-title">{title}</div>}
      <div className="menu-level">
        {items.map((item) =>
          item.children ? (
            <div
              key={item.label}
              className="menu-row"
              onMouseEnter={() => setOpen(item.label)}
              onMouseLeave={() => setOpen((o) => (o === item.label ? null : o))}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open === item.label}
                data-parent={item.label}
                disabled={item.disabled}
                onClick={() => setOpen((o) => (o === item.label ? null : item.label))}
              >
                {item.label}
                <span className="chev" aria-hidden="true">▸</span>
              </button>
              {open === item.label && (
                <div className={`submenu${flip ? ' flip' : ''}`} role="menu" aria-label={item.label}>
                  {item.children.map((child) => (
                    <button
                      key={child.label}
                      type="button"
                      role="menuitem"
                      disabled={child.disabled}
                      onClick={() => {
                        onClose();
                        child.onSelect?.();
                      }}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect?.();
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
