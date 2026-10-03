import { ExpressionPicker } from '@/components/ExpressionPicker';
import { stickerReactionKey } from '@/utils/reactions';
import type { Sticker } from '@/types';
import './MessageReactions.css';

const PICKER_HEIGHT = 360; // .expression-picker height
const GAP = 8;

/** Над строкой, если до верха ленты хватает места; иначе — под ней. */
export function pickerPlacement(row: HTMLElement): 'above' | 'below' {
  const scroller = row.closest('.chat-messages');
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  return row.getBoundingClientRect().top - top >= PICKER_HEIGHT + GAP ? 'above' : 'below';
}

interface Props {
  placement: 'above' | 'below';
  stickers?: { serverId: string; items: Sticker[] };
  onPick: (key: string, sticker?: Sticker) => void;
  onClose: () => void;
}

/** Пикер реакций: тот же ExpressionPicker. Выбор сразу ставит (или снимает)
 *  реакцию и закрывает пикер. Монтируется только открытым — этого требует
 *  useDismissOnOutside внутри ExpressionPicker. */
export function ReactionPicker({ placement, stickers, onPick, onClose }: Props) {
  return (
    <ExpressionPicker
      className={`reaction-picker${placement === 'below' ? ' is-below' : ''}`}
      tabs={stickers ? ['emoji', 'stickers'] : ['emoji']}
      initialTab="emoji"
      onClose={onClose}
      onSelectEmoji={(emoji) => { onPick(emoji); onClose(); }}
      stickers={stickers ? {
        serverId: stickers.serverId,
        items: stickers.items,
        onSend: async (s) => { onPick(stickerReactionKey(s.id), s); onClose(); return true; },
      } : undefined}
    />
  );
}
