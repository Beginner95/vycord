import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
const gc = vi.hoisted(() => ({ isInGroupCallState: false }));
vi.mock('@/services/groupCall', () => ({ groupCallService: gc }));

import { isBusyWithCall } from '../UpdateBanner';
import { useDirectCallStore, type DirectCallPhase } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('UpdateBanner: занятость звонком', () => {
  beforeEach(() => {
    gc.isInGroupCallState = false;
    useDirectCallStore.setState({ phase: { kind: 'idle' } });
  });

  it('свободен без звонков', () => {
    expect(isBusyWithCall()).toBe(false);
  });

  it('канальный/комнатный звонок — занят', () => {
    gc.isInGroupCallState = true;
    expect(isBusyWithCall()).toBe(true);
  });

  it.each<DirectCallPhase>([
    { kind: 'outgoing', callId: null, peer: bob },
    { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false },
    { kind: 'connecting', callId: 'c', peer: bob },
    { kind: 'active', callId: 'c', peer: bob },
  ])('фаза 1:1 $kind — занят, даже без комнаты', (phase) => {
    useDirectCallStore.setState({ phase });
    expect(isBusyWithCall()).toBe(true);
  });

  it('ending — не занят', () => {
    useDirectCallStore.setState({ phase: { kind: 'ending', peer: bob, reason: 'ended' } });
    expect(isBusyWithCall()).toBe(false);
  });
});
