// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChannelInfoScreen } from '@/mobile/screens/ChannelInfoScreen';
import type { AppController } from '@/pages/app/useAppController';
import type { MemberWithUser, PermissionSet } from '@/types';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { callService } from '@/services/call';
import { controller, nav, ch, s1 } from './fixtures';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2' }]),
      getLastSeenBatch: vi.fn(async () => ({})),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));
vi.mock('@/services/call', () => ({ callService: { startCall: vi.fn(async () => null) } }));

const boris = { user_id: 'u2', username: 'Борис' } as MemberWithUser;
const vera = { user_id: 'u3', username: 'Вера' } as MemberWithUser;
const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });

const HEADER = 'О канале';
const CALL = 'Звонок';
const SEARCH = 'Поиск';
const MANAGE = 'Управление каналом';
const INVITE = 'Пригласить друзей';
const EDIT = 'Редактировать';
const CALL_BORIS = 'Позвонить Борис';
const IN_VOICE = 'в голосовом · общий';

const stack = [
  { kind: 'servers' }, { kind: 'channels', serverId: 's1' },
  { kind: 'chat', channelId: 'c1' }, { kind: 'channelInfo', channelId: 'c1' },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ command: null });
  useCallStore.setState({ callChannelId: null });
  useServerStore.setState({
    members: [boris, vera], channels: [ch], currentServer: s1,
    permissions: new Map([['s1', perms(0n, true)]]),
  });
});
afterEach(cleanup);

function mount(over: Partial<AppController> = {}) {
  const c = controller({
    currentChannel: ch, members: [boris, vera], voiceParticipants: new Map([['c1', ['u2']]]), ...over,
  });
  const n = { ...nav(), stack, top: stack[3] } as ReturnType<typeof nav>;
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: stack, b: 3 } }]}>
      <ChannelInfoScreen channelId="c1" ctx={{ c, nav: n, joinVoice: vi.fn() }} />
    </MemoryRouter>,
  );
  return { c, n };
}
const text = () => document.body.textContent ?? '';
const rowByTitle = (title: string) =>
  [...document.querySelectorAll('.mobile-row')].find(
    (r) => r.querySelector('.mobile-row-title-text')?.textContent === title,
  ) as HTMLElement | undefined;
const actionByText = (label: string) =>
  [...document.querySelectorAll('.channel-info-action')].find((b) => b.textContent === label) as HTMLElement;
const noRights = () => {
  useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
  return { currentServer: { ...s1, owner_id: 'u9' } } as Partial<AppController>;
};

describe('ChannelInfoScreen', () => {
  it('header, hero and member sections; back goes back', async () => {
    const { n } = mount();
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(HEADER);
    expect(document.querySelector('.channel-info-name')?.textContent).toBe(ch.name);
    expect(document.querySelector('.channel-info-server')?.textContent).toBe(s1.name);
    await waitFor(() => expect(document.querySelectorAll('.channel-info-category')).toHaveLength(2));
    expect(rowByTitle('Борис')).toBeTruthy();
    expect(rowByTitle('Вера')).toBeTruthy();
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('shows «в голосовом · канал» for an online member in the call', async () => {
    mount();
    await waitFor(() => expect(text()).toContain(IN_VOICE));
  });

  it('tapping an online member offers a call; offline members are inert', async () => {
    mount();
    await waitFor(() => expect(rowByTitle('Борис')).toBeTruthy());
    fireEvent.click(rowByTitle('Вера')!);
    expect(document.querySelector('.sheet')).toBeNull();
    fireEvent.click(rowByTitle('Борис')!);
    const item = [...document.querySelectorAll('.sheet .action-sheet-item')]
      .find((i) => i.textContent?.includes(CALL_BORIS))!;
    fireEvent.click(item);
    expect(callService.startCall).toHaveBeenCalledWith('u2');
  });

  it('«Звонок» joins and REPLACES the info screen with the call screen', () => {
    const { c, n } = mount();
    fireEvent.click(actionByText(CALL));
    expect(c.joinVoice).toHaveBeenCalledWith(ch);
    expect(n.replaceStack).toHaveBeenCalledWith([...stack.slice(0, -1), { kind: 'call' }]);
  });

  it('«Звонок» while already in this call does not join again', () => {
    useCallStore.setState({ callChannelId: 'c1' });
    const { c, n } = mount();
    fireEvent.click(actionByText(CALL));
    expect(c.joinVoice).not.toHaveBeenCalled();
    expect(n.replaceStack).toHaveBeenCalledOnce();
  });

  it('«Поиск» queues the chat-search command BEFORE going back', () => {
    const { n } = mount();
    n.back = vi.fn(() => {
      // К моменту возврата команда уже в сторе: чат подхватит её, став верхним экраном.
      expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1' });
    });
    fireEvent.click(actionByText(SEARCH));
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('the invite row needs the right and leads to the invites screen', () => {
    const { n } = mount();
    fireEvent.click(rowByTitle(INVITE)!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'invites', serverId: 's1' });
    cleanup();
    mount(noRights());
    expect(rowByTitle(INVITE)).toBeUndefined();
  });

  it('«Управление каналом» is gated by MANAGE_CHANNELS and opens the channel menu', () => {
    mount();
    fireEvent.click(rowByTitle(MANAGE)!);
    expect([...document.querySelectorAll('.sheet .action-sheet-item')].some((i) => i.textContent?.includes(EDIT))).toBe(true);
    cleanup();
    mount(noRights());
    expect(rowByTitle(MANAGE)).toBeUndefined();
  });
});
