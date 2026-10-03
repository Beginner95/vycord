import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useDirectCallStore } from '@/stores/directCallStore';
import type { CallTarget } from '@/pages/app/useAppController';
import { useT } from '@/i18n';
import './CallPill.css';

interface CallPillProps {
  variant: 'root' | 'stacked';
  onGoToCall: (target: CallTarget) => void;
}

/** Мобильная замена десктопного `CallDock` (VYC-95 T7): та же логика
 *  видимости/состояния из callStore, плюс класс по контексту — `root`, когда
 *  пилюля сидит в потоке над таб-баром, `stacked`, когда плавает поверх
 *  экрана, пока открыт другой не-call экран. */
export function CallPill({ variant, onGoToCall }: CallPillProps) {
  const t = useT();
  const { callRoomId, callKind, callPeer, callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } =
    useCallStore();
  const directPhase = useDirectCallStore((s) => s.phase);
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  // Исходящий/соединяющийся 1:1 ещё без комнаты — пилюля показывает «Звоним …»
  // (или «Соединение…») и отмену, как CallDock. Если мы уже в другой комнате,
  // остаётся обычная пилюля с её управлением.
  if ((directPhase.kind === 'outgoing' || directPhase.kind === 'connecting') && callRoomId === null) {
    return (
      <div className={`call-pill is-${variant}`}>
        <button type="button" className="call-pill-target" onClick={() => onGoToCall({ kind: 'direct' })} title={t('call.goToCall')}>
          <span className="call-pill-channel">{directPhase.kind === 'connecting'
            ? t('directCall.connectingTo', { name: directPhase.peer.username })
            : t('directCall.callingName', { name: directPhase.peer.username })}</span>
        </button>
        <div className="call-pill-actions">
          <button type="button" className="panel-icon-btn is-danger" onClick={() => useDirectCallStore.getState().hangup()} title={t('directCall.cancel')}>
            <PhoneOff size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    );
  }

  if (!callRoomId || status === 'idle') return null;
  const direct = callKind === 'direct';
  const otherServer = !direct && callServerId !== null && callServerId !== currentServerId;
  const goTo = () => {
    if (direct) onGoToCall({ kind: 'direct' });
    else if (callChannelId) onGoToCall({ kind: 'channel', serverId: callServerId, channelId: callChannelId });
  };
  const leave = () => (direct ? useDirectCallStore.getState().hangup() : useCallStore.getState().leave());

  return (
    <div className={`call-pill is-${variant}`}>
      <button type="button" className="call-pill-target" onClick={goTo} title={t('call.goToCall')}>
        {/* У 1:1 «В звонке» дублирует «В звонке с …» — статус только при переподключении. */}
        {(!direct || status === 'reconnecting') && (
          <span className="call-pill-status">{status === 'reconnecting' ? t('call.reconnecting') : t('call.inCallAt')}</span>
        )}
        <span className="call-pill-channel">
          {direct && callPeer ? (
            t('directCall.inCallWith', { name: callPeer.username })
          ) : (
            <>
              #{callChannelName}
              {otherServer && callServerName && <span className="call-pill-server"> · {callServerName}</span>}
            </>
          )}
        </span>
      </button>
      <div className="call-pill-actions">
        <button type="button" className={`panel-icon-btn${isMuted ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleMute()} title={isMuted ? t('call.micOn') : t('call.micOff')}>
          {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className={`panel-icon-btn${isVideoOff ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleVideo()} title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
          {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className="panel-icon-btn is-danger" onClick={leave} title={t('call.leaveCall')}>
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
