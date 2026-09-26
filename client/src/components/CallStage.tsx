import { createPortal } from 'react-dom';
import { useCallback, useRef, useState } from 'react';
import {
  Layers, Maximize2, Minimize2, Mic, MicOff, Video, VideoOff,
  MonitorUp, PhoneOff, X, LayoutGrid, UserPlus,
} from 'lucide-react';
import { useCallStageModel } from './useCallStageModel';
import { ConnectionIndicator } from './call/ConnectionIndicator';
import { StageTimer } from './call/StageTimer';
import { RemoteParticipantTile } from './call/RemoteParticipantTile';
import { BackgroundPicker } from './call/BackgroundPicker';
import { GuestInvitePopover } from './GuestInvitePopover';
import { GuestLobbyToast } from './GuestLobbyToast';
import { ScreenSourcePicker, ScreenQualityPicker } from './ScreenSharePicker';
import { Avatar } from './Avatar';
import { useT, useTp } from '@/i18n';
import { useVideoEffects } from '@/hooks/useVideoEffects';
import { groupCallService } from '@/services/groupCall';
import { useBackgroundStore } from '@/stores/backgroundStore';
import { stageGridClass, SPEAKING_THRESHOLD } from '@/utils/callStage';
import './CallStage.css';

interface CallStageProps {
  /**
   * Гостевой режим (страница /guest): вместо выхода через callStore.leave
   * зовётся этот колбэк — гостю нужно ещё сказать серверу «ушёл» и показать
   * экран конца. Заодно прячет то, что гостю не положено: приглашение гостей
   * и тост лобби.
   */
  onLeave?: () => void;
  /** Дополнительные кнопки панели управления перед «Выйти» (чат, участники гостя). */
  extraControls?: React.ReactNode;
}

// Сцена звонка. Рендерится только когда открытый канал совпадает с каналом
// звонка (см. AppPage), поэтому монтируется и размонтируется вместе с
// переключением каналов — всё состояние звонка живёт в сторе, а не здесь.
export function CallStage({ onLeave, extraControls }: CallStageProps) {
  const t = useT();
  const tp = useTp();
  const m = useCallStageModel({ onLeave });

  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const bgBtnRef = useRef<HTMLButtonElement>(null);
  const bgMode = useBackgroundStore((s) => s.mode);
  const bgId = useBackgroundStore((s) => s.backgroundId);

  useVideoEffects(
    m.isInGroupCall ? groupCallService.localStreamState : null,
    bgMode,
    bgId,
    useCallback((track) => {
      void groupCallService.setCameraOutput(track);
    }, []),
  );

  if (!m.isInGroupCall) return null;

  // Displayed name for the focused participant
  const focusedName = m.focusedUserId
    ? m.nameFor(m.focusedUserId)
    : '';
  // VYC-96: the focused participant announced camera_off. A share wins — the
  // focused surface then shows the screen.
  const focusedCameraOff = m.focusedUserId !== null
    && (m.remoteCameraOff.get(m.focusedUserId) ?? false)
    && !m.screenSharers.has(m.focusedUserId);
  // First screen sharer ID for the banner
  const firstSharer = m.screenSharers.size > 0 ? [...m.screenSharers][0] : null;

  return (
    <div className={`call-stage${m.fullscreenTarget === 'stage' ? ' is-fullscreen' : ''}`} ref={m.stageRef}>
      {m.isReconnecting && (
        <div className="stage-reconnecting">{t('call.reconnecting')}</div>
      )}
      {/* M6 T12: the toast is a child of .call-stage, but focus fullscreen puts
          .stage-focus-main — a DESCENDANT of the stage — into the top layer, and
          the top layer paints only the fullscreen element and its own
          descendants. So a screen-share error raised while watching a share
          fullscreen rendered into a subtree the compositor was not drawing:
          present in the DOM, auto-dismissed after 5s, never seen. Whole-stage
          fullscreen (decision 24) was always fine — there the stage itself is
          the top-layer element and the toast is inside it.
          Re-targeting a portal on fullscreenchange is the pattern .stage-tip
          already uses in this file for the identical reason; this reuses the
          existing fullscreenchange listener rather than adding a second one.
          fullscreenEl is null on the Electron path (setFullScreen never sets
          document.fullscreenElement) — and correctly so: Electron fullscreen
          uses no top layer, so the in-place toast is visible there already. */}
      {m.stageError && (
        m.fullscreenEl && m.fullscreenTarget === 'focus'
          ? createPortal(<div className="error-toast">{m.stageError}</div>, m.fullscreenEl)
          : <div className="error-toast">{m.stageError}</div>
      )}
      {m.showSourcePickerModal && (
        <ScreenSourcePicker
          sources={m.screenSources}
          onSelect={m.handleSelectSource}
          onCancel={m.closeSourcePicker}
        />
      )}
      {m.showQualityPicker && (
        <ScreenQualityPicker
          onSelect={m.handleSelectQuality}
          onCancel={m.closeQualityPicker}
        />
      )}
      <div className="stage-topbar">
        <div className="stage-live-pill">
          <span className="stage-live-dot" />
          {t('call.live')} <StageTimer />
        </div>
        <h2 className="stage-title">{m.callChannelName ? `#${m.callChannelName}` : t('call.groupCallTitle')}</h2>
        <div className="stage-topbar-right">
          <span className="stage-count-chip">{tp('call.participants', m.totalParticipants)}</span>
          <button
            className="stage-fullscreen-btn"
            onClick={() => { void m.handleStageFullscreen(); }}
            aria-label={m.stageFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
            title={m.stageFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
          >
            {m.stageFullscreenActive
              ? <Minimize2 size={16} strokeWidth={1.8} />
              : <Maximize2 size={16} strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      <div className="call-body">
        <div className="call-video-area">
          {/* Banner: shown when someone is sharing but user hasn't opened focus view */}
          {firstSharer && !m.focusedUserId && !m.bannerDismissed && (
            <div className="stage-share-banner">
              <MonitorUp size={16} strokeWidth={1.8} />
              <span className="stage-share-banner-text">
                {t('call.isSharingScreen', { name: m.nameFor(firstSharer) })}
              </span>
              <button
                className="stage-share-banner-btn"
                onClick={() => m.setFocusedUserId(firstSharer)}
              >
                {t('call.view')}
              </button>
              <button
                className="stage-share-banner-dismiss"
                onClick={() => m.dismissBanner()}
                title={t('call.dismiss')}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
          )}

          {m.focusedUserId ? (
            /* ── Focused / screen-share view ── */
            <div className="stage-focus">
              <div
                className={`stage-focus-main${m.fullscreenTarget === 'focus' ? ' is-fullscreen' : ''}`}
                ref={m.screenShareMainRef}
              >
                <video
                  ref={m.focusedVideoRef}
                  autoPlay
                  playsInline
                  className="stage-focus-video"
                />
                {/* VYC-96: сфокусированный участник выключил камеру — аватар
                    поверх чёрного кадра. Демонстрация имеет приоритет. */}
                {focusedCameraOff && (
                  <Avatar username={focusedName} className="stage-focus-avatar" />
                )}
                <div className="stage-focus-label">
                  {/* M6 T12: the name is a .stage-name span for the same reason
                      the two plates and two thumb labels are — text-overflow has
                      to live on the flex ITEM, not on the flex container. As a
                      bare text node it had nowhere to put an ellipsis and the
                      label just ran under .stage-focus-main's overflow: hidden. */}
                  <span className="stage-name">{focusedName}</span>
                  {m.screenSharers.has(m.focusedUserId) && (
                    <span className="stage-focus-badge">
                      <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
                    </span>
                  )}
                </div>
                {/* On the browser path this button owns the FOCUSED surface
                    only, so focusFullscreenActive resolves to
                    fullscreenTarget === 'focus' — whole-stage fullscreen must
                    not render the exit icon here. On the Electron path it
                    resolves to "is anything fullscreen" for the reason spelled
                    out at the state declaration (ruling T4-e). */}
                <div className="stage-focus-controls">
                  <button
                    className="stage-focus-ctrl-btn"
                    onClick={() => { void m.handleFocusFullscreen(); }}
                    title={m.focusFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
                  >
                    {m.focusFullscreenActive
                      ? <Minimize2 size={16} strokeWidth={1.8} />
                      : <Maximize2 size={16} strokeWidth={1.8} />}
                  </button>
                  <button
                    className="stage-focus-ctrl-btn"
                    onClick={() => m.setFocusedUserId(null)}
                    title={t('call.backToGrid')}
                  >
                    <LayoutGrid size={16} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Thumbnail strip */}
              <div className="stage-thumbs">
                {/* Local thumbnail */}
                <div
                  className={`stage-thumb${m.micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                  style={{ '--speak-level': Math.min(1, m.micLevel) } as React.CSSProperties}
                  title={`${m.user?.username ?? ''} ${t('call.youSuffix')}`}
                >
                  <video
                    ref={m.localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={m.isScreenSharing ? 'is-screen' : 'is-mirrored'}
                  />
                  {m.isVideoOff && !m.isScreenSharing && (
                    <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="stage-thumb-avatar" />
                  )}
                  {m.isScreenSharing && (
                    <div className="stage-thumb-badge">
                      <MonitorUp size={10} strokeWidth={1.8} />
                    </div>
                  )}
                  <ConnectionIndicator metrics={m.localQuality} />
                  <div className="stage-thumb-label">
                    {m.isMuted
                      ? <span className="stage-plate-mic is-muted"><MicOff size={10} strokeWidth={1.8} /></span>
                      : <span className="stage-plate-mic"><Mic size={10} strokeWidth={1.8} /></span>}
                    <span className="stage-name">{m.user?.username} {t('call.youSuffix')}</span>
                  </div>
                </div>

                {/* Remote thumbnails */}
                {m.participants.map((p) => (
                  <RemoteParticipantTile
                    key={p.userId}
                    participant={p}
                    displayName={m.nameFor(p.userId)}
                    muted={m.remoteMicMuted.get(p.userId) ?? false}
                    isSharing={m.screenSharers.has(p.userId)}
                    layout="thumbnail"
                    isFocused={m.focusedUserId === p.userId}
                    onFocus={() => m.setFocusedUserId(p.userId)}
                    videoRefSetter={(el) => m.setRemoteVideoRef(p.userId, el)}
                    volume={m.participantVolumes[p.userId] ?? 100}
                    isVolumePopoverOpen={m.volumePopoverUserId === p.userId}
                    onToggleVolumePopover={() => m.toggleVolumePopover(p.userId)}
                    onCloseVolumePopover={m.closeVolumePopover}
                    onVolumeChange={(value) => m.onVolumeChange(p.userId, value)}
                    quality={m.qualityByUser[p.userId]}
                    cameraOff={m.remoteCameraOff.get(p.userId) ?? false}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── Normal video grid ── */
            <div className={`stage-grid ${stageGridClass(m.totalParticipants)}`.trim()}>
              {/* Local video */}
              <div
                className={`stage-tile${m.isVideoOff && !m.isScreenSharing ? ' is-camera-off' : ''}${m.micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                style={{ '--speak-level': Math.min(1, m.micLevel) } as React.CSSProperties}
              >
                <video
                  ref={m.localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`stage-tile-video${m.isScreenSharing ? ' is-screen' : ' is-mirrored'}`}
                />
                {m.isVideoOff && !m.isScreenSharing && (
                  <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="stage-tile-avatar" />
                )}
                {m.isScreenSharing && (
                  <div className="stage-share-badge">
                    <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
                  </div>
                )}
                <div className="stage-tile-footer">
                  <div className="stage-plate">
                    {m.isMuted
                      ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
                      : m.micLevel > SPEAKING_THRESHOLD
                        ? <span className="stage-eq"><span /><span /><span /></span>
                        : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
                    <span className="stage-name">{m.user?.username} {t('call.youSuffix')}</span>
                  </div>
                  {m.isVideoOff && !m.isScreenSharing && (
                    <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
                  )}
                </div>
                <ConnectionIndicator metrics={m.localQuality} />
              </div>

              {/* Remote videos */}
              {m.participants.map((p) => (
                <RemoteParticipantTile
                  key={p.userId}
                  participant={p}
                  displayName={m.nameFor(p.userId)}
                  muted={m.remoteMicMuted.get(p.userId) ?? false}
                  isSharing={m.screenSharers.has(p.userId)}
                  layout="grid"
                  onFocus={() => m.setFocusedUserId(p.userId)}
                  videoRefSetter={(el) => m.setRemoteVideoRef(p.userId, el)}
                  volume={m.participantVolumes[p.userId] ?? 100}
                  isVolumePopoverOpen={m.volumePopoverUserId === p.userId}
                  onToggleVolumePopover={() => m.toggleVolumePopover(p.userId)}
                  onCloseVolumePopover={m.closeVolumePopover}
                  onVolumeChange={(value) => m.onVolumeChange(p.userId, value)}
                  quality={m.qualityByUser[p.userId]}
                  cameraOff={m.remoteCameraOff.get(p.userId) ?? false}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {!m.isGuestMode && <GuestLobbyToast />}

      <div className="stage-controls">
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${m.isMuted ? ' is-off' : ''}`}
            onClick={m.handleToggleMute}
            disabled={!m.isMicAvailable}
            title={!m.isMicAvailable ? t('call.micUnavailable') : m.isMuted ? t('call.micOn') : t('call.micOff')}
          >
            {m.isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
          </button>
          <span className="stage-ctl-label">{t('call.ctlMic')}</span>
        </div>
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${m.isVideoOff ? ' is-off' : ''}`}
            onClick={m.handleToggleVideo}
            disabled={m.isScreenSharing}
            title={m.isScreenSharing ? t('call.cameraUnavailableSharing') : m.isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
          >
            {m.isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
          </button>
          <span className="stage-ctl-label">{t('call.ctlCamera')}</span>
        </div>
        <div className="stage-ctl">
          <button
            ref={bgBtnRef}
            className={`stage-ctl-btn${bgPickerOpen ? ' is-on' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setBgPickerOpen((o) => !o)}
            title={t('call.bgMenu')}
          >
            <Layers size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.bgMenu')}</span>
        </div>
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${m.isScreenSharing ? ' is-on' : ''}`}
            onClick={() => { void m.handleToggleScreenShare(); }}
            title={m.isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen')}
          >
            <MonitorUp size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.ctlScreen')}</span>
        </div>
        {m.guestLinksEnabled && (
        <div className="stage-ctl">
          <button
            ref={m.inviteBtnRef}
            className={`stage-ctl-btn${m.invitePosition ? ' is-on' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={m.toggleInvitePopover}
            title={t('guestInvite.button')}
          >
            <UserPlus size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.ctlGuests')}</span>
        </div>
        )}
        {extraControls}
        <div className="stage-ctl-divider" />
        {/* M6 T15, from manual QA: this was the only control in the bar whose
            label sat INSIDE the button, as a pill, while mic / camera / screen
            all wear `.stage-ctl` — icon-only button with `.stage-ctl-label`
            beneath. It now takes the same shape. The button keeps its own class
            and its danger fill; only the label moved out. `.stage-leave-btn` is
            still the selector probe-stage-mobile.js measures for the 40px tap
            floor, so do not fold it into `.stage-ctl-btn`. */}
        <div className="stage-ctl">
          <button className="stage-leave-btn" onClick={m.handleLeaveGroupCall} title={t('call.leaveCall')}>
            <PhoneOff size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.leaveLabel')}</span>
        </div>
      </div>

      {m.invitePosition && m.callChannelId && (
        <GuestInvitePopover
          channelId={m.callChannelId}
          position={m.invitePosition}
          onClose={m.closeInvitePopover}
        />
      )}
      {bgPickerOpen && (
        <BackgroundPicker anchorRef={bgBtnRef} onClose={() => setBgPickerOpen(false)} />
      )}
    </div>
  );
}
