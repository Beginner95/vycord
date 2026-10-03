import { useEffect } from 'react';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { QuickReactions } from './QuickReactions';
import { useMessageActions } from './useMessageActions';

interface Props {
  msg: ChatMessage | null;
  isOwn: boolean;
  members: MemberWithUser[];
  onClose: () => void;
  onQuote: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
  canViewReaders: (m: ChatMessage) => boolean;
  onReaders: (m: ChatMessage) => void;
  currentUserId?: string;
  /** VYC-106: быстрые реакции. Нет — ряда нет. */
  reactions?: { canReact: boolean; onToggle: (m: ChatMessage, key: string) => void; onMore: (m: ChatMessage) => void };
}

/** Шторка действий над сообщением. Потока «после выбора» нет (подтверждение
 *  удаления и редактор живут в ChatArea), поэтому контракт D8 этапа 2 не нужен:
 *  ActionSheet зовёт onClose() ДО onClick, а пункт уже держит свою запись. */
export function MessageActionsSheet(props: Props) {
  if (!props.msg) return null;
  return <Body {...props} msg={props.msg} />;
}

function Body({ msg, isOwn, members, onClose, onQuote, onEdit, onDelete, onRetry, onDiscard, canViewReaders, onReaders, currentUserId, reactions }: Props & { msg: ChatMessage }) {
  const t = useT();
  const items = useMessageActions({
    msg, members, canModify: isOwn,
    onQuote: () => onQuote(msg), onEdit: () => onEdit(msg), onDelete: () => onDelete(msg),
    onRetry: () => onRetry(msg), onDiscard: () => onDiscard(msg),
    onReaders: canViewReaders(msg) ? () => onReaders(msg) : undefined,
  });
  const canReact = !!reactions?.canReact && !msg.deliveryState && msg.kind === 'user';
  // Пустое меню (отправляется, чужой стикер) — закрыть, не показывая пустую
  // шторку. Но если можно поставить реакцию, шторка не пуста.
  const empty = items.length === 0 && !canReact;
  useEffect(() => { if (empty) onClose(); }, [empty]);
  if (empty) return null;
  const mine = new Set((msg.reactions ?? []).filter((r) => currentUserId && r.user_ids?.includes(currentUserId)).map((r) => r.key));
  const header = canReact && reactions ? (
    <QuickReactions
      mine={mine}
      onPick={(e) => { onClose(); reactions.onToggle(msg, e); }}
      onMore={() => { onClose(); reactions.onMore(msg); }}
    />
  ) : undefined;
  return <ActionSheet open onClose={onClose} title={t('mobile.msgActions')} items={items} header={header} />;
}
