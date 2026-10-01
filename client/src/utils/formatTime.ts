/** m:ss для плееров чата. Не-конечное (NaN у jsdom, Infinity у WebM) — 0:00. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
