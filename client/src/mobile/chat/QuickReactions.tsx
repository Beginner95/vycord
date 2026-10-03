import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { useExpressionRecentsStore, topEmoji } from '@/stores/expressionRecentsStore';
import { quickReactions, QUICK_REACTIONS_COUNT } from '@/utils/reactions';
import './QuickReactions.css';

interface Props {
  /** Ключи, которые текущий пользователь уже поставил. */
  mine: ReadonlySet<string>;
  onPick: (emoji: string) => void;
  onMore: () => void;
}

/** Ряд быстрых реакций сверху шторки действий (VYC-106). Снимок «недавних»
 *  берётся при открытии — ряд не перестраивается под пальцем. */
export function QuickReactions({ mine, onPick, onMore }: Props) {
  const t = useT();
  const recordEmoji = useExpressionRecentsStore((s) => s.recordEmoji);
  const [emojis] = useState(() => quickReactions(topEmoji(useExpressionRecentsStore.getState(), QUICK_REACTIONS_COUNT)));
  return (
    <div className="quick-reactions" role="group" aria-label={t('chat.quickReactions')}>
      {emojis.map((e) => (
        <button key={e} type="button" className={`quick-reaction${mine.has(e) ? ' is-mine' : ''}`} aria-pressed={mine.has(e)}
          onClick={() => { recordEmoji(e); onPick(e); }}>
          {e}
        </button>
      ))}
      <button type="button" className="quick-reaction quick-reaction-more" aria-label={t('chat.moreReactions')} onClick={onMore}>
        <Plus size={18} strokeWidth={1.8} />
      </button>
    </div>
  );
}
