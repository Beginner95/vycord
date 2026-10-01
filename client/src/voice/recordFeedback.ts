import { audioService } from '@/services/audio';
import { logger } from '@/utils/logger';

/**
 * Отклик записи голосового: человек должен чувствовать, что запись пошла
 * и что она закончилась. Вибрация — где есть Vibration API (Android);
 * на iOS и десктопе её нет, там остаётся звук.
 */
export type RecordFeedback = 'start' | 'send' | 'cancel' | 'lock';
export type RecordSound = Exclude<RecordFeedback, 'lock'>;

const VIBRATION: Record<RecordFeedback, number | number[]> = {
  start: 40,
  send: 20,
  cancel: [20, 60, 20],
  lock: 15,
};

interface Deps {
  vibrate?: (pattern: number | number[]) => boolean;
  sound(kind: RecordSound): void;
}

const defaultDeps = (): Deps => ({
  vibrate: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    ? (p) => navigator.vibrate(p)
    : undefined,
  sound: (kind) => audioService.playVoiceRecord(kind),
});

export function recordFeedback(kind: RecordFeedback, deps: Deps = defaultDeps()): void {
  try {
    deps.vibrate?.(VIBRATION[kind]);
    // Закрепление — тихое: звук между стартом и концом записи попал бы в неё.
    if (kind !== 'lock') deps.sound(kind);
  } catch (err) {
    // Отклик — косметика, запись от него не зависит.
    logger.error('Voice record feedback failed', err, { module: 'chat' });
  }
}
