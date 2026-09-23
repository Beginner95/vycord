import { useEffect } from 'react';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { GuestChatBody } from '@/pages/guest/GuestChatBody';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useT } from '@/i18n';
import './GuestChatScreen.css';

/** Экран `guestChat` (спека §7) — чат гостевого звонка поверх сцены, тот же
 *  GuestChatBody, что и десктопный aside в GuestCallView.tsx. Гасит
 *  непрочитанное при открытии — то же место, что и у десктопной
 *  GuestCallView (эффект на родителе панели, не внутри самого тела). */
export function GuestChatScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const markChatRead = useGuestCallStore((s) => s.markChatRead);
  useEffect(() => {
    if (chatUnread > 0) markChatRead();
  }, [chatUnread, markChatRead]);
  return (
    <div className="guest-chat-screen">
      <ScreenHeader title={t('guest.chat')} onBack={onBack} />
      <div className="guest-chat-screen-body">
        <GuestChatBody />
      </div>
    </div>
  );
}
