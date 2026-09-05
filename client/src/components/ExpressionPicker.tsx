import { useEffect, useState } from 'react';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { EmojiPanel } from '@/components/EmojiPanel';
import { StickerPanel, type StickerPanelProps } from '@/components/StickerPanel';
import { useExpressionRecentsStore, type ExpressionTab } from '@/stores/expressionRecentsStore';
import { useT } from '@/i18n';
import './ExpressionPicker.css';

export interface ExpressionPickerProps {
  /** Редактор сообщения передаёт ['emoji'], композер — все три. */
  tabs: ExpressionTab[];
  /** Какая кнопка открыла пикер. Иначе — запомненная вкладка, иначе tabs[0]. */
  initialTab?: ExpressionTab;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  /** Отсутствует ⇒ вкладку «Стикеры» отрисовать нельзя. */
  stickers?: StickerPanelProps;
}

export function ExpressionPicker({ tabs, initialTab, onClose, onSelectEmoji, stickers }: ExpressionPickerProps) {
  const t = useT();
  // Единственная подписка на весь пикер. Панели — «глупые» тела: хук держит
  // capture-listener на document и должен жить ровно столько, сколько
  // смонтирована поверхность (см. useDismissOnOutside.ts).
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  const lastTab = useExpressionRecentsStore((s) => s.lastTab);
  const setLastTab = useExpressionRecentsStore((s) => s.setLastTab);

  const pick = (t2: ExpressionTab | undefined) => (t2 && tabs.includes(t2) ? t2 : undefined);
  // `pick(lastTab)` is currently unreachable from both call sites: the
  // composer always passes the constant `initialTab="emoji"` (the Smile
  // button is a specific toggle, not a neutral opener), and `MessageRow`
  // passes `tabs={['emoji']}` with no `initialTab`, where `pick(lastTab)` can
  // only ever resolve to 'emoji' too — same result as `tabs[0]`. Kept anyway —
  // controller ruling, final review: both entry points are specific toggles,
  // which is exactly spec §4's stated override of `lastTab`, so this is
  // correct defensive code for a future NEUTRAL opener (one that doesn't know
  // which tab to land on) rather than dead code to delete.
  const [active, setActive] = useState<ExpressionTab>(
    () => pick(initialTab) ?? pick(lastTab) ?? tabs[0],
  );

  // The composer's `initialTab` is now a constant ("emoji"), so this effect
  // never fires from that call site. Kept for `MessageRow` and any future
  // caller that mounts one instance and later re-renders it with a genuinely
  // different `initialTab` (e.g. a neutral opener driven by an external
  // tab-switch) rather than remounting — `key`-ing the render on the tab
  // would replay the shell's `fade-in 0.12s` (ExpressionPicker.css) and tear
  // down/re-subscribe `useDismissOnOutside`'s document listeners on every
  // switch, and a tab switch is not an open, so replaying the open animation
  // and listener churn on one would be visibly wrong. It would NOT, however,
  // save EmojiPanel/StickerPanel's frequently-used snapshot or scroll
  // position — those panels are conditional renders (`{active === 'emoji' &&
  // <EmojiPanel .../>}` below), so ANY switch already unmounts and remounts
  // them and discards both, keyed or not.
  // That means the mount-time lazy initializer above never re-runs on its own,
  // so `active` must be synced explicitly whenever `initialTab` changes to a
  // tab this instance hasn't already settled on. Reuses `pick()` so an
  // out-of-`tabs` value (in particular 'gif', which has no panel) is ignored
  // exactly as it is on mount.
  // Deliberately keyed on `initialTab` alone (not `tabs`, which the caller
  // passes as a fresh array literal on every render): resyncing on every
  // parent re-render would stomp a tab picked via the strip's own `select()`
  // the next time anything upstream re-renders, even though `initialTab`
  // itself never changed.
  useEffect(() => {
    const next = pick(initialTab);
    if (next) setActive(next);
  }, [initialTab]);

  const select = (tab: ExpressionTab) => {
    setActive(tab);
    setLastTab(tab);
  };

  const label: Record<ExpressionTab, string> = {
    emoji: t('chat.emoji'),
    stickers: t('chat.stickers'),
    gif: t('chat.gif'),
  };

  return (
    <div className="expression-picker" role="dialog" ref={ref}>
      {/* Одна вкладка — полоса не нужна: редактор сообщения получает ровно
          сегодняшнюю поверхность плюс секцию «часто используемые». */}
      {tabs.length > 1 && (
        <div className="expression-picker-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={tab === active}
              className={`expression-picker-tab${tab === active ? ' is-active' : ''}`}
              onClick={() => select(tab)}
            >
              {label[tab]}
            </button>
          ))}
        </div>
      )}
      {active === 'emoji' && <EmojiPanel onSelect={onSelectEmoji} />}
      {active === 'stickers' && stickers && <StickerPanel {...stickers} />}
    </div>
  );
}
