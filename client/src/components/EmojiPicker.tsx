import { useState } from 'react';
import { EMOJI_CATEGORIES } from '@/utils/emojis';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { useT } from '@/i18n';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const t = useT();
  const [active, setActive] = useState(EMOJI_CATEGORIES[0].id);
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);

  return (
    <div className="emoji-picker" role="dialog" ref={ref}>
      <div className="emoji-picker-grid">
        {EMOJI_CATEGORIES.find((c) => c.id === active)?.emojis.map((e, i) => (
          <button
            key={`${active}-${i}`}
            type="button"
            className="emoji-cell"
            onClick={() => onSelect(e)}
            aria-label={t('chat.insertEmoji')}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="emoji-picker-tabs">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`emoji-tab${c.id === active ? ' is-active' : ''}`}
            onClick={() => setActive(c.id)}
            title={t(c.labelKey)}
          >
            {c.emojis[0]}
          </button>
        ))}
      </div>
    </div>
  );
}