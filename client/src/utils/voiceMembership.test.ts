import { describe, it, expect } from 'vitest';
import { voiceChannelNameFor } from './voiceMembership';
import type { Channel } from '@/types';

const ch = (id: string, name: string): Channel => ({
  id,
  server_id: 's1',
  name,
  position: 0,
  created_at: '',
  updated_at: '',
});

describe('voiceChannelNameFor', () => {
  const channels = [ch('c1', 'Общий'), ch('c2', 'Игры')];

  it('returns the channel name the user is in', () => {
    const vp = new Map([['c2', ['u1', 'u2']]]);
    expect(voiceChannelNameFor('u2', vp, channels)).toBe('Игры');
  });

  it('returns null when the user is in no voice channel', () => {
    const vp = new Map([['c1', ['u1']]]);
    expect(voiceChannelNameFor('u9', vp, channels)).toBeNull();
  });

  it('returns null for an unknown channel id (stale WS state)', () => {
    const vp = new Map([['gone', ['u1']]]);
    expect(voiceChannelNameFor('u1', vp, channels)).toBeNull();
  });

  it('returns null when the map is undefined or empty', () => {
    expect(voiceChannelNameFor('u1', undefined, channels)).toBeNull();
    expect(voiceChannelNameFor('u1', new Map(), channels)).toBeNull();
  });
});
