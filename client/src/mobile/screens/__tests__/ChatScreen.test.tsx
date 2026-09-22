// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatScreen } from '@/mobile/screens/ChatScreen';
import type { AppController } from '@/pages/app/useAppController';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { me, messages, stubBrowser } from '@/components/__tests__/chatHarness';
import { controller, nav, ch, s1 } from './fixtures';

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


const JOIN = 'Подключиться';
const SHOW_CALL = 'Звонок';
const SEARCH = 'Поиск сообщений';
const BACK = 'Назад';
const IN_CALL = 'в звонке';

beforeAll(stubBrowser);
beforeEach(() => {
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({ currentServer: s1, servers: [s1], serversLoaded: true, members: [], channels: [ch], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
});
afterEach(cleanup);

const byLabel = (label: string) =>
  [...document.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) as HTMLElement;

const stack = [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }] as const;

function mount(over: Partial<AppController> = {}) {
  const c = controller({ user: me, currentChannel: ch, ...over });
  const n = { ...nav(), stack, top: stack[2] } as ReturnType<typeof nav>;
  const joinVoice = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: stack, b: 2 } }]}>
      <ChatScreen channelId="c1" ctx={{ c, nav: n, joinVoice }} />
    </MemoryRouter>,
  );
  return { ...utils, n, joinVoice };
}

describe('ChatScreen', () => {
  it('waits while the store still points at another channel', () => {
    mount({ currentChannel: null });
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
    expect(document.querySelector('.chat-area')).toBeNull();
  });

  it('renders the screen header instead of the desktop one', () => {
    mount();
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(`#${ch.name}`);
    expect(document.querySelector('.screen-header-sub')?.textContent).toContain(s1.name);
    expect(document.querySelector('.chat-header')).toBeNull();
  });

  it('subtitle counts people in the call only when somebody is in it', () => {
    mount({ voiceParticipants: new Map([['c1', ['u2', 'u3']]]) });
    expect(document.querySelector('.screen-header-sub')?.textContent).toContain(IN_CALL);
  });

  it('tapping the title opens channel info; the back button goes back', () => {
    const { n } = mount();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'channelInfo', channelId: 'c1' });
    fireEvent.click(byLabel(BACK));
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('the call button joins when not in the call and opens the call screen when in it', () => {
    const a = mount();
    fireEvent.click(byLabel(JOIN));
    expect(a.joinVoice).toHaveBeenCalledWith(ch);
    cleanup();
    useCallStore.setState({ callChannelId: 'c1' });
    const b = mount();
    fireEvent.click(byLabel(SHOW_CALL));
    expect(b.n.push).toHaveBeenCalledWith({ kind: 'call' });
  });

  it('the search button opens the full-screen search layer', async () => {
    mount();
    fireEvent.click(byLabel(SEARCH));
    await act(async () => {});
    expect(document.querySelector('.chat-search-layer .message-search')).not.toBeNull();
  });

  it('uses the mobile composer', () => {
    mount();
    expect(document.querySelector('.composer-plus-btn')).not.toBeNull();
    expect(document.querySelector('.composer-attach-btn')).toBeNull();
  });
});
