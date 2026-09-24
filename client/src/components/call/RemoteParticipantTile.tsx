import { useRef, useState } from 'react';
import { Mic, MicOff, MonitorPlay, MonitorUp, Volume2, Expand } from 'lucide-react';
import type { RemoteParticipant } from '@/stores/callStore';
import type { ConnectionQualityMetrics } from '@/utils/callQuality';
import { VolumeControlPopover } from '../VolumeControlPopover';
import { Avatar } from '../Avatar';
import { useT } from '@/i18n';
import { useMicLevel } from '@/hooks/useMicLevel';
import { SPEAKING_THRESHOLD } from '@/utils/callStage';
import { ConnectionIndicator } from './ConnectionIndicator';

// ─── Remote Participant Tile ─────────────────────────────────────────────────
// Wraps useMicLevel per participant — hooks can't run inside .map(), so each
// remote tile (grid or thumbnail) needs its own component instance.

interface RemoteParticipantTileProps {
  participant: RemoteParticipant;
  displayName: string;
  muted: boolean;
  isSharing: boolean;
  layout: 'grid' | 'thumbnail';
  isFocused?: boolean;
  onFocus: () => void;
  videoRefSetter: (el: HTMLVideoElement | null) => void;
  volume: number;
  isVolumePopoverOpen: boolean;
  onToggleVolumePopover: () => void;
  onCloseVolumePopover: () => void;
  onVolumeChange: (value: number) => void;
  quality?: ConnectionQualityMetrics;
  /**
   * VYC-96: участник объявил camera_off — вместо чёрного кадра показываем
   * аватар. По умолчанию false: DOM плитки прежний. Демонстрация экрана
   * (isSharing) имеет приоритет — при ней плитка ведёт себя как раньше.
   */
  cameraOff?: boolean;
}

export function RemoteParticipantTile({
  participant,
  displayName,
  muted,
  isSharing,
  layout,
  isFocused,
  onFocus,
  videoRefSetter,
  volume,
  isVolumePopoverOpen,
  onToggleVolumePopover,
  onCloseVolumePopover,
  onVolumeChange,
  quality,
  cameraOff = false,
}: RemoteParticipantTileProps) {
  const t = useT();
  const level = useMicLevel(participant.stream, muted);
  const speaking = level > SPEAKING_THRESHOLD;

  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  const handleVolumeBtnClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = volumeBtnRef.current?.getBoundingClientRect();
    if (rect) setPopoverPosition({ top: rect.bottom + 6, left: rect.left });
    onToggleVolumePopover();
  };

  const showWatchOverlay = isSharing && !isFocused;
  // Нет потока вовсе (как раньше) или камера объявлена выключенной — но не во
  // время демонстрации.
  const announcedCameraOff = cameraOff && !isSharing;
  const cameraOffView = !participant.stream || announcedCameraOff;

  if (layout === 'thumbnail') {
    return (
      <div
        className={`stage-thumb${isFocused ? ' is-focused' : ''}${announcedCameraOff ? ' is-camera-off' : ''}${speaking ? ' is-speaking' : ''}`}
        style={{ '--speak-level': Math.min(1, level) } as React.CSSProperties}
        onClick={onFocus}
        title={displayName}
      >
        {/* Remote thumb video is never mirrored — only the local preview is. */}
        <video ref={videoRefSetter} autoPlay playsInline style={showWatchOverlay ? { display: 'none' } : undefined} />
        {cameraOffView && !showWatchOverlay && (
          <Avatar username={displayName} className="stage-thumb-avatar" />
        )}
        {showWatchOverlay && (
          <div className="stage-watch-overlay">
            <MonitorPlay size={16} strokeWidth={1.8} />
            <button className="stage-watch-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
              {t('call.watchShare')}
            </button>
          </div>
        )}
        {isSharing && (
          <div className="stage-thumb-badge">
            <MonitorUp size={10} strokeWidth={1.8} />
          </div>
        )}
        <button
          ref={volumeBtnRef}
          className="stage-volume-btn"
          onClick={handleVolumeBtnClick}
          onMouseDown={(e) => e.stopPropagation()}
          title={t('call.volumeLabel', { value: volume })}
        >
          <Volume2 size={12} strokeWidth={1.8} />
        </button>
        {isVolumePopoverOpen && popoverPosition && (
          <VolumeControlPopover
            value={volume}
            position={popoverPosition}
            onChange={onVolumeChange}
            onClose={onCloseVolumePopover}
          />
        )}
        <ConnectionIndicator metrics={quality} />
        {/* Mic state at thumb scale: the full .stage-plate is too big, and the
            equalizer is illegible at 10px — the is-speaking ring carries that. */}
        <div className="stage-thumb-label">
          {muted
            ? <span className="stage-plate-mic is-muted"><MicOff size={10} strokeWidth={1.8} /></span>
            : <span className="stage-plate-mic"><Mic size={10} strokeWidth={1.8} /></span>}
          <span className="stage-name">{displayName}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`stage-tile${cameraOffView ? ' is-camera-off' : ''}${speaking ? ' is-speaking' : ''}`}
      style={{ '--speak-level': Math.min(1, level) } as React.CSSProperties}
    >
      {/* Remote video is never mirrored — only the local preview carries is-mirrored. */}
      <video
        ref={videoRefSetter}
        autoPlay
        playsInline
        className="stage-tile-video"
        style={showWatchOverlay ? { display: 'none' } : undefined}
      />
      {cameraOffView && !showWatchOverlay && (
        <Avatar username={displayName} className="stage-tile-avatar" />
      )}
      {showWatchOverlay && (
        <div className="stage-watch-overlay">
          <MonitorPlay size={20} strokeWidth={1.8} />
          <button className="stage-watch-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
            {t('call.watchShare')}
          </button>
        </div>
      )}
      {isSharing && (
        <div className="stage-share-badge">
          <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
        </div>
      )}
      <button className="stage-focus-btn" onClick={onFocus} title={t('call.focusParticipant')}>
        <Expand size={14} strokeWidth={1.8} />
      </button>
      <button
        ref={volumeBtnRef}
        className="stage-volume-btn"
        onClick={handleVolumeBtnClick}
        onMouseDown={(e) => e.stopPropagation()}
        title={t('call.volumeLabel', { value: volume })}
      >
        <Volume2 size={14} strokeWidth={1.8} />
      </button>
      {isVolumePopoverOpen && popoverPosition && (
        <VolumeControlPopover
          value={volume}
          position={popoverPosition}
          onChange={onVolumeChange}
          onClose={onCloseVolumePopover}
        />
      )}
      {/* M6 T12: plate and chip share a flex footer instead of being two
          independently-anchored absolute boxes. See .stage-tile-footer. */}
      <div className="stage-tile-footer">
        <div className="stage-plate">
          {muted
            ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
            : speaking
              ? <span className="stage-eq"><span /><span /><span /></span>
              : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
          <span className="stage-name">{displayName}</span>
        </div>
        {cameraOffView && !showWatchOverlay && (
          <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
        )}
      </div>
      <ConnectionIndicator metrics={quality} />
    </div>
  );
}
