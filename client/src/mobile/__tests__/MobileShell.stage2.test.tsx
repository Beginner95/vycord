// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта (SearchScreen тянет его через
// renderScreen), а jsdom его не определяет.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
import { MemoryRouter } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Server, Channel } from '@/types';

// Настоящие renderScreen и экраны; заглушены только оверлеи и звонковый UI.
vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { controller } from '@/mobile/screens/__tests__/fixtures';

afterEach(cleanup);

const alpha = { id: 's1', name: 'Альфа', owner_id: 'u1' } as Server;
const beta = { id: 's2', name: 'Бета', owner_id: 'u9' } as Server;
const general = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' } as Channel;

const ADD_SERVER = 'Добавить сервер';
const CREATE_SERVER = 'Создать сервер';
const BACK = 'Назад';

/** Контроллер с живым стором: selectServer кладёт сервер в serverStore, а
 *  currentServer читается из него — как в настоящем useAppController. */
const selectServer = vi.fn(async (s: Server) => {
  useServerStore.setState({ currentServer: s, channels: s.id === 's1' ? [general] : [] });
});

function Host() {
  const currentServer = useServerStore((s) => s.currentServer);
  const channels = useServerStore((s) => s.channels);
  const c: AppController = controller({
    servers: [alpha, beta], currentServer, channels, members: [], selectServer,
  });
  return <MobileShell c={c} />;
}

const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app' }]}><Host /></MemoryRouter>,
);
const byLabel = (root: ParentNode, label: string) =>
  [...root.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label);
const flush = () => act(async () => {});
const rows = () => [...document.querySelectorAll('.mobile-row')];

beforeEach(() => {
  selectServer.mockClear();
  useServerStore.setState({
    servers: [alpha, beta], serversLoaded: true, currentServer: null, channels: [], currentChannel: null,
  });
});

describe('MobileShell stage 2 (real screens)', () => {
  it('cold start shows the servers screen with the tab bar', async () => {
    mount();
    await flush();
    expect(document.querySelector('.servers-screen')).not.toBeNull();
    expect(document.querySelector('.server-list')).toBeNull();
    expect(rows().length).toBe(2);
    expect(document.querySelector('.tab-bar')).not.toBeNull();
  });

  it('tapping a server pushes its channels screen and hides the tab bar', async () => {
    mount();
    await flush();
    fireEvent.click(rows()[0]);
    await flush();
    expect(selectServer).toHaveBeenCalledWith(alpha);
    expect(document.querySelector('.channels-screen')).not.toBeNull();
    expect(document.querySelector('.channel-sidebar')).toBeNull();
    expect(document.querySelector('.tab-bar')).toBeNull();
  });

  it('header plus -> create server opens the form, back returns to the servers screen', async () => {
    mount();
    await flush();
    fireEvent.click(byLabel(document, ADD_SERVER)!);
    await flush();
    const create = [...document.querySelectorAll('.action-sheet-item')]
      .find((el) => el.textContent?.includes(CREATE_SERVER));
    expect(create).toBeTruthy();
    fireEvent.click(create!);
    await flush();
    expect(document.querySelector('.form-screen')).not.toBeNull();
    expect(document.querySelector('.tab-bar')).toBeNull();

    const form = document.querySelector('.mobile-screen.is-top')!;
    fireEvent.click(byLabel(form, BACK)!);
    await flush();
    expect(document.querySelector('.form-screen')).toBeNull();
    expect(document.querySelector('.servers-screen')).not.toBeNull();
    expect(document.querySelector('.tab-bar')).not.toBeNull();
  });

  it('the hardware ⌘K flag opens the search screen once and resets the store flag', async () => {
    mount();
    await flush();
    act(() => { usePaletteStore.getState().open(); });
    await flush();
    expect(document.querySelector('.search-screen')).not.toBeNull();
    expect(usePaletteStore.getState().isOpen).toBe(false);
    // Повторное нажатие поверх уже открытого поиска стек не наращивает.
    act(() => { usePaletteStore.getState().open(); });
    await flush();
    expect(document.querySelectorAll('.search-screen').length).toBe(1);
    fireEvent.click(byLabel(document, BACK)!);
    await flush();
    expect(document.querySelector('.search-screen')).toBeNull();
    expect(document.querySelector('.servers-screen')).not.toBeNull();
  });
});
