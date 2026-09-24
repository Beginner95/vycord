// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatArea } from '../ChatArea';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { channel, me, messages, otherUser, serverA, stubBrowser } from './chatHarness';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => []),
      getUserById: vi.fn(async () => ({ id: 'u2', username: 'boris' })),
      getMessagesAround: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

const SCROLL_HEIGHT = 4321;
const otherChannel = { ...channel, id: 'c2', name: 'random' };

beforeAll(stubBrowser);
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => SCROLL_HEIGHT });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], serversLoaded: true, members: [otherUser], channels: [channel, otherChannel], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
  usePaletteStore.setState({ command: null });
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
});

const tree = (ch = channel, active = true) => (
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChatArea channel={ch} user={me} active={active} />
  </MemoryRouter>
);
const list = (c: HTMLElement) => c.querySelector('.chat-messages') as HTMLElement;

describe('ChatArea: прокрутка к низу при входе в канал', () => {
  it('пока идёт загрузка (скелетон) — не скроллит; когда сообщения отрисованы — мгновенно к низу, без smooth', () => {
    useMessageStore.setState({ messages: [], loading: true });
    const { container } = render(tree());
    expect(list(container).scrollTop).toBe(0);

    act(() => useMessageStore.setState({ messages: messages(), loading: false }));
    expect(list(container).scrollTop).toBe(SCROLL_HEIGHT);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('смена канала: хвост прежнего канала не считается «готовым», прыжок — по сообщениям нового', () => {
    useMessageStore.setState({ messages: messages(), loading: false });
    const { container, rerender } = render(tree());
    list(container).scrollTop = 0;

    // Канал переключён, а в сторе ещё сообщения c1 (скелетон появится позже).
    rerender(tree(otherChannel));
    expect(list(container).scrollTop).toBe(0);

    act(() => useMessageStore.setState({ messages: messages().map((m) => ({ ...m, channel_id: 'c2' })), loading: false }));
    expect(list(container).scrollTop).toBe(SCROLL_HEIGHT);
  });

  it('новое сообщение уже открытого канала — по-прежнему плавно', () => {
    useMessageStore.setState({ messages: messages(), loading: false });
    render(tree());
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    act(() => useMessageStore.setState({
      messages: [...messages(), { ...messages()[0], id: 'm9', content: 'new' }],
    }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('скрытый под другим экраном чат (active=false) к низу не прыгает', () => {
    useMessageStore.setState({ messages: messages(), loading: false });
    const { container } = render(tree(channel, false));
    expect(list(container).scrollTop).toBe(0);
  });
});
