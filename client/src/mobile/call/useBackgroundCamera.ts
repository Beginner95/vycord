import { useEffect } from 'react';
import { useCallStore } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import { t } from '@/i18n';

/** Задержка hidden → выключение камеры: быстрые переключения (шторка
 *  уведомлений, системный диалог) не должны плодить stop/getUserMedia-циклы. */
export const BACKGROUND_CAMERA_DEBOUNCE_MS = 400;

const isHidden = (): boolean => document.visibilityState === 'hidden';

function inCall(): boolean {
  return useCallStore.getState().status !== 'idle';
}

function screenSharing(): boolean {
  return useCallStore.getState().isScreenSharing || groupCallService.isScreenSharing;
}

function localCameraTrack(): MediaStreamTrack | null {
  return groupCallService.localStreamState?.getVideoTracks()[0] ?? null;
}

/** Тот же путь, что кнопка «камера» (useCallStageModel.handleToggleVideo). */
function toggleCameraLikeButton(): void {
  useCallStore.setState({ isVideoOff: groupCallService.toggleMuteVideo() });
}

/** Трек камеры сменился внутри MediaStream — Safari/старые Chrome не всегда
 *  перерисовывают <video> с этим srcObject; переприсваиваем явно. А если пока
 *  камера поднималась, пересборка микрофона заменила localStream целиком,
 *  превью ещё держит прежний поток (с мёртвым треком камеры): `previous` —
 *  известные нам прежние локальные потоки, их элементы переводим на текущий. */
export function refreshLocalPreviews(previous: Iterable<MediaStream | null> = []): void {
  const stream = groupCallService.localStreamState;
  if (!stream) return;
  const targets = new Set<MediaStream | null>(previous);
  targets.add(stream);
  targets.delete(null);
  document.querySelectorAll('video').forEach((el) => {
    if (!el.srcObject || !targets.has(el.srcObject as MediaStream)) return;
    el.srcObject = null;
    el.srcObject = stream;
    const played = el.play?.();
    if (played && typeof played.catch === 'function') played.catch(() => {});
  });
}

function reportResumeFailure(err: unknown): void {
  console.warn('[GC] camera resume after background failed:', err);
  // Тот же тост, что «вошли без камеры/микрофона»: useCallStageModel
  // показывает mediaWarning как stageError экрана звонка.
  useCallStore.setState({ mediaWarning: t('call.cameraResumeFailed') });
}

/**
 * VYC-96, только мобильная оболочка: при сворачивании приложения мобильный
 * браузер останавливает захват камеры, и у собеседников замирает последний
 * кадр. Поэтому на `hidden` (с дебаунсом) камера выключается тем же путём,
 * что кнопкой, а устройство освобождается (groupCallService.
 * releaseCameraForBackground: трек остановлен, на отправителе чёрный кадр);
 * на `visible` — включается обратно, если до сворачивания была включена
 * (трек пересоздаётся getUserMedia, если браузер/мы его завершили).
 *
 * Не трогает: демонстрацию экрана, камеру, выключенную пользователем, звонок,
 * закончившийся в фоне. Ошибка повторного включения звонок не роняет —
 * камера остаётся выключенной, показывается тост.
 *
 * `enabled` — идёт групповой звонок (монтирующий компонент решает сам).
 */
export function useBackgroundCamera(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    /** Камеру выключили МЫ при сворачивании — вернуть её на visible. */
    let resumeCamera = false;
    /** Наш собственный setState({isVideoOff}) — не путать с ручным. */
    let selfUpdate = false;
    let resuming = false;
    let disposed = false;
    /** Локальные потоки, которые могли оказаться в превью до пересборки
     *  микрофона (см. refreshLocalPreviews). */
    const knownLocal = new Set<MediaStream | null>();
    const rememberLocal = () => knownLocal.add(groupCallService.localStreamState);

    const setSelf = (fn: () => void) => {
      selfUpdate = true;
      try { fn(); } finally { selfUpdate = false; }
    };

    const clearHideTimer = () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const suspend = () => {
      hideTimer = null;
      if (disposed || !isHidden() || !inCall() || resumeCamera) return;
      if (useCallStore.getState().isVideoOff || screenSharing()) return;
      const cam = localCameraTrack();
      // Стор говорит «вкл», а трек выключен/отсутствует — toggle включил бы его.
      if (!cam || !cam.enabled) return;
      knownLocal.clear();
      rememberLocal();
      setSelf(toggleCameraLikeButton);
      if (!useCallStore.getState().isVideoOff) return; // toggle не выключил — не наш случай
      resumeCamera = true;
      void groupCallService.releaseCameraForBackground().catch((err: unknown) => {
        console.warn('[GC] camera release for background failed:', err);
      });
    };

    const resume = async () => {
      resumeCamera = false;
      if (!inCall() || screenSharing() || !useCallStore.getState().isVideoOff) return;
      resuming = true;
      rememberLocal();
      try {
        const ok = await groupCallService.reacquireCameraAfterBackground();
        if (disposed || !ok || !inCall() || screenSharing()) return;
        if (!useCallStore.getState().isVideoOff) {
          // Кнопкой включили во время getUserMedia: toggle включил старый
          // (мёртвый) трек, а свежий пришёл выключенным — включаем его.
          const cam = localCameraTrack();
          if (cam && !cam.enabled) cam.enabled = true;
          refreshLocalPreviews(knownLocal);
          return;
        }
        if (isHidden()) {
          // Снова свернули, пока камера поднималась: она ещё «выкл» в сторе —
          // сразу освобождаем свежий трек и вернём её на следующем visible.
          resumeCamera = true;
          void groupCallService.releaseCameraForBackground().catch(() => {});
          return;
        }
        setSelf(toggleCameraLikeButton);
        refreshLocalPreviews(knownLocal);
      } catch (err) {
        if (!disposed && inCall()) reportResumeFailure(err);
      } finally {
        resuming = false;
      }
    };

    const onVisibility = () => {
      if (disposed) return;
      if (isHidden()) {
        if (hideTimer !== null || resuming) return;
        hideTimer = setTimeout(suspend, BACKGROUND_CAMERA_DEBOUNCE_MS);
        return;
      }
      // visible (или pageshow)
      if (hideTimer !== null) {
        clearHideTimer(); // вернулись раньше дебаунса — ничего не трогали
        return;
      }
      if (resumeCamera && !resuming) void resume();
    };

    const unsubscribe = useCallStore.subscribe((s, prev) => {
      if (disposed) return;
      if (s.status === 'idle') {
        // Звонок закончился (в т.ч. в фоне) — нечего возвращать.
        resumeCamera = false;
        clearHideTimer();
        return;
      }
      if (selfUpdate || s.isVideoOff === prev.isVideoOff) return;
      // Ручное изменение камеры пользователем — наше намерение отменяется.
      resumeCamera = false;
      if (!s.isVideoOff && !isHidden() && !resuming) {
        // Кнопкой включили камеру, чей трек мы (или браузер) завершили:
        // toggle включил мёртвый трек — пересоздаём.
        const cam = localCameraTrack();
        if (cam && cam.readyState === 'ended') void recoverManualEnable();
      }
    });

    const recoverManualEnable = async () => {
      resuming = true;
      rememberLocal();
      try {
        const ok = await groupCallService.reacquireCameraAfterBackground();
        if (disposed || !ok || !inCall()) return;
        const cam = localCameraTrack();
        if (!useCallStore.getState().isVideoOff && cam && !cam.enabled) cam.enabled = true;
        refreshLocalPreviews(knownLocal);
      } catch (err) {
        if (disposed || !inCall()) return;
        // Кнопка показывает «вкл», но камеры нет — вернуть честное «выкл».
        if (!useCallStore.getState().isVideoOff) setSelf(toggleCameraLikeButton);
        reportResumeFailure(err);
      } finally {
        resuming = false;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    return () => {
      disposed = true;
      clearHideTimer();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, [enabled]);
}
