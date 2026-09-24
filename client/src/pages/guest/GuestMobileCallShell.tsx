import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStageModel } from '@/components/useCallStageModel';
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import { CallOverflowSheets } from '@/mobile/call/CallOverflowSheets';
import type { CallOverflowSub } from '@/mobile/call/useCallOverflowItems';
import { useMobileNav, type MobileNav } from '@/mobile/nav/useMobileNav';
import { stripSheets } from '@/mobile/nav/navReducer';
import { useVisualViewportInset } from '@/mobile/keyboard';
import { GuestChatScreen } from '@/mobile/screens/GuestChatScreen';
import { GuestParticipantsScreen } from '@/mobile/screens/GuestParticipantsScreen';
import { useT } from '@/i18n';
import './GuestMobileCallShell.css';

/** Мобильная сцена гостевого звонка (спека §7). Тот же MobileCallScreen/
 *  CallOverflowSheets, что у участника с аккаунтом (этап 4) — гостевой режим
 *  они уже умеют (isGuestMode внутри useCallStageModel). Свой стек
 *  useMobileNav с корнем `guestCall`: страница /guest не смонтирована внутри
 *  MobileShell, поэтому навигацию нужно завести отдельно (D3).
 *
 *  Чат и ростер — оверлей ПОВЕРХ слоя звонка, а не замена его: удалённое
 *  аудио играет из тех же <video>, что и видео плиток, а эффект привязки
 *  потоков в useCallStageModel зависит от `[participants, focusedUserId]` —
 *  перемонтированные после «Назад» плитки он бы не перепривязал, и гость
 *  оставался бы без звука до конца звонка. Слой звонка поэтому только
 *  прячется (`visibility: hidden`, тот же приём, что `.mobile-screen.is-under`
 *  в MobileShell.css), DOM и воспроизведение живут. */
export function GuestMobileCallShell() {
  const nav = useMobileNav({ kind: 'guestCall' });
  const shellRef = useRef<HTMLDivElement>(null);
  useVisualViewportInset(shellRef);

  // Нормализация записи — как в MobileShell: нет стека → корень; sheet'ы
  // после reload не живы. Без засева BottomSheet'ы (useBackDismiss) клали бы
  // свои записи поверх фоллбека useMobileNav, а не поверх `guestCall`.
  useEffect(() => {
    if (!nav.valid) { nav.replaceStack([{ kind: 'guestCall' }]); return; }
    const clean = stripSheets(nav.stack);
    if (clean.length !== nav.stack.length) nav.replaceStack(clean);
  }, []); // только при монтировании (ESLint в репо нет — disable-комментарий не нужен)

  const overlay = nav.top.kind === 'guestChat' ? <GuestChatScreen onBack={nav.back} />
    : nav.top.kind === 'guestParticipants' ? <GuestParticipantsScreen onBack={nav.back} />
      : null;

  return (
    <div className="guest-mobile-call-shell" ref={shellRef}>
      <div className={`guest-mobile-call-layer${overlay ? ' is-hidden' : ''}`} aria-hidden={overlay !== null}>
        <GuestCallLayer nav={nav} />
      </div>
      {overlay && <div className="guest-mobile-call-overlay">{overlay}</div>}
    </div>
  );
}

/** connecting/resuming: тот же спиннер, что десктопная GuestCallView
 *  показывает при `phase !== 'in_call'` — без этой проверки MobileCallScreen
 *  вернул бы null (`!m.isInGroupCall`), т.е. пустой экран вместо спиннера.
 *  Модель сцены (GuestInCallStage) монтируется только в `in_call` — как
 *  десктопная CallStage внутри GuestCallView. */
function GuestCallLayer({ nav }: { nav: MobileNav }) {
  const t = useT();
  const phase = useGuestCallStore((s) => s.phase);
  if (phase !== 'in_call') {
    return (
      <div className="guest-page guest-page-stage">
        <div className="guest-status">
          <Loader2 size={28} strokeWidth={1.8} className="guest-spinner" />
          <span>{t('guest.connecting')}</span>
        </div>
      </div>
    );
  }
  return <GuestInCallStage nav={nav} />;
}

function GuestInCallStage({ nav }: { nav: MobileNav }) {
  const leave = useGuestCallStore((s) => s.leave);
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const model = useCallStageModel({ onLeave: () => void leave() });
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowInitialSub, setOverflowInitialSub] = useState<CallOverflowSub>(null);

  return (
    <>
      {/* Без onBack: у аутентифицированного звонка шеврон «свернуть» уводит
          к чату канала, а гостю сворачивать некуда — привязанный к leave()
          он молча завершал бы сессию. Выход — красная кнопка панели. */}
      <MobileCallScreen
        model={model}
        onOpenChat={() => nav.push({ kind: 'guestChat' })}
        onOpenOverflow={() => { setOverflowInitialSub(null); setOverflowOpen(true); }}
        onOpenQuality={() => { setOverflowInitialSub('quality'); setOverflowOpen(true); }}
        chatUnreadCount={chatUnread}
        onOpenParticipants={() => nav.push({ kind: 'guestParticipants' })}
      />
      <CallOverflowSheets
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        model={model}
        guestsPresent={false}
        initialSub={overflowInitialSub}
      />
    </>
  );
}
