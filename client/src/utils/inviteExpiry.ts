export type InviteExpiry = { kind: 'never' } | { kind: 'days'; days: number };

// Текст «Ссылка живёт N дн.» в инвайт-карточке — всегда вычисляется из
// expires_at сервера, никогда не захардкожен (spec §5 M1).
export function inviteExpiry(expiresAt: string | undefined, now: Date = new Date()): InviteExpiry {
  if (!expiresAt) return { kind: 'never' };
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return { kind: 'never' };
  const days = Math.ceil((ts - now.getTime()) / 86_400_000);
  return { kind: 'days', days: Math.max(days, 1) };
}
