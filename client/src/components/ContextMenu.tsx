import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeDismiss } from '@/hooks/useModalFocus';

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  label?: string;
  onClose: () => void;
}

/* Board 1d: caps label, icon rows, destructive last and separated — the split
   below enforces the separation structurally, callers cannot bypass it.
   Стили живут в primitives.css (.context-menu*), собственного CSS-файла у
   компонента больше нет. */
export function ContextMenu({ x, y, items, label, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape — через стек поверхностей (M6 T11, шаг 4), а не через собственный
  // document-слушатель: модалка, открытая ПОВЕРХ меню, теперь забирает Escape
  // себе, а меню закрывается следующим. Меню не блокирующее — ⌘K над ним
  // работал и должен продолжать работать.
  useEscapeDismiss(true, onClose);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const plain = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const clampedX = Math.min(x, window.innerWidth - 244);
  const clampedY = Math.min(y, window.innerHeight - items.length * 38 - (label ? 26 : 0) - 20);

  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      className={`context-menu-item${item.danger ? ' is-danger' : ''}`}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onClick={() => {
        if (item.disabled) return;
        item.onClick();
        onClose();
      }}
    >
      {item.icon}
      {item.label}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
      onClick={(e) => e.stopPropagation()}
    >
      {label && <div className="context-menu-label">{label}</div>}
      {plain.map(renderItem)}
      {danger.length > 0 && <div className="context-menu-separator" />}
      {danger.map(renderItem)}
    </div>,
    document.body
  );
}
