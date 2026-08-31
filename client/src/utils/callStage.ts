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
