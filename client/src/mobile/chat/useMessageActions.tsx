import { Copy, Pencil, Quote, RotateCw, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import { toDisplayMentions } from '@/utils/mentions';
import { useT } from '@/i18n';

export interface MessageActionsInput {
  msg: ChatMessage;
  /** Своё и не гость: правка/удаление (у гостя звонка таких эндпоинтов нет). */
  canModify: boolean;
  members: MemberWithUser[];
  onQuote(): void;
  onEdit(): void;
  onDelete(): void;
  onRetry(): void;
  onDiscard(): void;
}

const icon = (Icon: typeof Quote) => <Icon size={20} strokeWidth={1.8} />;

/** Пункты long-press-меню сообщения (спека §5.4). Те же правила доступности, что у
 *  hover-панели десктопного MessageRow: у неотправленного нет серверного id (только
 *  «повторить/отменить»), у стикера нечего цитировать и править. */
export function useMessageActions(i: MessageActionsInput): ContextMenuItem[] {
  const t = useT();
  const { msg } = i;
  if (msg.deliveryState === 'sending') return [];
  if (msg.deliveryState === 'failed') {
    return [
      { label: t('mobile.msgRetry'), icon: icon(RotateCw), onClick: i.onRetry },
      { label: t('mobile.msgDiscard'), icon: icon(Trash2), danger: true, onClick: i.onDiscard },
    ];
  }
  const items: ContextMenuItem[] = [];
  if (!msg.sticker_id && msg.content.trim().length > 0) {
    items.push({ label: t('mobile.msgQuote'), icon: icon(Quote), onClick: i.onQuote });
    items.push({
      label: t('mobile.msgCopy'),
      icon: icon(Copy),
      // В буфер — отображаемая форма («@boris»), а не проводная <@uuid>.
      onClick: () => { void navigator.clipboard?.writeText(toDisplayMentions(msg.content, i.members))?.catch(() => {}); },
    });
  }
  if (i.canModify && !msg.sticker_id) items.push({ label: t('common.edit'), icon: icon(Pencil), onClick: i.onEdit });
  if (i.canModify) items.push({ label: t('common.delete'), icon: icon(Trash2), danger: true, onClick: i.onDelete });
  return items;
}
