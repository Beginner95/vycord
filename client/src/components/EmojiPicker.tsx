import { useState } from 'react';
import { EMOJI_CATEGORIES } from '@/utils/emojis';
import { useT } from '@/i18n';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose: _onClose }: EmojiPickerProps) {
  const t = useT();
  const [active, setActive] = useState(EMOJI_CATEGORIES[0].id);

  return (
    <div className="emoji-picker" role="dialog">
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
            className={`emoji-tab${c.id === active ? ' active' : ''}`}
            onClick={() => setActive(c.id)}
            title={c.label}
          >
            {c.emojis[0]}
          </button>
        ))}
      </div>
    </div>
  );
}