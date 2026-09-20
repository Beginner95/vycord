import { describe, it, expect } from 'vitest';
import { voiceLineParts } from '@/mobile/voiceLine';

const nameOf = (id: string) => ({ u1: 'Аня', u2: 'Борис', u3: 'Вера', u4: 'Глеб' }[id] ?? id.slice(0, 8));

describe('voiceLineParts', () => {
  it('returns null when nobody is in voice', () => {
    expect(voiceLineParts([], nameOf)).toBeNull();
  });

  it('keeps a single name without a remainder', () => {
    expect(voiceLineParts(['u1'], nameOf)).toEqual({ names: ['Аня'], extra: 0 });
  });

  it('keeps two names without a remainder', () => {
    expect(voiceLineParts(['u1', 'u2'], nameOf)).toEqual({ names: ['Аня', 'Борис'], extra: 0 });
  });

  it('counts everyone past the limit', () => {
    expect(voiceLineParts(['u1', 'u2', 'u3', 'u4'], nameOf)).toEqual({ names: ['Аня', 'Борис'], extra: 2 });
  });

  it('honours a custom limit', () => {
    expect(voiceLineParts(['u1', 'u2', 'u3'], nameOf, 1)).toEqual({ names: ['Аня'], extra: 2 });
  });

  it('falls back to a short id for an unknown user, like the desktop sidebar', () => {
    expect(voiceLineParts(['deadbeef-1111'], nameOf)).toEqual({ names: ['deadbeef'], extra: 0 });
  });
});
