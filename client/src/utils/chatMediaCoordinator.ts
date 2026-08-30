let current: HTMLMediaElement | null = null;

/**
 * Одновременно в чате должен играть только один audio/video: старт второго
 * должен остановить первый. Область действия — только AudioPlayer/VideoPlayer
 * вложений чата, они сами вызывают notifyPlaying на своих элементах; звонки
 * (CallUI/CallStage) этот модуль не используют и не задеваются.
 */
export function notifyPlaying(el: HTMLMediaElement): void {
  if (current && current !== el && !current.paused) {
    current.pause();
  }
  current = el;
}
