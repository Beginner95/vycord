// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта (SearchScreen тянет его через
// renderScreen), а jsdom его не определяет: заглушка должна встать до импортов.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Channel, Server } from '@/types';

vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => []),
      getUserById: vi.fn(async () => ({ id: 'u2', username: 'Борис' })),
      searchMessages: vi.fn(async () => ({ results: [], total: 0 })),
      getMessagesAround: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
      getOnlineUsers: vi.fn(async () => []),
      getLastSeenBatch: vi.fn(async () => ({})),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { controller } from '@/mobile/screens/__tests__/fixtures';
import { me, messages, stubBrowser } from '@/components/__tests__/chatHarness';

const alpha = { id: 's1', name: 'Альфа', owner_id: 'u1' } as Server;
const general = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' } as Channel;

const EDIT = 'Изменить';
const SEARCH = 'Поиск';
const SEARCH_MESSAGES = 'Поиск сообщений';
const BACK = 'Назад';
const PLACEHOLDER = 'Каналы, сообщения, действия…';

const S = [{ kind: 'servers' }] as const;
const C = [...S, { kind: 'channels', serverId: 's1' }] as const;
const H = [...C, { kind: 'chat', channelId: 'c1' }] as const;
const entry = (m: readonly unknown[], b: number) => ({ pathname: '/app', state: { m, b } });

let go: ReturnType<typeof useNavigate>;
function Grab() { go = useNavigate(); return null; }

const selectServer = vi.fn(async (s: Server) => { useServerStore.setState({ currentServer: s, channels: [general] }); });
const selectChannel = vi.fn(async (ch: Channel) => { useServerStore.setState({ currentChannel: ch }); });

function Host() {
  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannel = useServerStore((s) => s.currentChannel);
  const channels = useServerStore((s) => s.channels);
  const c: AppController = controller({
    user: me, servers: [alpha], currentServer, currentChannel, channels, members: [], selectServer, selectChannel,
  });
  return (<><Grab /><MobileShell c={c} /></>);
}
const mount = (entries: ReturnType<typeof entry>[] = [entry(S, 0), entry(C, 1), entry(H, 2)], index = entries.length - 1) =>
  render(<MemoryRouter initialEntries={entries} initialIndex={index}><Host /></MemoryRouter>);

const flush = () => act(async () => {});
const top = () => document.querySelector('.mobile-screen.is-top') as HTMLElement;
const byLabel = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) as HTMLElement;
const goBack = () => act(async () => { go(-1); });

beforeAll(stubBrowser);
beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ isOpen: false, command: null });
  useMessageStore.setState({ messages: messages(), loading: false });
  useServerStore.setState({
    servers: [alpha], serversLoaded: true, currentServer: alpha, channels: [general], currentChannel: general,
    members: [], permissions: new Map(),
  });
});
afterEach(cleanup);

describe('MobileShell stage 3 (real chat screens)', () => {
  it('the chat screen has the mobile header and composer, not the desktop header', async () => {
    mount(); await flush();
    // Под чатом смонтированы и нижние экраны стека — смотрим верхний.
    expect(top().querySelector('.screen-header-name')?.textContent).toBe('#общий');
    expect(document.querySelector('.composer-clip-btn')).not.toBeNull();
    expect(top().querySelector('.chat-header')).toBeNull();
  });

  it('long-press on an own message opens the sheet; Edit shows explicit buttons; Cancel closes the editor', async () => {
    mount(); await flush();
    const own = document.querySelector('.msg-row.is-own:not(.is-failed)') as HTMLElement;
    fireEvent.pointerDown(own, { pointerType: 'touch', button: 0, clientX: 4, clientY: 4 });
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull(), { timeout: 1500 });
    fireEvent.click([...document.querySelectorAll('.sheet .action-sheet-item')].find((i) => i.textContent?.includes(EDIT))!);
    await waitFor(() => expect(document.querySelector('.msg-edit-actions')).not.toBeNull());
    fireEvent.click(document.querySelector('.msg-edit-actions .btn-secondary')!);
    await waitFor(() => expect(document.querySelector('.msg-edit-actions')).toBeNull());
  });

  it('tapping the title opens channel info; back returns to the chat', async () => {
    mount(); await flush();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    await waitFor(() => expect(document.querySelector('.channel-info')).not.toBeNull());
    fireEvent.click(byLabel(top(), BACK));
    await waitFor(() => expect(document.querySelector('.channel-info')).toBeNull());
    expect(top().querySelector('.composer-clip-btn')).not.toBeNull();
  });

  it('channel info → Search returns to the chat and opens the search layer (D9)', async () => {
    mount(); await flush();
    fireEvent.click(document.querySelector('.screen-header-title.is-tappable')!);
    await waitFor(() => expect(document.querySelector('.channel-info')).not.toBeNull());
    fireEvent.click([...document.querySelectorAll('.channel-info-action')].find((b) => b.textContent === SEARCH)!);
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).not.toBeNull());
    expect(document.querySelector('.channel-info')).toBeNull();
  });

  it('system back closes the search layer, not the chat', async () => {
    mount(); await flush();
    fireEvent.click(byLabel(document, SEARCH_MESSAGES));
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.chat-search-layer')).toBeNull());
    expect(top().querySelector('.composer-clip-btn')).not.toBeNull();
  });

  it('Servers → search → channel; back goes channels, then search', async () => {
    mount([entry(S, 0)]); await flush();
    fireEvent.click(byLabel(document.querySelector('.servers-screen')!, SEARCH));
    await waitFor(() => expect(document.querySelector('.search-screen')).not.toBeNull());
    fireEvent.change(document.querySelector('.search-input')!, { target: { value: 'общ' } });
    fireEvent.click([...document.querySelectorAll('.mobile-row')].find((r) => r.textContent?.includes('общий'))!);
    await waitFor(() => expect(top().querySelector('.composer-clip-btn')).not.toBeNull());
    await goBack();
    await waitFor(() => {
      // channels-screen смонтирован и как нижний экран — проверяем именно верх стека.
      expect(top().querySelector('.channels-screen')).not.toBeNull();
      expect(top().querySelector('.composer-clip-btn')).toBeNull();
    });
    await goBack();
    await waitFor(() => {
      expect(top().querySelector('.search-screen')).not.toBeNull();
      expect(top().querySelector('.channels-screen')).toBeNull();
    });
  });

  it('hardware ⌘K opens the search screen and resets the palette flag', async () => {
    mount(); await flush();
    act(() => usePaletteStore.getState().open());
    await waitFor(() => expect(document.querySelector('.search-screen')).not.toBeNull());
    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect((document.querySelector('.search-input') as HTMLInputElement).placeholder).toBe(PLACEHOLDER);
    // AppOverlays заглушен (null), так что отсутствие .palette-dialog здесь ничего не доказывает:
    // настоящий предохранитель — showPalette={false}, его покрывает мост в MobileShell.stage2.test.
  });

  it('a lightbox opens over the chat and system back closes only the lightbox', async () => {
    const withImage = messages();
    withImage[0] = {
      ...withImage[0],
      attachments: [{
        id: 'a1', channel_id: 'c1', user_id: 'u2', kind: 'image', file_name: 'p.png', content_type: 'image/png',
        size_bytes: 10, url: '/api/v1/attachments/a1/content?exp=1&sig=x', created_at: '2026-09-20T09:05:00Z',
      }],
    };
    useMessageStore.setState({ messages: withImage });
    mount(); await flush();
    fireEvent.click(document.querySelector('.attachment-image')!);
    await waitFor(() => expect(document.querySelector('.lightbox-root')).not.toBeNull());
    await goBack();
    await waitFor(() => expect(document.querySelector('.lightbox-root')).toBeNull());
    expect(top().querySelector('.composer-clip-btn')).not.toBeNull();
  });
});
