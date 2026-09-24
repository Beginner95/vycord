import { Pencil, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { useT } from '@/i18n';

interface ChannelMenuOptions {
  canManage: boolean;
  /** Последний канал сервера — удаление недоступно (гейт есть и на бэкенде). */
  isLast: boolean;
  onRename?: () => void;
  onDelete?: () => void;
}

/** Пункты меню канала (спека §5.3). Те же ключи и та же логика, что у
 *  ContextMenu в ChannelSidebar, включая disabledReason у последнего канала. */
export function useChannelMenuItems(o: ChannelMenuOptions): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [];
  if (o.canManage && o.onRename) {
    items.push({ label: t('channel.editMenu'), icon: <Pencil size={20} strokeWidth={1.8} />, onClick: o.onRename });
  }
  if (o.canManage && o.onDelete) {
    items.push({
      label: t('channel.deleteMenu'),
      icon: <Trash2 size={20} strokeWidth={1.8} />,
      danger: true,
      disabled: o.isLast,
      disabledReason: t('channel.deleteLastDisabled'),
      onClick: o.onDelete,
    });
  }
  return items;
}
