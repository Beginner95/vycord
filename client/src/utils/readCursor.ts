/**
 * VYC-104: позиция в ленте канала — пара (created_at, id), ровно как на сервере.
 * Курсор с id === null (сид миграции, фолбэк на момент вступления) покрывает
 * своё время целиком.
 */
export interface CursorPos {
  at: string;
  id: string | null;
}

const ISO_RE = /^(.*?T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * ISO-8601 → микросекунды эпохи. Date.parse режет до миллисекунд, а сервер
 * хранит микросекунды: без них два сообщения одной миллисекунды и курсор
 * между ними были бы неразличимы. 1.7e15 мкс — далеко от 2^53.
 */
export function toMicros(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) return Date.parse(iso) * 1000;
  const whole = Date.parse(m[1] + m[3]);
  const frac = (m[2] ?? '').padEnd(6, '0').slice(0, 6);
  return whole * 1000 + Number(frac);
}

/** <0 — a раньше b, 0 — та же позиция, >0 — позже. uuid сравниваются строкой:
 *  для строчных hex с дефисами на одних местах это тот же порядок, что у
 *  Postgres. */
export function comparePos(a: CursorPos, b: CursorPos): number {
  const d = toMicros(a.at) - toMicros(b.at);
  if (d !== 0) return d;
  if (a.id === b.id) return 0;
  if (a.id === null) return 1;
  if (b.id === null) return -1;
  return a.id < b.id ? -1 : 1;
}

export function msgPos(m: { created_at: string; id: string }): CursorPos {
  return { at: m.created_at, id: m.id };
}

/** Позиция за курсором, то есть не прочитана. Нет курсора — ничего не считаем. */
export function isAfter(pos: CursorPos, cursor: CursorPos | null | undefined): boolean {
  return !!cursor && comparePos(pos, cursor) > 0;
}
