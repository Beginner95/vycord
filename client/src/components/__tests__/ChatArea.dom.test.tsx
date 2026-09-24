// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatArea } from '../ChatArea';
import { useMessageStore } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { channel, fixedNow, me, messages, normalizeHtml, otherUser, serverA, stubBrowser } from './chatHarness';

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

beforeAll(stubBrowser);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixedNow);
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], serversLoaded: true, members: [otherUser], channels: [channel], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const props = () => ({ channel, user: me, voiceParticipants: new Map([['c1', ['u2']]]), onJoinVoice: vi.fn(), onShowCall: vi.fn(), onShowMembers: vi.fn() });
const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/ChatArea.${name}.html`);
const mount = (p: ReturnType<typeof props> = props()) => render(<MemoryRouter><ChatArea {...p} /></MemoryRouter>);

describe('ChatArea DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('channel with messages', async () => { mount(); await act(async () => {}); await snap('channel'); });
  it('loading skeleton', async () => { useMessageStore.setState({ messages: [], loading: true }); mount(); await snap('loading'); });
  it('quiet channel', async () => { useMessageStore.setState({ messages: [] }); mount(); await snap('quiet'); });
  it('no channel, no servers', async () => { useServerStore.setState({ servers: [] }); mount({ ...props(), channel: null as never }); await snap('no-servers'); });
  it('no channel, servers exist', async () => { mount({ ...props(), channel: null as never }); await snap('welcome'); });
  it('search panel open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.chat-search-btn')!);
    await act(async () => {});
    await snap('search');
  });
  // Кнопки своего сообщения — цитата, изменить, удалить (в таком порядке).
  it('inline editor open on own message', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelectorAll('[data-message-id="m2"] .msg-action-btn')[1]!);
    await snap('editing');
  });
  it('delete confirm open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-message-id="m2"] .msg-action-btn.is-danger')!);
    await snap('delete-confirm');
  });
  it('emoji picker open', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-icon-btn')!);
    await snap('emoji-picker');
  });
});
