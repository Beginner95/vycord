import { Ban, Headphones, Undo2, UserMinus } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { UserBrief } from '@/types';
import { useT } from '@/i18n';

export interface FriendMenuActions {
  onCall?: () => void;
  onRemove?: () => void;
  onBlock?: () => void;
  onUnblock?: () => void;
}

/** Пункты ActionSheet по тапу на строку друга (спека §5.7, D5). Независимая
 *  от десктопа копия (см. Decisions D3) — та же граница, что
 *  useServerMenuItems ↔ ServerMenu.tsx в этапе 2. */
export function useFriendMenuItems(user: UserBrief, a: FriendMenuActions): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [];
  if (a.onCall) {
    items.push({ label: t('server.callUser', { name: user.username }), icon: <Headphones size={20} strokeWidth={1.8} />, onClick: a.onCall });
  }
  if (a.onUnblock) {
    items.push({ label: t('friends.unblock'), icon: <Undo2 size={20} strokeWidth={1.8} />, onClick: a.onUnblock });
  }
  if (a.onRemove) {
    items.push({ label: t('friends.remove'), icon: <UserMinus size={20} strokeWidth={1.8} />, danger: true, onClick: a.onRemove });
  }
  if (a.onBlock) {
    items.push({ label: t('friends.block'), icon: <Ban size={20} strokeWidth={1.8} />, danger: true, onClick: a.onBlock });
  }
  return items;
}
