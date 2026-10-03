import type { ReactNode } from 'react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { BottomSheet } from './BottomSheet';

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  items: ContextMenuItem[];
  /** Произвольный блок над группами пунктов (ряд быстрых реакций). */
  header?: ReactNode;
}

/** Тач-замена ContextMenu (спека §4.3): тот же ContextMenuItem[], опасные
 *  пункты — отдельной группой в конце (board 1d), как у ContextMenu. */
export function ActionSheet({ open, onClose, title, items, header }: ActionSheetProps) {
  const plain = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const row = (item: ContextMenuItem) => (
    <button
      key={item.label}
      type="button"
      className={`action-sheet-item${item.danger ? ' is-danger' : ''}`}
      disabled={item.disabled}
      onClick={() => { onClose(); item.onClick(); }}
    >
      {item.icon && <span className="action-sheet-icon">{item.icon}</span>}
      <span className="action-sheet-text">
        <span className="action-sheet-label">{item.label}</span>
        {item.disabled && item.disabledReason && (
          <span className="action-sheet-reason">{item.disabledReason}</span>
        )}
      </span>
    </button>
  );
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {header}
      <div className="action-sheet-group">{plain.map(row)}</div>
      {danger.length > 0 && <div className="action-sheet-group">{danger.map(row)}</div>}
    </BottomSheet>
  );
}
