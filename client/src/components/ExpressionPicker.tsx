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
  /**
   * Вызывается, когда вкладку меняет СОБСТВЕННАЯ полоса пикера (клик по
   * `.expression-picker-tab`), а не `initialTab` сверху. Композер передаёт
   * сюда `setPickerTab`, чтобы `pickerTab` продолжал зеркалить реальную
   * активную вкладку и после клика по полосе пикера, а не только после
   * тоггла — иначе кнопки композера и `FormattingToolbar` подсвечивают не ту
   * вкладку (см. финальный ревью, Fix 1). Необязателен: `MessageRow` рендерит
   * `tabs={['emoji']}` без полосы, так что `select()` там никогда не
   * срабатывает.
   */
  onTabChange?: (tab: ExpressionTab) => void;
}

export function ExpressionPicker({ tabs, initialTab, onClose, onSelectEmoji, stickers, onTabChange }: ExpressionPickerProps) {
  const t = useT();
  // Единственная подписка на весь пикер. Панели — «глупые» тела: хук держит
  // capture-listener на document и должен жить ровно столько, сколько
  // смонтирована поверхность (см. useDismissOnOutside.ts).
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  const lastTab = useExpressionRecentsStore((s) => s.lastTab);
  const setLastTab = useExpressionRecentsStore((s) => s.setLastTab);

  const pick = (t2: ExpressionTab | undefined) => (t2 && tabs.includes(t2) ? t2 : undefined);
  // `pick(lastTab)` is currently unreachable from both call sites: the
  // composer always passes `initialTab={pickerTab}` and every open path routes
  // through `openPickerOn`, which sets `pickerTab` before opening, and
  // `MessageRow` passes `tabs={['emoji']}` with no `initialTab` but its
  // `pick('stickers')` (or whatever `lastTab` holds) is always `undefined`
  // there too. Kept anyway — controller ruling, final review: both entry
  // points are specific toggles, which is exactly spec §4's stated override of
  // `lastTab`, so this is correct defensive code for a future NEUTRAL opener
  // (one that doesn't know which tab to land on) rather than dead code to
  // delete.
  const [active, setActive] = useState<ExpressionTab>(
    () => pick(initialTab) ?? pick(lastTab) ?? tabs[0],
  );

  // The composer's toggle-driven switch (openPickerOn) re-renders an
  // ALREADY-MOUNTED ExpressionPicker with a new `initialTab` rather than
  // remounting it — no `key` on that call site, deliberately. `key={pickerTab}`
  // would replay the shell's `fade-in 0.12s` (ExpressionPicker.css) and tear
  // down/re-subscribe `useDismissOnOutside`'s document listeners on EVERY tab
  // switch, toggle-driven or strip-driven alike (since Fix 1 the strip's own
  // `select()` also updates `pickerTab`, so both paths now go through this
  // same prop) — and a tab switch is not an open, so replaying the open
  // animation and listener churn on one would be visibly wrong. It would NOT,
  // however, save EmojiPanel/StickerPanel's frequently-used snapshot or scroll
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
  // itself never changed. Since Fix 1 this is defensive rather than
  // load-bearing at the composer's call site — `select()` now updates
  // `pickerTab`, so `initialTab` already tracks the strip — but a future
  // caller that re-renders `tabs` independently of `initialTab` would still
  // need it.
  useEffect(() => {
    const next = pick(initialTab);
    if (next) setActive(next);
  }, [initialTab]);

  const select = (tab: ExpressionTab) => {
    setActive(tab);
    setLastTab(tab);
    // Тоже сообщаем родителю: без этого `pickerTab` композера продолжал бы
    // называть вкладку, открывшую пикер, даже после клика по СОБСТВЕННОЙ
    // полосе пикера — и кнопки Smile/Sticker, и FormattingToolbar подсвечивали
    // бы не ту вкладку (Fix 1, финальный ревью). Не зацикливается: обновление
    // `pickerTab` меняет `initialTab` этого же инстанса, эффект ниже вызывает
    // `setActive` со значением, которое `active` уже держит, и React бросает
    // ре-рендер без побочных эффектов.
    onTabChange?.(tab);
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
              // GIF — заглушка из макета: видима, но недостижима, пока нет панели.
              disabled={tab === 'gif'}
              aria-selected={tab === active}
              className={`expression-picker-tab${tab === active ? ' is-active' : ''}`}
              onClick={() => select(tab)}
            >
              {label[tab]}
              {tab === 'gif' && <span className="expression-picker-chip">{t('chat.comingSoon')}</span>}
            </button>
          ))}
        </div>
      )}
      {active === 'emoji' && <EmojiPanel onSelect={onSelectEmoji} />}
      {active === 'stickers' && stickers && <StickerPanel {...stickers} />}
    </div>
  );
}
