/** Board 1e top bar: "В ЭФИРЕ 12:04". mm:ss, rolling to h:mm:ss past an hour. */
export function formatCallDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Board 1e grid: 1 column ≤1 participant, 2 columns ≤4, 3 beyond. */
export function stageGridClass(total: number): '' | 'is-solo' | 'is-many' {
  if (total <= 1) return 'is-solo';
  if (total <= 4) return '';
  return 'is-many';
}

/** The existing speaking threshold (was inline `level > 0.05` in CallStage/CallUI). */
export const SPEAKING_THRESHOLD = 0.05;

export interface MobileGridLayout {
  columns: number;
  scroll: boolean;
}

/** Board §6.2: 1 → весь экран; 2 → вертикально (портрет) / горизонтально
 *  (пейзаж); 3–4 → 2×2; ≥5 → 2 колонки с прокруткой. */
export function mobileGridLayout(count: number, orientation: 'portrait' | 'landscape'): MobileGridLayout {
  const n = Math.max(1, count);
  if (n <= 1) return { columns: 1, scroll: false };
  if (n === 2) return { columns: orientation === 'landscape' ? 2 : 1, scroll: false };
  if (n <= 4) return { columns: 2, scroll: false };
  return { columns: 2, scroll: true };
}
