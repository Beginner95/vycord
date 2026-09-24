// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта, а хост-заглушки из beforeAll
// к этому времени ещё не выполнены.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

import { CommandPalette } from '../CommandPalette';
import { PALETTE_DEBOUNCE_MS } from '@/utils/paletteFilter';
import { usePaletteStore } from '@/stores/paletteStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore } from '@/stores/themeStore';
import { channel, fixedNow, normalizeHtml, serverA, stubBrowser } from './chatHarness';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      searchMessages: vi.fn(async () => ({
        results: [
          { id: 'm1', channel_id: 'c1', user_id: 'u2', username: 'boris', kind: 'user', content: 'the general plan', created_at: '2026-09-20T09:05:00Z', updated_at: '2026-09-20T09:05:00Z' },
          { id: 'm2', channel_id: 'c1', user_id: 'u1', username: 'anna', kind: 'user', content: 'generally fine', created_at: '2026-09-19T18:30:00Z', updated_at: '2026-09-19T18:30:00Z' },
        ],
        total: 2,
      })),
    },
  };
});

beforeAll(stubBrowser);
beforeEach(() => {
  // Дебаунс поиска (PALETTE_DEBOUNCE_MS) — настоящий setTimeout: без его подмены
  // снимок ловил бы переходное «Ищем…» и зависел от реального времени.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(fixedNow);
  const random = { ...channel, id: 'c2', name: 'random', position: 1 };
  useServerStore.setState({
    currentServer: serverA, servers: [serverA], channels: [channel, random], currentChannel: channel,
    permissions: new Map([[serverA.id, { isOwner: true, bits: 0n, highestPosition: 0 }]]),
  });
  useCallStore.setState({ callChannelId: null });
  useThemeStore.setState({ theme: 'light' });
  usePaletteStore.setState({ isOpen: true, command: null });
});
afterEach(() => { cleanup(); usePaletteStore.setState({ isOpen: false }); vi.useRealTimers(); });

const props = () => ({
  onSelectChannel: vi.fn(), onOpenSettings: vi.fn(), onCreateChannel: vi.fn(), onCreateServer: vi.fn(),
  onFindServer: vi.fn(), onJoinVoice: vi.fn(), onShowChat: vi.fn(),
});
const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/CommandPalette.${name}.html`);

describe('CommandPalette DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('empty query: channels and actions', async () => {
    render(<CommandPalette {...props()} />);
    await act(async () => {});
    await snap('empty');
  });
  it('query "gen"', async () => {
    render(<CommandPalette {...props()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'gen' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(PALETTE_DEBOUNCE_MS + 80); });
    await snap('query');
  });
});
