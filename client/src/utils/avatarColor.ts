// Deterministic username → color mapping (design handoff, option 2b).
// SINGLE SOURCE OF TRUTH for the 8-color avatar palette (M1 decision:
// the former --avatar-1..8 tokens were unconsumed and deleted).
export const AVATAR_COLORS = [
  '#4F46E5',
  '#E8590C',
  '#0F766E',
  '#B4145A',
  '#1D4ED8',
  '#7C3AED',
  '#0E7490',
  '#A16207',
] as const;

export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
