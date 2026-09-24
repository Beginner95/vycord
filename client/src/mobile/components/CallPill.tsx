import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';
import './CallPill.css';

interface CallPillProps {
  variant: 'root' | 'stacked';
  onGoToCall: (serverId: string | null, channelId: string) => void;
}

/** Мобильная замена десктопного `CallDock` (VYC-95 T7): та же логика
 *  видимости/состояния из callStore, плюс класс по контексту — `root`, когда
 *  пилюля сидит в потоке над таб-баром, `stacked`, когда плавает поверх
 *  экрана, пока открыт другой не-call экран. */
export function CallPill({ variant, onGoToCall }: CallPillProps) {
  const t = useT();
  const { callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } = useCallStore();
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  if (!callChannelId || status === 'idle') return null;
  const otherServer = callServerId !== null && callServerId !== currentServerId;

  return (
    <div className={`call-pill is-${variant}`}>
      <button type="button" className="call-pill-target" onClick={() => onGoToCall(callServerId, callChannelId)} title={t('call.goToCall')}>
        <span className="call-pill-status">{status === 'reconnecting' ? t('call.reconnecting') : t('call.inCallAt')}</span>
        <span className="call-pill-channel">
          #{callChannelName}
          {otherServer && callServerName && <span className="call-pill-server"> · {callServerName}</span>}
        </span>
      </button>
      <div className="call-pill-actions">
        <button type="button" className={`panel-icon-btn${isMuted ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleMute()} title={isMuted ? t('call.micOn') : t('call.micOff')}>
          {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className={`panel-icon-btn${isVideoOff ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleVideo()} title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
          {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className="panel-icon-btn is-danger" onClick={() => useCallStore.getState().leave()} title={t('call.leaveCall')}>
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
