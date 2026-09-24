// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatArea } from '../ChatArea';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { apiService } from '@/services/api';
import { channel, fixedNow, me, messages, otherUser, serverA, stubBrowser } from './chatHarness';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => []),
      getUserById: vi.fn(async () => ({ id: 'u2', username: 'boris' })),
      searchMessages: vi.fn(async () => ({ results: [], total: 0 })),
      getMessagesAround: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

const HEADER_LABEL = 'probe';
const DELETE_TITLE = 'Удалить сообщение?';

beforeAll(stubBrowser);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixedNow);
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], serversLoaded: true, members: [otherUser], channels: [channel], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
  usePaletteStore.setState({ command: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const tree = (p: Partial<React.ComponentProps<typeof ChatArea>> = {}) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChatArea channel={channel} user={me} {...p} />
  </MemoryRouter>
);
const mount = (p: Partial<React.ComponentProps<typeof ChatArea>> = {}) => render(tree(p));
const searchHeader = ({ openSearch }: { openSearch(): void }) => (
  <button type="button" className="probe-header" onClick={openSearch}>{HEADER_LABEL}</button>
);

describe('ChatArea seams', () => {
  it('a custom header replaces .chat-header; a function header gets openSearch', async () => {
    const { container } = mount({ header: searchHeader, searchMode: 'screen' });
    expect(container.querySelector('.chat-header')).toBeNull();
    fireEvent.click(container.querySelector('.probe-header')!);
    await act(async () => {});
    expect(container.querySelector('.chat-search-layer .message-search')).not.toBeNull();
  });

  it('without header the built-in one is rendered (desktop)', () => {
    expect(mount().container.querySelector('.chat-header')).not.toBeNull();
  });

  it('screen search closes when a result is chosen and the jump runs', async () => {
    vi.useRealTimers(); // debounce поиска — реальные 300 мс
    vi.mocked(apiService.searchMessages).mockResolvedValueOnce({
      results: [{ id: 'm1', username: 'boris', content: 'hello', created_at: '2026-09-20T09:05:00Z' }], total: 1,
    } as never);
    const { container } = mount({ header: searchHeader, searchMode: 'screen' });
    fireEvent.click(container.querySelector('.probe-header')!);
    fireEvent.change(container.querySelector('.message-search-field')!, { target: { value: 'hello' } });
    const result = await waitFor(() => {
      const el = container.querySelector('.message-search-result');
      if (!el) throw new Error('no result yet');
      return el;
    }, { timeout: 2000 });
    fireEvent.click(result);
    await waitFor(() => expect(apiService.getMessagesAround).toHaveBeenCalledWith('c1', 'm1'));
    expect(container.querySelector('.chat-search-layer')).toBeNull();
  });

  it('messageActions="sheet": long-press on a message opens the sheet; Delete opens the confirm', async () => {
    vi.useRealTimers(); // long-press 450 мс — реальные таймеры + waitFor
    const { container } = mount({ messageActions: 'sheet' });
    const row = container.querySelector('.msg-row.is-own:not(.is-failed)') as HTMLElement;
    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 3, clientY: 3 });
    await screen.findByRole('dialog', {}, { timeout: 1500 });
    const del = [...document.querySelectorAll('.sheet .action-sheet-item')].pop()!;
    fireEvent.click(del);
    expect(await screen.findByText(DELETE_TITLE)).toBeTruthy(); // ConfirmModal
  });

  it('hover mode (default): rows have no long-press class', () => {
    expect(mount().container.querySelector('.msg-row.is-pressable')).toBeNull();
  });

  it('active={false}: a palette command is left untouched until the chat is active', async () => {
    const view = mount({ active: false, searchMode: 'screen' });
    act(() => usePaletteStore.getState().searchInChannel('c1', 'q'));
    expect(usePaletteStore.getState().command).not.toBeNull();
    expect(view.container.querySelector('.message-search')).toBeNull();
    view.rerender(tree({ active: true, searchMode: 'screen' }));
    await waitFor(() => expect(view.container.querySelector('.message-search')).not.toBeNull());
    expect(usePaletteStore.getState().command).toBeNull();
  });
});
