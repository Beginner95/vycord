import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { ExpressionBody } from '@/components/ExpressionBody';
import type { StickerPanelProps } from '@/components/StickerPanel';
import type { ExpressionTab } from '@/stores/expressionRecentsStore';
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

export function ExpressionPicker({ onClose, ...body }: ExpressionPickerProps) {
  // Единственная подписка на весь пикер. Панели — «глупые» тела: хук держит
  // capture-listener на document и должен жить ровно столько, сколько
  // смонтирована поверхность (см. useDismissOnOutside.ts).
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  return (
    <div className="expression-picker" role="dialog" ref={ref}>
      <ExpressionBody {...body} />
    </div>
  );
}
