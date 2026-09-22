import { useEffect, useState } from 'react';
import {
  ChevronDown, Mic, MicOff, Video, VideoOff, MessageSquare,
  MoreHorizontal, PhoneOff, LayoutGrid, MonitorUp, Speaker, X,
} from 'lucide-react';
import type { CallStageModel } from '@/components/useCallStageModel';
import { RemoteParticipantTile } from '@/components/call/RemoteParticipantTile';
import { ConnectionIndicator } from '@/components/call/ConnectionIndicator';
import { StageTimer } from '@/components/call/StageTimer';
import { GuestLobbyToast } from '@/components/GuestLobbyToast';
import { Avatar } from '@/components/Avatar';
import { mobileGridLayout, SPEAKING_THRESHOLD } from '@/utils/callStage';
import { usePinchZoom } from '@/mobile/gestures/usePinchZoom';
import { useAudioOutput } from '@/mobile/hooks/useAudioOutput';
import { useT } from '@/i18n';
import './MobileCallScreen.css';

interface MobileCallScreenProps {
  // Владелец модели — `CallScreen` (renderScreen.tsx), выше этого компонента:
  // один вызов useCallStageModel() на весь экран звонка, а не отдельный здесь
  // и ещё один внутри CallOverflowSheets поверх того же звонка — иначе
  // шторки «⋯»/качества рендерились бы от замороженной на момент открытия
  // копии модели (Important I1, task-final-fix-report.md).
  model: CallStageModel;
  onBack: () => void;
  onOpenChat: () => void;
  onOpenOverflow: () => void;
  // Хедер: тап по индикатору качества связи открывает CallQualitySheet
  // напрямую (D6), в обход общего списка «⋯» — отдельный колбэк, а не второй
  // аргумент onOpenOverflow, чтобы её сигнатура осталась прежней для
  // остальных вызывающих и их тестов.
  onOpenQuality: () => void;
}

function useOrientation(): 'portrait' | 'landscape' {
  const [o, setO] = useState<'portrait' | 'landscape'>(
    () => (window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'),
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setO(mq.matches ? 'landscape' : 'portrait');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return o;
}

/** Мобильная сцена группового звонка (спека §6.2). Навигация (T7) и
 *  содержимое «⋯»-шторки (T6, `CallOverflowSheets`) живут снаружи, в
 *  `renderScreen.tsx`'s `CallScreen`, которая также владеет `model` —
 *  `onOpenOverflow`/`onOpenQuality` здесь только переключают, какая шторка
 *  открыта, саму модель они больше не носят (Important I1,
 *  task-final-fix-report.md). */
export function MobileCallScreen({ model: m, onBack, onOpenChat, onOpenOverflow, onOpenQuality }: MobileCallScreenProps) {
  const t = useT();
  const audioOutput = useAudioOutput(m.applySinkId);
  const orientation = useOrientation();
  const pinch = usePinchZoom();
  const [pipCorner, setPipCorner] = useState<'tl' | 'tr' | 'bl' | 'br'>('br');

  // Просмотр демонстрации: фокус на шарящем участнике уходит в fullscreen +
  // landscape-lock (спека §6.2). Чисто мобильное поведение — намеренно не в
  // useCallStageModel, десктопная сцена ориентацию не блокирует.
  useEffect(() => {
    const sharing = m.focusedUserId !== null && m.screenSharers.has(m.focusedUserId);
    if (!sharing) return;
    const container = document.querySelector('.mcs-focus');
    if (container instanceof HTMLElement) container.requestFullscreen?.().catch(() => {});
    screen.orientation?.lock?.('landscape').catch(() => {});
    return () => { screen.orientation?.unlock?.(); };
  }, [m.focusedUserId, m.screenSharers]);

  if (!m.isInGroupCall) return null;

  const { columns, scroll } = mobileGridLayout(m.totalParticipants, orientation);
  const firstSharer = m.screenSharers.size > 0 ? [...m.screenSharers][0] : null;
  const showSharingBanner = firstSharer && !m.focusedUserId && !m.bannerDismissed;
  // Тот же расчёт, что и десктопная сцена (CallStage.tsx) — имя для оверлея
  // фокус-вида, в том числе когда у участника выключена камера (D6 — чинит
  // FIFTH FINDING task-9-verify-report.md).
  const focusedName = m.focusedUserId ? m.nameFor(m.focusedUserId) : '';

  const dragPip = (e: React.PointerEvent) => {
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      // Ближайший угол по знаку смещения от точки начала жеста относительно
      // экрана — простая эвристика, без пиксельной математики боксов.
      const right = ev.clientX > window.innerWidth / 2;
      const bottom = ev.clientY > window.innerHeight / 2;
      if (Math.hypot(dx, dy) > 24) setPipCorner(`${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as typeof pipCorner);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // A browser-cancelled drag (e.g. an interrupting system gesture) fires
    // pointercancel instead of pointerup — without this the pointermove
    // listener leaks until some unrelated future pointerup fires anywhere on
    // the page (Minor M7, task-final-fix-report.md).
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="mobile-call-screen">
      <div className="mcs-topbar">
        <button type="button" className="mcs-collapse-btn" onClick={onBack} aria-label={t('call.collapseCall')}>
          <ChevronDown size={22} strokeWidth={1.8} />
        </button>
        <div className="mcs-title">
          <span className="mcs-title-name">{m.callChannelName ? `#${m.callChannelName}` : t('call.groupCallTitle')}</span>
          <span className="mcs-title-timer"><StageTimer /></span>
        </div>
        <button
          type="button"
          className="mcs-quality-btn"
          onClick={() => onOpenQuality()}
          aria-label={t('call.qualityDetails')}
        >
          <ConnectionIndicator metrics={m.localQuality} />
        </button>
      </div>

      {m.isReconnecting && <div className="mcs-reconnecting">{t('call.reconnecting')}</div>}

      {showSharingBanner && (
        <div className="mcs-share-banner">
          <MonitorUp size={16} strokeWidth={1.8} />
          <span className="mcs-share-banner-text">{t('call.isSharingScreen', { name: m.nameFor(firstSharer!) })}</span>
          <button type="button" className="mcs-share-banner-btn" onClick={() => m.setFocusedUserId(firstSharer)}>
            {t('call.view')}
          </button>
          <button type="button" className="mcs-share-banner-dismiss" onClick={m.dismissBanner} title={t('call.dismiss')}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}

      {m.stageError && <div className="error-toast">{m.stageError}</div>}

      <div className="mcs-body">
        {m.focusedUserId ? (
          /* Фокус: главное видео + горизонтальная лента миниатюр внизу — та же
             структура, что и десктопная `.stage-focus`/`.stage-focus-main`/
             `.stage-thumbs` (CallStage.tsx). Без ленты плитки остальных
             участников размонтировались (setRemoteVideoRef(id, null)), а
             <video> — единственное место, откуда у немейн-фокусного
             участника вообще звучит аудио (см. комментарий "audio comes from
             the thumbnail element for camera focus" в useCallStageModel.ts) —
             весь звонок замолкал при фокусе (Critical C1,
             task-final-fix-report.md). */
          <div className="mcs-focus">
            <div
              className="mcs-focus-main"
              style={pinch.state.scale > 1 ? { touchAction: 'none' } : undefined}
              {...pinch.handlers}
              onDoubleClick={pinch.reset}
            >
              <video
                ref={m.focusedVideoRef}
                autoPlay
                playsInline
                className="mcs-focus-video"
                style={{ transform: `translate(${pinch.state.x}px, ${pinch.state.y}px) scale(${pinch.state.scale})` }}
                // Повторный тап возвращает в сетку (спека §6.2), но только
                // пока не зумлено — иначе однократный тап конфликтовал бы с
                // жестом двойного тапа для сброса зума на этом же элементе
                // (Minor M4, task-final-fix-report.md).
                onClick={pinch.state.scale === 1 ? () => m.setFocusedUserId(null) : undefined}
              />
              <div className="mcs-focus-label">
                <span className="mcs-focus-name">{focusedName}</span>
              </div>
              <button type="button" className="mcs-focus-back" onClick={() => m.setFocusedUserId(null)} title={t('call.backToGrid')}>
                <LayoutGrid size={16} strokeWidth={1.8} />
              </button>
            </div>

            <div className="mcs-focus-thumbs">
              {/* Локальная миниатюра — тот же `.stage-thumb`, что и у
                  удалённых участников ниже, для визуальной консистентности
                  ленты (десктопный `.stage-thumbs` смешивает их так же). */}
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
                  isVolumePopoverOpen={false}
                  onToggleVolumePopover={() => {}}
                  onCloseVolumePopover={() => {}}
                  onVolumeChange={(v) => m.onVolumeChange(p.userId, v)}
                  quality={m.qualityByUser[p.userId]}
                />
              ))}
            </div>
          </div>
        ) : m.participants.length === 0 ? (
          /* Соло — только себя (спека §6.2: «1 → весь экран»). Тот же <video>,
             что и в PiP ниже, но во весь .mcs-body, не в плавающем 96×128px
             углу (Blocker THIRD FINDING, task-9-verify-report.md). */
          <div className="mcs-solo">
            <video ref={m.localVideoRef} autoPlay playsInline muted className={m.isScreenSharing ? 'is-screen' : 'is-mirrored'} />
            {m.isVideoOff && !m.isScreenSharing && (
              <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="mcs-solo-avatar" />
            )}
          </div>
        ) : (
          <div
            className={`mcs-grid mcs-grid-cols-${columns}${scroll ? ' is-scroll' : ''}`}
          >
            <div className={`mcs-tile mcs-pip is-${pipCorner}`} onPointerDown={dragPip}>
              <video ref={m.localVideoRef} autoPlay playsInline muted className={m.isScreenSharing ? 'is-screen' : 'is-mirrored'} />
              {m.isVideoOff && !m.isScreenSharing && <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="mcs-tile-avatar" />}
            </div>
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
                isVolumePopoverOpen={false}
                onToggleVolumePopover={() => {}}
                onCloseVolumePopover={() => {}}
                onVolumeChange={(v) => m.onVolumeChange(p.userId, v)}
                quality={m.qualityByUser[p.userId]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Гостю нечем «впускать» гостей из лобби — то же условие, что десктопная
          сцена (CallStage.tsx) ставит на этот же компонент. */}
      {!m.isGuestMode && <GuestLobbyToast />}

      <div className="mcs-panel">
        <button type="button" className={`mcs-panel-btn${m.isMuted ? ' is-off' : ''}`} onClick={m.handleToggleMute} disabled={!m.isMicAvailable} aria-label={m.isMuted ? t('call.micOn') : t('call.micOff')}>
          {m.isMuted ? <MicOff size={22} strokeWidth={1.8} /> : <Mic size={22} strokeWidth={1.8} />}
        </button>
        <button type="button" className={`mcs-panel-btn${m.isVideoOff ? ' is-off' : ''}`} onClick={m.handleToggleVideo} disabled={m.isScreenSharing} aria-label={m.isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
          {m.isVideoOff ? <VideoOff size={22} strokeWidth={1.8} /> : <Video size={22} strokeWidth={1.8} />}
        </button>
        {/* Динамик (D7): циклический переключатель аудиовыхода — скрыта, когда
            setSinkId недоступен в браузере или устройство вывода всего одно
            (useAudioOutput сама решает supported). */}
        {audioOutput.supported && (
          <button type="button" className="mcs-panel-btn" onClick={audioOutput.cycle} aria-label={audioOutput.currentLabel} title={audioOutput.currentLabel}>
            <Speaker size={22} strokeWidth={1.8} />
          </button>
        )}
        <button type="button" className="mcs-panel-btn" onClick={onOpenChat} aria-label={t('mobile.callOpenChat')}>
          <MessageSquare size={22} strokeWidth={1.8} />
        </button>
        <button type="button" className="mcs-panel-btn" onClick={() => onOpenOverflow()} aria-label={t('mobile.callActions')}>
          <MoreHorizontal size={22} strokeWidth={1.8} />
        </button>
        <button type="button" className="mcs-panel-btn is-danger" onClick={m.handleLeaveGroupCall} aria-label={t('call.leaveCall')}>
          <PhoneOff size={22} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
