// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMobileNav, latestStack } from '@/mobile/nav/useMobileNav';

afterEach(cleanup);

const wrap = (state?: unknown) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state }]}>{children}</MemoryRouter>
);

describe('useMobileNav', () => {
  it('without state: fallback root, invalid', () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap() });
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
    expect(result.current.valid).toBe(false);
  });

  it('push then back walks history', async () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.push({ kind: 'channels', serverId: 's1' }));
    expect(result.current.top).toEqual({ kind: 'channels', serverId: 's1' });
    expect(latestStack()).toEqual(result.current.stack);
    await act(async () => { result.current.back(); });
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
  });

  it('back at b=0 never leaves the app: pops by replace', () => {
    const deep = { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }], b: 0 };
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap(deep) });
    act(() => result.current.back());
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
  });

  it('pushMany pushes each screen as its own history entry', async () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.pushMany([{ kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }]));
    expect(result.current.stack).toHaveLength(3);
    await act(async () => { result.current.back(); });
    expect(result.current.top).toEqual({ kind: 'channels', serverId: 's1' });
  });

  it('switchTab replaces with the tab root', () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => result.current.switchTab('friends'));
    expect(result.current.stack).toEqual([{ kind: 'friends' }]);
    expect(result.current.tab).toBe('friends');
  });

  it('switchTab from a deep stack cannot walk out of the app', async () => {
    const deep = { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }], b: 2 };
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap(deep) });
    act(() => result.current.switchTab('friends'));
    expect(result.current.stack).toEqual([{ kind: 'friends' }]);
    await act(async () => { result.current.back(); });
    // на корне вкладки идти назад некуда — стек остаётся корнем
    expect(result.current.stack).toEqual([{ kind: 'friends' }]);
  });

  it('two bare pushes in one tick keep depth in step with the stack', async () => {
    const { result } = renderHook(() => useMobileNav(), { wrapper: wrap({ m: [{ kind: 'servers' }], b: 0 }) });
    act(() => {
      result.current.push({ kind: 'channels', serverId: 's1' });
      result.current.push({ kind: 'chat', channelId: 'c1' });
    });
    expect(result.current.stack).toHaveLength(3);
    await act(async () => { result.current.back(); });
    expect(result.current.top).toEqual({ kind: 'channels', serverId: 's1' });
    await act(async () => { result.current.back(); });
    expect(result.current.stack).toEqual([{ kind: 'servers' }]);
  });
});
