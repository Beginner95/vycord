import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { GuestInviteBody } from './GuestInviteBody';
import './GuestInvitePopover.css';

/**
 * Управление гостями звонка: выпустить ссылку, скопировать, отозвать, выгнать.
 * Монтируется только пока открыт — таков контракт useDismissOnOutside
 * (client/docs/design-system.md, «Overlays»).
 *
 * Секрет ссылки существует только здесь и только до закрытия поповера: сервер
 * отдаёт его ровно один раз.
 *
 * Тело (список ссылок/гостей, ошибка, форма создания) вынесено в
 * `GuestInviteBody` — переиспользуется мобильной шторкой `MobileGuestSheet`
 * (VYC-95 этап 4, T6). Этот компонент остаётся только поверхностью:
 * поповер-портал, позиционирование, dismiss-on-outside, заголовок. DOM внутри
 * `.guest-invite-popover` не меняется — `GuestInviteBody` рендерит Fragment,
 * не div (см. его комментарий).
 */
interface GuestInvitePopoverProps {
  channelId: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export function GuestInvitePopover({ channelId, position, onClose }: GuestInvitePopoverProps) {
  const t = useT();
  const containerRef = useDismissOnOutside<HTMLDivElement>(onClose);

  return createPortal(
    <div
      className="guest-invite-popover"
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
    >
      <div className="guest-invite-head">{t('guestInvite.title')}</div>
      <GuestInviteBody channelId={channelId} />
    </div>,
    document.body,
  );
}
