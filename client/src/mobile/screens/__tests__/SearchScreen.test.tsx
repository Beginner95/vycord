// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта (SearchScreen тянет его через
// renderScreen), а jsdom его не определяет.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
import { MemoryRouter } from 'react-router-dom';
import { SearchScreen } from '@/mobile/screens/SearchScreen';
import type { AppController } from '@/pages/app/useAppController';
import type { Channel, PermissionSet } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useThemeStore } from '@/stores/themeStore';
import { controller, nav, ch, s1 } from './fixtures';

const RESULT = { id: 'm9', username: 'Борис', content: 'привет мир', created_at: '2026-09-20T09:00:00Z' };
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: { ...actual.apiService, searchMessages: vi.fn(async () => ({ results: [RESULT], total: 1 })) },
  };
});

const flood: Channel = { ...ch, id: 'c2', name: 'флудилка', position: 1 };
const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });

const PLACEHOLDER = 'Каналы, сообщения, действия…';
const G_CHANNELS = 'Каналы — этот сервер';
const G_MESSAGES = 'Сообщения — в этом канале';
const G_ACTIONS = 'Действия';
const A_CREATE_SERVER = 'Создать сервер';
const A_FIND_SERVER = 'Найти сервер';
const A_SETTINGS = 'Открыть настройки';
const A_CREATE_CHANNEL = 'Создать канал';
const A_THEME_DARK = 'Включить тёмную тему';
const A_SEARCH_IN = 'Искать в канале #общий';
const A_JOIN_VOICE = 'Войти в голосовой «общий»';
const SHOW_ALL = 'Показать все результаты';
const BACK = 'Назад';

beforeEach(() => {
  vi.clearAllMocks();
  usePaletteStore.setState({ command: null, isOpen: false });
  useServerStore.setState({ permissions: new Map([['s1', perms(0n, true)]]), currentServer: s1 });
  useThemeStore.setState({ theme: 'light' });
});
afterEach(cleanup);

function mount(channelId: string | null, over: Partial<AppController> = {}) {
  const c = controller({ channels: [ch, flood], currentChannel: ch, ...over });
  const n = nav();
  const joinVoice = vi.fn();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <SearchScreen ctx={{ c, nav: n, joinVoice }} channelId={channelId} />
    </MemoryRouter>,
  );
  return { c, n, joinVoice, input: document.querySelector('.search-input') as HTMLInputElement };
}
const titles = () => [...document.querySelectorAll('.mobile-row-title-text')].map((e) => e.textContent);
const groups = () => [...document.querySelectorAll('.search-group')].map((e) => e.textContent);
const row = (title: string) =>
  [...document.querySelectorAll('.mobile-row')].find(
    (r) => r.querySelector('.mobile-row-title-text')?.textContent === title,
  ) as HTMLElement;
const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });

describe('SearchScreen', () => {
  it('focuses the field; an empty query shows channels and actions', () => {
    const { input } = mount(null);
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe(PLACEHOLDER);
    expect(groups()).toEqual([G_CHANNELS, G_ACTIONS]);
  });

  it('a channel row opens channels + chat on top of the search entry', () => {
    const { n, input } = mount(null);
    type(input, 'флуд');
    expect(titles()[0]).toBe('флудилка');
    fireEvent.click(row('флудилка'));
    expect(n.pushMany).toHaveBeenCalledWith([{ kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c2' }]);
  });

  it('without a chat below there is no message group and no channel-bound actions', () => {
    const { input } = mount(null);
    type(input, 'привет');
    expect(groups()).not.toContain(G_MESSAGES);
    expect(titles()).not.toContain(A_SEARCH_IN);
    expect(titles()).not.toContain(A_JOIN_VOICE);
    expect(apiService.searchMessages).not.toHaveBeenCalled();
  });

  it('with a chat below a message result queues chat-jump and goes back', async () => {
    const { n, input } = mount('c1');
    type(input, 'привет');
    // Группа появляется уже со строкой «идёт поиск» — ждём именно результат.
    await waitFor(() => expect(titles()).toContain(RESULT.username));
    expect(groups()).toContain(G_MESSAGES);
    // expect внутри мока бросал бы в обработчике React-события и мог быть проглочен —
    // фиксируем команду в момент back() и проверяем после клика.
    let commandAtBack: unknown = null;
    n.back = vi.fn(() => { commandAtBack = usePaletteStore.getState().command; });
    fireEvent.click(row(RESULT.username));
    expect(n.back).toHaveBeenCalledOnce();
    expect(commandAtBack).toMatchObject({ kind: 'chat-jump', channelId: 'c1', messageId: 'm9' });
  });

  it('«show all» queues chat-search with the query and goes back', async () => {
    vi.mocked(apiService.searchMessages).mockResolvedValueOnce({ results: [RESULT], total: 9 } as never);
    const { n, input } = mount('c1');
    type(input, 'привет');
    await waitFor(() => expect(titles()).toContain(SHOW_ALL));
    fireEvent.click(row(SHOW_ALL));
    expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1', query: 'привет' });
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('«search in channel» queues chat-search and goes back', () => {
    const { n } = mount('c1');
    fireEvent.click(row(A_SEARCH_IN));
    expect(usePaletteStore.getState().command).toMatchObject({ kind: 'chat-search', channelId: 'c1', query: '' });
    expect(n.back).toHaveBeenCalledOnce();
  });

  it('actions navigate or delegate to the controller', () => {
    const { c, n, joinVoice } = mount('c1');
    fireEvent.click(row(A_CREATE_SERVER));
    expect(n.push).toHaveBeenCalledWith({ kind: 'createServer' });
    fireEvent.click(row(A_FIND_SERVER));
    expect(n.push).toHaveBeenCalledWith({ kind: 'findServer' });
    fireEvent.click(row(A_SETTINGS));
    expect(c.ui.setSettingsOpen).toHaveBeenCalledWith(true);
    fireEvent.click(row(A_CREATE_CHANNEL));
    expect(c.ui.setCreateChannelOpen).toHaveBeenCalledWith(true);
    fireEvent.click(row(A_JOIN_VOICE));
    expect(joinVoice).toHaveBeenCalledWith(ch);
    fireEvent.click(row(A_THEME_DARK));
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('the create-channel action is hidden without MANAGE_CHANNELS', () => {
    useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
    mount(null, { currentServer: { ...s1, owner_id: 'u9' } });
    expect(titles()).not.toContain(A_CREATE_CHANNEL);
  });

  it('the back button goes back; nothing found shows the empty text', () => {
    const { n, input } = mount(null);
    type(input, 'zzzzzz');
    expect(document.querySelector('.search-status')?.textContent).toContain('zzzzzz');
    fireEvent.click([...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === BACK)!);
    expect(n.back).toHaveBeenCalledOnce();
  });
});
