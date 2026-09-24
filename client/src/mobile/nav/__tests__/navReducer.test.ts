import { describe, it, expect } from 'vitest';
import { TAB_ROOT, tabOf, isRoot, push, pop, stripSheets, isStack } from '@/mobile/nav/navReducer';
import type { Stack } from '@/mobile/nav/types';

const root: Stack = [{ kind: 'servers' }];

describe('navReducer', () => {
  it('tab roots', () => {
    expect(TAB_ROOT.servers).toEqual({ kind: 'servers' });
    expect(TAB_ROOT.friends).toEqual({ kind: 'friends' });
    expect(TAB_ROOT.profile).toEqual({ kind: 'profile' });
  });

  it('push appends and never mutates', () => {
    const next = push(root, { kind: 'channels', serverId: 's1' });
    expect(next).toEqual([{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }]);
    expect(root).toHaveLength(1);
  });

  it('push over a sheet replaces the sheet entry', () => {
    const withSheet = push(root, { kind: 'sheet', id: 'a' });
    expect(push(withSheet, { kind: 'createServer' })).toEqual([{ kind: 'servers' }, { kind: 'createServer' }]);
  });

  it('pop never goes below the root', () => {
    expect(pop(push(root, { kind: 'call' }))).toEqual(root);
    expect(pop(root)).toEqual(root);
  });

  it('tabOf / isRoot', () => {
    expect(tabOf([{ kind: 'friends' }])).toBe('friends');
    expect(tabOf([{ kind: 'profile' }, { kind: 'settings', section: 'audio' }])).toBe('profile');
    expect(tabOf([{ kind: 'guestCall' }])).toBe('servers');
    expect(isRoot(root)).toBe(true);
    expect(isRoot(push(root, { kind: 'call' }))).toBe(false);
  });

  it('stripSheets drops only sheet entries', () => {
    const s: Stack = [{ kind: 'servers' }, { kind: 'sheet', id: 'x' }, { kind: 'channels', serverId: 'a' }, { kind: 'sheet', id: 'y' }];
    expect(stripSheets(s)).toEqual([{ kind: 'servers' }, { kind: 'channels', serverId: 'a' }]);
  });

  it('isStack validates history.state payloads', () => {
    expect(isStack(root)).toBe(true);
    expect(isStack([{ kind: 'guestCall' }, { kind: 'guestChat' }])).toBe(true);
    expect(isStack(undefined)).toBe(false);
    expect(isStack([])).toBe(false);
    expect(isStack([{ kind: 'nope' }])).toBe(false);
    expect(isStack([{ kind: 'channels', serverId: 's' }])).toBe(false); // корень обязан быть корнем
    expect(isStack([{ kind: 'servers' }, { kind: 'chat' }])).toBe(false); // нет channelId
  });

  it('isStack rejects prototype-chain kinds instead of throwing', () => {
    for (const kind of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(isStack([{ kind }])).toBe(false);
      expect(isStack([{ kind: 'servers' }, { kind }])).toBe(false);
    }
  });
});
