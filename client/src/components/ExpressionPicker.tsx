import { useState } from 'react';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { EmojiPanel } from '@/components/EmojiPanel';
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
}

export function ExpressionPicker({ tabs, initialTab, onClose, onSelectEmoji }: ExpressionPickerProps) {
  const t = useT();
  // Единственная подписка на весь пикер. Панели — «глупые» тела: хук держит
  // capture-listener на document и должен жить ровно столько, сколько
  // смонтирована поверхность (см. useDismissOnOutside.ts).
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  const lastTab = useExpressionRecentsStore((s) => s.lastTab);
  const setLastTab = useExpressionRecentsStore((s) => s.setLastTab);

  const pick = (t2: ExpressionTab | undefined) => (t2 && tabs.includes(t2) ? t2 : undefined);
  const [active, setActive] = useState<ExpressionTab>(
    () => pick(initialTab) ?? pick(lastTab) ?? tabs[0],
  );

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
    </div>
  );
}
