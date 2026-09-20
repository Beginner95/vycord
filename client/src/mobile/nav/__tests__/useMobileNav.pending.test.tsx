// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useMobileNav, latestStack, PENDING_NAV_TTL_MS } from '@/mobile/nav/useMobileNav';
import type { Stack } from '@/mobile/nav/types';

// Роутер подменён: navigate() — шпион, который ничего не применяет, а
// location мы двигаем вручную. Так моделируется момент «навигация уже
// вызвана, но роутер ещё не закоммитил её» (startTransition).
const loc = { pathname: '/app', search: '', key: 'k0', state: undefined as unknown };
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useLocation: () => loc,
  useNavigate: () => navigate,
}));

const SERVERS = { kind: 'servers' } as const;
const CREATE = { kind: 'createServer' } as const;
const FRIENDS = { kind: 'friends' } as const;
const CHANNELS = { kind: 'channels', serverId: 's1' } as const;
const CHAT = { kind: 'chat', channelId: 'c1' } as const;

let seq = 0;
const setLoc = (m: Stack, b = 0, key = `k${++seq}`) => {
  loc.key = key;
  loc.state = { m, b };
};

beforeEach(() => {
  vi.useFakeTimers();
  navigate.mockClear();
  // Новый уникальный ключ сбрасывает pending, оставшийся от прошлого теста.
  setLoc([SERVERS]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useMobileNav pending navigation', () => {
  it('keeps the pushed stack while a render still sees the old location.key', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.push(CREATE);
    expect(latestStack()).toEqual([SERVERS, CREATE]);
    rerender(); // роутер ещё не применил push: тот же key, старый state
    expect(latestStack()).toEqual([SERVERS, CREATE]);
    expect(result.current.stack).toEqual([SERVERS]); // сам рендер остаётся честным
  });

  it('adopts the rendered state once a render sees a different key', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.push(CREATE);
    setLoc([SERVERS, CREATE], 1); // навигация закоммичена
    rerender();
    expect(latestStack()).toEqual([SERVERS, CREATE]);
    // pending снят: дальше latest снова следует за location
    setLoc([FRIENDS], 0, loc.key); // тот же key, но другой state — pending уже нет
    rerender();
    expect(latestStack()).toEqual([FRIENDS]);
  });

  it('adopts a foreign navigation (different key, different stack) instead of the pushed one', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.push(CREATE);
    setLoc([FRIENDS]); // пользователь ушёл сам, наш push так и не применился
    rerender();
    expect(latestStack()).toEqual([FRIENDS]);
  });

  it('expires: an unchanged key past the TTL falls back to the rendered state', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.push(CREATE);
    vi.advanceTimersByTime(PENDING_NAV_TTL_MS - 1);
    rerender();
    expect(latestStack()).toEqual([SERVERS, CREATE]); // ещё в пределах окна
    vi.advanceTimersByTime(1);
    rerender();
    expect(latestStack()).toEqual([SERVERS]); // роутер молча отбросил навигацию
  });

  it('pushMany (several go() in one tick) stays pinned to the final stack', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.pushMany([CHANNELS, CHAT]);
    expect(navigate).toHaveBeenCalledTimes(2);
    rerender();
    expect(latestStack()).toEqual([SERVERS, CHANNELS, CHAT]);
  });

  it('a second push in the same tick still builds on the first while pending', () => {
    const { result, rerender } = renderHook(() => useMobileNav());
    result.current.push(CHANNELS);
    rerender(); // промежуточный рендер со старым key не должен «забыть» первый push
    result.current.push(CHAT);
    expect(latestStack()).toEqual([SERVERS, CHANNELS, CHAT]);
  });
});
