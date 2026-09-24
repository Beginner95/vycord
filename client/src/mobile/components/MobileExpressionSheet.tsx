import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ExpressionBody } from '@/components/ExpressionBody';
import type { ExpressionPickerProps } from '@/components/ExpressionPicker';
import { useT } from '@/i18n';
import './MobileExpressionSheet.css';

export function MobileExpressionSheet({ onClose, ...body }: ExpressionPickerProps) {
  const t = useT();
  return (
    <BottomSheet open onClose={onClose} title={t('mobile.attachEmoji')}>
      <div className="expression-sheet-body">
        <ExpressionBody {...body} />
      </div>
    </BottomSheet>
  );
}
