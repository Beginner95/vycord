import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ScreenQualityBody } from '@/components/ScreenQualityBody';
import type { ScreenQuality } from '@/services/groupCall';
import { useT } from '@/i18n';

interface MobileScreenQualitySheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (quality: ScreenQuality) => void;
}

/** Мобильный эквивалент `ScreenQualityPicker`: то же тело (`ScreenQualityBody`),
 *  но в `BottomSheet` вместо модалки. Стили — `ScreenSharePicker.css`, уже в
 *  бандле через `ScreenSharePicker.tsx`. */
export function MobileScreenQualitySheet({ open, onClose, onSelect }: MobileScreenQualitySheetProps) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('call.selectQuality')}>
      <ScreenQualityBody onSelect={(q) => { onClose(); onSelect(q); }} />
    </BottomSheet>
  );
}
