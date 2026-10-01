// @vitest-environment jsdom
// Сценарий: в ленте голосовое автора me (u1) с listened=false; WS присылает
// voice_listened от другого пользователя → точка гаснет. Затем событие для
// чужого голосового (автор u2) от третьего пользователя → не меняется.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatArea } from '../ChatArea';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { channel, me, otherUser, serverA, stubBrowser } from './chatHarness';
import { wsService } from '@/services/websocket';

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

const voiceMsg = (id: string, authorId: string, attId: string): ChatMessage => ({
  id, channel_id: 'c1', user_id: authorId, kind: 'user', content: '',
  created_at: '2026-09-20T09:05:00Z', updated_at: '2026-09-20T09:05:00Z',
  attachments: [{ id: attId, user_id: authorId, is_voice: true, listened: false }],
} as unknown as ChatMessage);

const listeners = new Map<string, (p: unknown) => void>();
const unsubs = new Map<string, ReturnType<typeof vi.fn>>();

beforeAll(stubBrowser);
beforeEach(() => {
  listeners.clear();
  unsubs.clear();
  vi.mocked(wsService.on).mockImplementation(((ev: string, cb: (p: unknown) => void) => {
    listeners.set(ev, cb);
    const off = vi.fn();
    unsubs.set(ev, off);
    return off;
  }) as never);
  useMessageStore.setState({ messages: [voiceMsg('m1', 'u1', 'v1'), voiceMsg('m2', 'u2', 'v2')], loading: false });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], serversLoaded: true, members: [otherUser], channels: [channel], permissions: new Map() });
  useCallStore.setState({ callChannelId: null });
});
afterEach(cleanup);

const props = () => ({ channel, user: me, voiceParticipants: new Map<string, string[]>(), onJoinVoice: vi.fn(), onShowCall: vi.fn(), onShowMembers: vi.fn() });

describe('ChatArea voice_listened', () => {
  it('applies the event via the store rule and unsubscribes on unmount', async () => {
    const { unmount } = render(<MemoryRouter><ChatArea {...props()} /></MemoryRouter>);
    await act(async () => {});
    const fire = listeners.get('voice_listened');
    expect(fire).toBeTypeOf('function');

    act(() => {
      fire!({ channel_id: 'c1', message_id: 'm1', attachment_id: 'v1', user_id: 'u2' });
      fire!({ channel_id: 'c1', message_id: 'm2', attachment_id: 'v2', user_id: 'u3' });
    });
    const [m1, m2] = useMessageStore.getState().messages;
    expect(m1.attachments![0].listened).toBe(true);
    expect(m2.attachments![0].listened).toBe(false);

    const off = unsubs.get('voice_listened')!;
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
