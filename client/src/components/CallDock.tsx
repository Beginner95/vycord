import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useDirectCallStore } from '@/stores/directCallStore';
import type { CallTarget } from '@/pages/app/useAppController';
import { useT } from '@/i18n';
import './CallDock.css';

interface CallDockProps {
  onGoToCall: (target: CallTarget) => void;
}

export function CallDock({ onGoToCall }: CallDockProps) {
  const t = useT();
  const { callRoomId, callKind, callPeer, callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } =
    useCallStore();
  const directPhase = useDirectCallStore((s) => s.phase);
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  // Исходящий/соединяющийся 1:1 ещё без комнаты — док показывает «Звоним …»
  // (или «Соединение…») и отмену. Если мы уже в другой комнате, остаётся
  // обычный док с её управлением.
  if ((directPhase.kind === 'outgoing' || directPhase.kind === 'connecting') && callRoomId === null) {
    return (
      <div className="call-dock">
        <button
          type="button"
          className="call-dock-target"
          onClick={() => onGoToCall({ kind: 'direct' })}
          title={t('call.goToCall')}
        >
          <span className="call-dock-channel">{directPhase.kind === 'connecting'
              ? t('directCall.connectingTo', { name: directPhase.peer.username })
              : t('directCall.callingName', { name: directPhase.peer.username })}</span>
        </button>
        <div className="call-dock-actions">
          <button
            type="button"
            className="panel-icon-btn is-danger"
            onClick={() => useDirectCallStore.getState().hangup()}
            title={t('directCall.cancel')}
          >
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
    <div className="call-dock">
      <button
        type="button"
        className="call-dock-target"
        onClick={goTo}
        title={t('call.goToCall')}
      >
        {/* У 1:1 «В звонке» дублировало бы строку «В звонке с …» ниже — статус
            показываем, только когда он несёт информацию (переподключение). */}
        {(!direct || status === 'reconnecting') && (
          <span className="call-dock-status">
            {status === 'reconnecting' ? t('call.reconnecting') : t('call.inCallAt')}
          </span>
        )}
        <span className="call-dock-channel">
          {direct && callPeer ? (
            t('directCall.inCallWith', { name: callPeer.username })
          ) : (
            <>
              #{callChannelName}
              {otherServer && callServerName && <span className="call-dock-server"> · {callServerName}</span>}
            </>
          )}
        </span>
      </button>
      <div className="call-dock-actions">
        <button
          type="button"
          className={`panel-icon-btn${isMuted ? ' is-off' : ''}`}
          onClick={() => useCallStore.getState().toggleMute()}
          title={isMuted ? t('call.micOn') : t('call.micOff')}
        >
          {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className={`panel-icon-btn${isVideoOff ? ' is-off' : ''}`}
          onClick={() => useCallStore.getState().toggleVideo()}
          title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
        >
          {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="panel-icon-btn is-danger"
          onClick={leave}
          title={t('call.leaveCall')}
        >
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
