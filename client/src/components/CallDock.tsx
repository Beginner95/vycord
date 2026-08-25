import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';
import './CallDock.css';

interface CallDockProps {
  onGoToCall: (serverId: string | null, channelId: string) => void;
}

export function CallDock({ onGoToCall }: CallDockProps) {
  const t = useT();
  const { callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } =
    useCallStore();
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  if (!callChannelId || status === 'idle') return null;

  const otherServer = callServerId !== null && callServerId !== currentServerId;

  return (
    <div className="call-dock">
      <button
        type="button"
        className="call-dock-target"
        onClick={() => onGoToCall(callServerId, callChannelId)}
        title={t('call.goToCall')}
      >
        <span className="call-dock-status">
          {status === 'reconnecting' ? t('call.reconnecting') : t('call.inCallAt')}
        </span>
        <span className="call-dock-channel">
          #{callChannelName}
          {otherServer && callServerName && <span className="call-dock-server"> · {callServerName}</span>}
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
          className="panel-icon-btn danger"
          onClick={() => useCallStore.getState().leave()}
          title={t('call.leaveCall')}
        >
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
