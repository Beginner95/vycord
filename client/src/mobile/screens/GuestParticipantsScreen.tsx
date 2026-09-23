import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { GuestParticipantsBody } from '@/pages/guest/GuestParticipantsBody';
import { useT } from '@/i18n';
import './GuestParticipantsScreen.css';

/** Экран `guestParticipants` (спека §7) — ростер гостевого звонка поверх
 *  сцены, тот же GuestParticipantsBody, что и десктопный aside. */
export function GuestParticipantsScreen({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div className="guest-participants-screen">
      <ScreenHeader title={t('guest.participants')} onBack={onBack} />
      <div className="guest-participants-screen-body">
        <GuestParticipantsBody />
      </div>
    </div>
  );
}
