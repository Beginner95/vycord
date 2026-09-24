import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, Mic, MicOff, Video, VideoOff, MessageSquare,
  MoreHorizontal, PhoneOff, LayoutGrid, MonitorUp, Speaker, X, Users,
  Expand, Maximize, Minimize,
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
import { groupCallService } from '@/services/groupCall';
import { useT } from '@/i18n';
import './MobileCallScreen.css';

interface MobileCallScreenProps {
  // Владелец модели — вызывающий, выше этого компонента: `CallScreen`
  // (renderScreen.tsx) у участника с аккаунтом или `GuestMobileCallShell`
  // (pages/guest/) у гостя. Один вызов useCallStageModel() на весь экран
  // звонка, а не отдельный здесь и ещё один внутри CallOverflowSheets поверх
  // того же звонка — иначе
  // шторки «⋯»/качества рендерились бы от замороженной на момент открытия
  // копии модели (Important I1, task-final-fix-report.md).
  model: CallStageModel;
  /** Шеврон «свернуть» в шапке. Аутентифицированный `CallScreen` передаёт
   *  его всегда (уход к чату канала). `GuestMobileCallShell` — нет: гостю
   *  сворачивать некуда, а завязанный на leave() шеврон молча завершал бы
   *  гостевую сессию. Без пропа кнопка не рендерится (тот же приём, что
   *  `onOpenParticipants`/`chatUnreadCount` ниже). */
  onBack?: () => void;
  onOpenChat: () => void;
  onOpenOverflow: () => void;
  // Хедер: тап по индикатору качества связи открывает CallQualitySheet
  // напрямую (D6), в обход общего списка «⋯» — отдельный колбэк, а не второй
  // аргумент onOpenOverflow, чтобы её сигнатура осталась прежней для
  // остальных вызывающих и их тестов.
  onOpenQuality: () => void;
  /** Бейдж непрочитанного на кнопке «Чат» (спека §7) — нужен только гостю:
   *  у участника с аккаунтом непрочитанное в звонке отражается в обычном
   *  списке каналов, отдельного счётчика тут никогда не было и не нужно.
   *  Аутентифицированный `CallScreen` (renderScreen.tsx) этот проп не
   *  передаёт — там всегда `undefined`, кнопка рендерится как раньше. */
  chatUnreadCount?: number;
  /** Открыть ростер (спека §7, `guestParticipants`) — нужен только гостю: у
   *  гостя нет ни сайдбара, ни `channelInfo`, никакого другого способа
   *  увидеть, кто в звонке. Аутентифицированный `CallScreen` этот проп не
   *  передаёт (свой ростер — через `channelInfo`), поэтому кнопка там не
   *  рендерится и его раскладка не меняется (тот же приём, что
   *  `chatUnreadCount` выше). */
  onOpenParticipants?: () => void;
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

/** iPhone Safari не даёт Fullscreen API обычным элементам — только нативный
 *  плеер через нестандартный `webkitEnterFullscreen` у <video>. В lib.dom его
 *  нет, поэтому тип локальный, без any. */
type WebkitFullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Какой вид сейчас в .mcs-body — от него зависит, какой <video> висит на
 *  m.localVideoRef (см. эффект перепривязки srcObject ниже). */
type MobileCallView = 'solo' | 'grid' | 'focus-self' | 'focus-remote';

/** Мобильная сцена группового звонка (спека §6.2). Навигация (T7) и
 *  содержимое «⋯»-шторки (T6, `CallOverflowSheets`) живут снаружи — у
 *  двух вызывающих: `renderScreen.tsx`'s `CallScreen` (участник с аккаунтом)
 *  и `GuestMobileCallShell` (гость, спека §7); каждый также владеет `model` —
 *  `onOpenOverflow`/`onOpenQuality` здесь только переключают, какая шторка
 *  открыта, саму модель они больше не носят (Important I1,
 *  task-final-fix-report.md). */
export function MobileCallScreen({ model: m, onBack, onOpenChat, onOpenOverflow, onOpenQuality, chatUnreadCount, onOpenParticipants }: MobileCallScreenProps) {
  const t = useT();
  const audioOutput = useAudioOutput(m.applySinkId);
  const orientation = useOrientation();
  const pinch = usePinchZoom();
  // Фокус на СЕБЕ — чисто мобильное локальное состояние: модель знает только
  // focusedUserId удалённых участников (десктоп себя крупно не показывает), а
  // useCallStageModel общий с десктопом и не трогается. Действует, только
  // пока нет удалённого фокуса и есть кого показать в ленте (см. selfFocused).
  const [localFocused, setLocalFocused] = useState(false);
  const focusMainRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

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

  // Иконка кнопки «на весь экран» — по факту, а не по нажатию: браузер может
  // отклонить запрос или выйти сам (жест «назад», Esc, авто-эффект выше).
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Локальный фокус не должен переживать звонок (экран остаётся смонтирован и
  // просто рендерит null) или уход всех удалённых (соло-вид) — иначе он
  // «воскрес» бы в следующем звонке / при следующем входе участника.
  useEffect(() => {
    if (localFocused && (!m.isInGroupCall || m.participants.length === 0)) setLocalFocused(false);
  }, [localFocused, m.isInGroupCall, m.participants.length]);

  // Удалённый фокус, выставленный извне (баннер «Смотреть», стор), вытесняет
  // локальный. Только по ФРОНТУ появления/смены focusedUserId, а не по
  // «focusedUserId !== null»: тап по своей миниатюре из чужого фокуса ставит
  // localFocused раньше, чем модель успеет отдать focusedUserId === null, и
  // уровневое условие тут же сбросило бы только что выбранный фокус на себе.
  const prevFocusedUserId = useRef(m.focusedUserId);
  useEffect(() => {
    if (m.focusedUserId !== null && m.focusedUserId !== prevFocusedUserId.current) setLocalFocused(false);
    prevFocusedUserId.current = m.focusedUserId;
  }, [m.focusedUserId]);

  const selfFocused = localFocused && m.isInGroupCall && m.focusedUserId === null && m.participants.length > 0;
  const view: MobileCallView = m.focusedUserId
    ? 'focus-remote'
    : selfFocused
      ? 'focus-self'
      : m.participants.length === 0 ? 'solo' : 'grid';

  // m.localVideoRef — один ref на все виды, и при смене вида <video> под ним
  // пересоздаётся, а модель перепривязывает srcObject только по
  // [isInGroupCall, isScreenSharing, focusedUserId] — про локальный фокус и
  // переходы соло↔сетка она не знает, и новое видео оставалось бы чёрным.
  // Равенство проверяется, чтобы не перезапускать уже играющий поток.
  useEffect(() => {
    const el = m.localVideoRef.current;
    if (!el) return;
    const stream = m.isScreenSharing ? groupCallService.screenStreamState : groupCallService.localStreamState;
    if (stream && el.srcObject !== stream) el.srcObject = stream;
  }, [m.localVideoRef, m.isInGroupCall, m.isScreenSharing, view]);

  // То же для удалённых: при смене вида плитки пересоздаются, а эффект модели
  // перепривязывает их только по [participants, focusedUserId] — при переходе
  // сетка ↔ фокус на себе оба не меняются, и без этого собеседника не слышно
  // (звук идёт из этих <video>).
  useEffect(() => { m.reattachRemoteStreams(); }, [view]);

  if (!m.isInGroupCall) return null;

  const { columns, scroll } = mobileGridLayout(m.totalParticipants, orientation);
  const firstSharer = m.screenSharers.size > 0 ? [...m.screenSharers][0] : null;
  const showSharingBanner = firstSharer && !m.focusedUserId && !m.bannerDismissed;
  const selfName = `${m.user?.username ?? ''} ${t('call.youSuffix')}`;
  // Тот же расчёт, что и десктопная сцена (CallStage.tsx) — имя для оверлея
  // фокус-вида, в том числе когда у участника выключена камера (D6 — чинит
  // FIFTH FINDING task-9-verify-report.md).
  const focusedName = selfFocused ? selfName : m.focusedUserId ? m.nameFor(m.focusedUserId) : '';
  const localVideoClass = m.isScreenSharing ? 'is-screen' : 'is-mirrored';
  const localCameraOff = m.isVideoOff && !m.isScreenSharing;

  const focusSelf = () => {
    setLocalFocused(true);
    if (m.focusedUserId !== null) m.setFocusedUserId(null);
  };
  const focusRemote = (userId: string) => {
    setLocalFocused(false);
    m.setFocusedUserId(userId);
  };
  const backToGrid = () => {
    if (selfFocused) setLocalFocused(false);
    else m.setFocusedUserId(null);
  };

  // Кнопка «на весь экран» на главном видео фокус-вида. Запрос — из жеста
  // пользователя (авто-эффект выше браузеры часто отклоняют как не-жестовый) и
  // на .mcs-focus-main, а не на весь .mcs-focus: так кнопка и подпись остаются
  // внутри fullscreen-элемента и видимы. iPhone Fullscreen API для не-<video>
  // не имеет вовсе — там нативный плеер через webkitEnterFullscreen.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    const video = (selfFocused ? m.localVideoRef.current : m.focusedVideoRef.current) as WebkitFullscreenVideo | null;
    const enterNative = () => {
      if (!video?.webkitEnterFullscreen) return;
      // Нативный плеер iOS может поставить видео на паузу при выходе — живой
      // поток звонка возобновляем сами.
      try {
        video.webkitEnterFullscreen();
      } catch {
        return; // нет метаданных (поток ещё привязывается) — повторный тап сработает
      }
      video.addEventListener('webkitendfullscreen', () => { video.play().catch(() => {}); }, { once: true });
    };
    const main = focusMainRef.current;
    if (main && typeof main.requestFullscreen === 'function') {
      main.requestFullscreen().catch(enterNative);
      return;
    }
    enterNative();
  };

  const remoteTile = (p: (typeof m.participants)[number], layout: 'grid' | 'thumbnail') => (
    <RemoteParticipantTile
      key={p.userId}
      participant={p}
      displayName={m.nameFor(p.userId)}
      muted={m.remoteMicMuted.get(p.userId) ?? false}
      isSharing={m.screenSharers.has(p.userId)}
      layout={layout}
      isFocused={layout === 'thumbnail' ? m.focusedUserId === p.userId : undefined}
      onFocus={() => focusRemote(p.userId)}
      videoRefSetter={(el) => m.setRemoteVideoRef(p.userId, el)}
      volume={m.participantVolumes[p.userId] ?? 100}
      isVolumePopoverOpen={false}
      onToggleVolumePopover={() => {}}
      onCloseVolumePopover={() => {}}
      onVolumeChange={(v) => m.onVolumeChange(p.userId, v)}
      quality={m.qualityByUser[p.userId]}
    />
  );

  return (
    <div className="mobile-call-screen">
      <div className="mcs-topbar">
        {onBack && (
          <button type="button" className="mcs-collapse-btn" onClick={onBack} aria-label={t('call.collapseCall')}>
            <ChevronDown size={22} strokeWidth={1.8} />
          </button>
        )}
        <div className="mcs-title">
          <span className="mcs-title-name">{m.callChannelName ? `#${m.callChannelName}` : t('call.groupCallTitle')}</span>
          <span className="mcs-title-timer"><StageTimer /></span>
        </div>
        {onOpenParticipants && (
          <button
            type="button"
            className="mcs-participants-btn"
            onClick={() => onOpenParticipants()}
            aria-label={t('guest.participants')}
          >
            <Users size={18} strokeWidth={1.8} />
          </button>
        )}
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
        {view === 'focus-remote' || view === 'focus-self' ? (
          /* Фокус: главное видео + горизонтальная лента миниатюр внизу — та же
             структура, что и десктопная `.stage-focus`/`.stage-focus-main`/
             `.stage-thumbs` (CallStage.tsx). Без ленты плитки остальных
             участников размонтировались (setRemoteVideoRef(id, null)), а
             <video> — единственное место, откуда у немейн-фокусного
             участника вообще звучит аудио (см. комментарий "audio comes from
             the thumbnail element for camera focus" в useCallStageModel.ts) —
             весь звонок замолкал при фокусе (Critical C1,
             task-final-fix-report.md). В фокусе на себе лента — все
             удалённые участники, по той же причине. */
          <div className="mcs-focus">
            <div
              ref={focusMainRef}
              className="mcs-focus-main"
              style={pinch.state.scale > 1 ? { touchAction: 'none' } : undefined}
              {...pinch.handlers}
              onDoubleClick={pinch.reset}
            >
              {/* Разные key: главное видео своего и чужого фокуса — разные
                  элементы на разных рефах (m.localVideoRef/m.focusedVideoRef),
                  иначе React переиспользовал бы один <video> с чужим
                  srcObject под другим рефом. */}
              {view === 'focus-self' ? (
                <video
                  key="self"
                  ref={m.localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`mcs-focus-video ${localVideoClass}`}
                  style={{ transform: `translate(${pinch.state.x}px, ${pinch.state.y}px) scale(${pinch.state.scale})${m.isScreenSharing ? '' : ' scaleX(-1)'}` }}
                  onClick={pinch.state.scale === 1 ? backToGrid : undefined}
                />
              ) : (
                <video
                  key="remote"
                  ref={m.focusedVideoRef}
                  autoPlay
                  playsInline
                  className="mcs-focus-video"
                  style={{ transform: `translate(${pinch.state.x}px, ${pinch.state.y}px) scale(${pinch.state.scale})` }}
                  // Повторный тап возвращает в сетку (спека §6.2), но только
                  // пока не зумлено — иначе однократный тап конфликтовал бы с
                  // жестом двойного тапа для сброса зума на этом же элементе
                  // (Minor M4, task-final-fix-report.md).
                  onClick={pinch.state.scale === 1 ? backToGrid : undefined}
                />
              )}
              {view === 'focus-self' && localCameraOff && (
                <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="mcs-focus-avatar" />
              )}
              <div className="mcs-focus-label">
                <span className="mcs-focus-name">{focusedName}</span>
              </div>
              <button type="button" className="mcs-focus-back" onClick={backToGrid} title={t('call.backToGrid')} aria-label={t('call.backToGrid')}>
                <LayoutGrid size={16} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="mcs-focus-fs"
                onClick={toggleFullscreen}
                title={isFullscreen ? t('mobile.callExitFullscreen') : t('call.fullscreen')}
                aria-label={isFullscreen ? t('mobile.callExitFullscreen') : t('call.fullscreen')}
              >
                {isFullscreen ? <Minimize size={18} strokeWidth={1.8} /> : <Maximize size={18} strokeWidth={1.8} />}
              </button>
            </div>

            <div className="mcs-focus-thumbs">
              {/* Локальная миниатюра — тот же `.stage-thumb`, что и у
                  удалённых участников ниже, для визуальной консистентности
                  ленты (десктопный `.stage-thumbs` смешивает их так же). В
                  фокусе на себе её нет — «я» уже на главном видео. */}
              {view === 'focus-remote' && (
                <div
                  className={`stage-thumb${m.micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                  style={{ '--speak-level': Math.min(1, m.micLevel) } as React.CSSProperties}
                  title={selfName}
                  onClick={focusSelf}
                >
                  <video
                    ref={m.localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={localVideoClass}
                  />
                  {localCameraOff && (
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
              )}

              {m.participants.map((p) => remoteTile(p, 'thumbnail'))}
            </div>
          </div>
        ) : view === 'solo' ? (
          /* Соло — только себя (спека §6.2: «1 → весь экран»), во весь
             .mcs-body (Blocker THIRD FINDING, task-9-verify-report.md). */
          <div className="mcs-solo">
            <video ref={m.localVideoRef} autoPlay playsInline muted className={localVideoClass} />
            {localCameraOff && (
              <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="mcs-solo-avatar" />
            )}
          </div>
        ) : (
          /* Сетка: экран поровну на ВСЕХ, включая себя — своя плитка обычная
             ячейка (первой), а не плавающий PiP поверх удалённых: число ячеек
             = m.totalParticipants, ровно то, от чего считает mobileGridLayout.
             Каждая ячейка — .mcs-grid-cell: тап по ней открывает фокус на этом
             участнике. Обёртка, а не onClick на самой плитке, — потому что
             RemoteParticipantTile общий с десктопной сценой и клика по корню
             там нет (кнопки громкости/«Смотреть» внутри гасят всплытие сами). */
          <div
            className={`mcs-grid mcs-grid-cols-${columns}${scroll ? ' is-scroll' : ''}`}
          >
            <div className="mcs-grid-cell is-self" onClick={focusSelf}>
              {/* Визуально — та же локальная плитка, что и в десктопной сетке
                  (CallStage.tsx): подпись «имя (вы)», мик/эквалайзер, чип
                  «камера выкл.», кольцо говорения. */}
              <div
                className={`stage-tile${localCameraOff ? ' is-camera-off' : ''}${m.micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                style={{ '--speak-level': Math.min(1, m.micLevel) } as React.CSSProperties}
              >
                <video
                  ref={m.localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`stage-tile-video ${localVideoClass}`}
                />
                {localCameraOff && (
                  <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="stage-tile-avatar" />
                )}
                {m.isScreenSharing && (
                  <div className="stage-share-badge">
                    <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
                  </div>
                )}
                <button type="button" className="stage-focus-btn" onClick={focusSelf} title={t('call.focusParticipant')} aria-label={t('call.focusParticipant')}>
                  <Expand size={14} strokeWidth={1.8} />
                </button>
                <div className="stage-tile-footer">
                  <div className="stage-plate">
                    {m.isMuted
                      ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
                      : m.micLevel > SPEAKING_THRESHOLD
                        ? <span className="stage-eq"><span /><span /><span /></span>
                        : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
                    <span className="stage-name">{selfName}</span>
                  </div>
                  {localCameraOff && (
                    <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
                  )}
                </div>
                <ConnectionIndicator metrics={m.localQuality} />
              </div>
            </div>
            {m.participants.map((p) => (
              <div key={p.userId} className="mcs-grid-cell" onClick={() => focusRemote(p.userId)}>
                {remoteTile(p, 'grid')}
              </div>
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
        <button type="button" className="mcs-panel-btn mcs-panel-btn-chat" onClick={onOpenChat} aria-label={t('mobile.callOpenChat')}>
          <MessageSquare size={22} strokeWidth={1.8} />
          {Boolean(chatUnreadCount) && <span className="mcs-chat-badge">{chatUnreadCount! > 99 ? '99+' : chatUnreadCount}</span>}
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
