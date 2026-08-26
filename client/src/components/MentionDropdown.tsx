import type { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import './MentionDropdown.css';

export function MentionDropdown({ mention }: { mention: ReturnType<typeof useMentionAutocomplete> }) {
  if (mention.mentionQuery === null || mention.mentionEntries.length === 0) return null;
  return (
    <ul className="mention-dropdown" role="listbox">
      {mention.mentionEntries.map((entry, i) => (
        <li
          key={mention.entryKey(entry)}
          role="option"
          aria-selected={i === mention.mentionIndex}
          className={`mention-item${i === mention.mentionIndex ? ' is-active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); mention.selectEntry(entry); }}
        >
          @{entry.label}
        </li>
      ))}
    </ul>
  );
}
