import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { GuestInviteBody } from '@/components/GuestInviteBody';
import { useT } from '@/i18n';

interface MobileGuestSheetProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
}

/** Мобильный эквивалент `GuestInvitePopover`: то же тело (`GuestInviteBody`),
 *  но в `BottomSheet` вместо поповер-портала. Стили — `GuestInvitePopover.css`,
 *  уже в бандле через `GuestInvitePopover.tsx` (тот же паттерн, что
 *  `MobileExpressionSheet` для `ExpressionPicker.css`). */
export function MobileGuestSheet({ open, onClose, channelId }: MobileGuestSheetProps) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('guestInvite.title')}>
      <GuestInviteBody channelId={channelId} />
    </BottomSheet>
  );
}
