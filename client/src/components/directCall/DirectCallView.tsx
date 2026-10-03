import { PhoneOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { CallStage } from '@/components/CallStage';
import { useDirectCallStore } from '@/stores/directCallStore';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';
import type { CallEndReason } from '@/types/directCall';
import './DirectCallView.css';

const REASON_KEY = {
  ended: 'directCall.endedEnded',
  missed: 'directCall.endedMissed',
  timeout: 'directCall.endedTimeout',
  rejected: 'directCall.endedRejected',
  failed: 'directCall.endedFailed',
} as const satisfies Record<CallEndReason, string>;

interface DirectCallViewProps {
  /** Мобильный экран `call` уже сам решил показать вид — флаг viewOpen не нужен. */
  ignoreViewOpen?: boolean;
}

/** Экран звонка 1:1 в основной колонке: дозвон → сцена → исход. */
export function DirectCallView({ ignoreViewOpen = false }: DirectCallViewProps = {}) {
  const t = useT();
  const phase = useDirectCallStore((s) => s.phase);
  const viewOpen = useDirectCallStore((s) => s.viewOpen);
  const hangup = useDirectCallStore((s) => s.hangup);
  const callRoomId = useCallStore((s) => s.callRoomId);
  const callKind = useCallStore((s) => s.callKind);

  if ((!viewOpen && !ignoreViewOpen) || phase.kind === 'idle') return null;
  const stage = (
    <div className="direct-call-view is-stage">
      <CallStage />
    </div>
  );
  // Входящий Y поверх активного X: остаёмся на сцене X, карточку рисует Task 10.
  if (phase.kind === 'incoming') return callKind === 'direct' && callRoomId !== null ? stage : null;
  // CallStage пуст, пока callRoomId не выставлен (join ещё в полёте), поэтому
  // до входа в комнату показываем экран дозвона с «Соединение…» и отменой.
  if ((phase.kind === 'active' || phase.kind === 'connecting') && callRoomId === phase.callId) return stage;

  const waiting = phase.kind === 'outgoing' || phase.kind === 'connecting' || phase.kind === 'active';
  const ringing = phase.kind === 'outgoing';
  return (
    <div className="direct-call-view">
      <div className={`direct-call-avatar${ringing ? ' is-ringing' : ''}`}>
        <Avatar url={phase.peer.avatar_url ?? undefined} username={phase.peer.username} className="direct-call-avatar-img" />
      </div>
      <h2 className="direct-call-name">{phase.peer.username}</h2>
      <p className="direct-call-status" role="status">
        {phase.kind === 'outgoing'
          ? t('directCall.calling')
          : phase.kind === 'ending' ? t(REASON_KEY[phase.reason]) : t('directCall.connecting')}
      </p>
      {waiting && (
        <button type="button" className="btn btn-danger direct-call-cancel" onClick={hangup}>
          <PhoneOff size={18} strokeWidth={1.8} />
          <span>{t('directCall.cancel')}</span>
        </button>
      )}
    </div>
  );
}
