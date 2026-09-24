import { describe, it, expect } from 'vitest';
import { reconcile, type NavSnapshot } from '@/mobile/nav/reconcile';
import type { Stack } from '@/mobile/nav/types';

const snap = (over: Partial<NavSnapshot> = {}): NavSnapshot => ({
  serversLoaded: true,
  serverIds: new Set(['s1', 's2']),
  currentServerId: 's1',
  channels: [{ id: 'c1', server_id: 's1' }, { id: 'c2', server_id: 's1' }],
  currentChannelId: 'c1',
  callActive: false,
  ...over,
});
const S = { kind: 'servers' } as const;
const ch = (serverId: string) => ({ kind: 'channels', serverId } as const);
const chat = (channelId: string) => ({ kind: 'chat', channelId } as const);

describe('reconcile', () => {
  it('valid, in-sync stack is returned by reference with no action', () => {
    const stack: Stack = [S, ch('s1'), chat('c1')];
    const r = reconcile(stack, snap());
    expect(r.stack).toBe(stack);
    expect(r.action).toBeNull();
  });

  it('asks to select the server of the deepest server screen', () => {
    expect(reconcile([S, ch('s2')], snap()).action).toEqual({ type: 'selectServer', serverId: 's2' });
  });

  it('does not select anything before servers are loaded', () => {
    const r = reconcile([S, ch('s9')], snap({ serversLoaded: false, serverIds: new Set() }));
    expect(r.stack).toHaveLength(2);
    expect(r.action).toBeNull();
  });

  it('truncates at a server that no longer exists', () => {
    expect(reconcile([S, ch('gone'), chat('c1')], snap()).stack).toEqual([S]);
  });

  it('asks to select the channel of the top chat screen', () => {
    expect(reconcile([S, ch('s1'), chat('c2')], snap()).action).toEqual({ type: 'selectChannel', channelId: 'c2' });
  });

  it('server selection comes before channel selection', () => {
    expect(reconcile([S, ch('s2'), chat('x')], snap()).action).toEqual({ type: 'selectServer', serverId: 's2' });
  });

  it('waits while channels of the current server are still loading', () => {
    const r = reconcile([S, ch('s1'), chat('c7')], snap({ channels: [{ id: 'z', server_id: 's2' }] }));
    expect(r.stack).toHaveLength(3);
    expect(r.action).toBeNull();
  });

  it('truncates at a deleted channel once channels are loaded', () => {
    expect(reconcile([S, ch('s1'), chat('c7')], snap()).stack).toEqual([S, ch('s1')]);
  });

  it('a chat screen with no server screen below is invalid', () => {
    expect(reconcile([S, chat('c1')], snap()).stack).toEqual([S]);
  });

  it('drops the call screen when no call is active, keeps it otherwise', () => {
    const stack: Stack = [S, ch('s1'), chat('c1'), { kind: 'call' }];
    expect(reconcile(stack, snap()).stack).toEqual([S, ch('s1'), chat('c1')]);
    expect(reconcile(stack, snap({ callActive: true })).stack).toBe(stack);
  });

  it('channelInfo is channel-scoped like chat', () => {
    expect(reconcile([S, ch('s1'), chat('c1'), { kind: 'channelInfo', channelId: 'c7' }], snap()).stack)
      .toEqual([S, ch('s1'), chat('c1')]);
  });
});
