import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { resolveUploadUrl } from '@/services/api';
import { useT, useTp } from '@/i18n';
import { useLongPress } from '@/mobile/gestures/useLongPress';
import { hasReacted, reactorNames } from '@/utils/reactions';
import { ReactionTooltip } from '@/components/ReactionTooltip';
import type { MemberWithUser, Reaction, Sticker } from '@/types';
import './MessageReactions.css';

/** Как лента подключает реакции к MessageRow (VYC-106). Нет объекта — реакций в ленте нет. */
export interface MessageRowReactions {
  /** PermSendMessages и не гость. */
  canReact: boolean;
  /** Тултип с именами. false у гостя: имён участников у него нет. */
  showReactors: boolean;
  /** Десктоп: 🙂+ и «+» открывают пикер прямо в строке. На мобильном — шторка. */
  inlinePicker: boolean;
  /** Живые стикеры сервера. undefined — не фильтровать (гость). */
  knownStickerIds?: ReadonlySet<string>;
  stickers?: { serverId: string; items: Sticker[] };
  onToggle: (messageId: string, key: string, sticker?: Sticker) => void;
  /** Единственный открытый пикер ленты (источник истины — ChatArea): id сообщения и сторона. */
  openPicker?: { messageId: string; placement: 'above' | 'below' } | null;
  /** null закрывает пикер. */
  onTogglePicker?: (messageId: string, placement: 'above' | 'below' | null) => void;
  /** Мобильный long-press по пилюле — список отреагировавших. */
  onShowReactors?: (messageId: string, reaction: Reaction) => void;
}

interface Props {
  messageId: string;
  reactions: Reaction[];
  currentUserId?: string;
  members: MemberWithUser[];
  binding: MessageRowReactions;
  onAdd?: () => void;
}

export function MessageReactions({ messageId, reactions, currentUserId, members, binding, onAdd }: Props) {
  const t = useT();
  // Удалённый стикер: свежий снимок сервера его уже не содержит (каскад), но
  // в загруженной ленте он может остаться — картинка была бы битой.
  const visible = reactions.filter((r) => !r.sticker || !binding.knownStickerIds || binding.knownStickerIds.has(r.sticker.id));
  if (visible.length === 0) return null;
  return (
    <div className="msg-reactions">
      {visible.map((r) => (
        <ReactionPill key={r.key} messageId={messageId} reaction={r} mine={hasReacted(r, currentUserId)} members={members} binding={binding} />
      ))}
      {binding.canReact && onAdd && (
        <button
          type="button"
          className="msg-reaction-add"
          aria-label={t('chat.addReaction')}
          title={t('chat.addReaction')}
          // useDismissOnOutside: кнопка-переключатель гасит mousedown, иначе
          // закрытие по клику снаружи и повторное открытие гасят друг друга.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onAdd}
        >
          <SmilePlus size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

function ReactionPill({ messageId, reaction, mine, members, binding }: {
  messageId: string; reaction: Reaction; mine: boolean; members: MemberWithUser[]; binding: MessageRowReactions;
}) {
  const tp = useTp();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const longPress = useLongPress(() => binding.onShowReactors?.(messageId, reaction));
  const label = reaction.sticker ? reaction.sticker.name : (reaction.emoji ?? reaction.key);
  const aria = tp('chat.reactionAria', reaction.count, { reaction: label });
  const face = (
    <>
      {reaction.sticker
        ? <img className="msg-reaction-sticker" src={resolveUploadUrl(reaction.sticker.image_url)} alt={reaction.sticker.name} />
        : <span className="msg-reaction-emoji">{reaction.emoji ?? reaction.key}</span>}
      <span className="msg-reaction-count">{reaction.count}</span>
    </>
  );
  const className = `msg-reaction${mine ? ' is-mine' : ''}`;

  if (!binding.canReact) {
    return <span className={`${className} is-readonly`} aria-label={aria}>{face}</span>;
  }

  const { names, rest } = reactorNames(reaction, members);
  const who = rest > 0 ? tp('chat.reactionOthers', rest, { names: names.join(', ') }) : names.join(', ');
  return (
    <>
      <button
        type="button"
        className={className}
        aria-pressed={mine}
        aria-label={aria}
        onClick={() => binding.onToggle(messageId, reaction.key, reaction.sticker)}
        onMouseEnter={binding.showReactors ? (e) => setAnchor(e.currentTarget.getBoundingClientRect()) : undefined}
        onMouseLeave={() => setAnchor(null)}
        {...(binding.onShowReactors ? {
          ...longPress,
          // Свой long-press у пилюли: строка не должна открыть шторку действий.
          onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); longPress.onPointerDown(e); },
          onContextMenu: (e: React.MouseEvent) => { e.stopPropagation(); longPress.onContextMenu(e); },
        } : undefined)}
      >
        {face}
      </button>
      {anchor && who && <ReactionTooltip anchor={anchor}>{who}</ReactionTooltip>}
    </>
  );
}
