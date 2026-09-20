// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermissionSet, Channel } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import { useServerStore } from '@/stores/serverStore';
import { ChannelsScreen } from '@/mobile/screens/ChannelsScreen';
import { __setActivityOverride } from '@/mobile/activity';
import { controller, nav, s2, ch } from './fixtures';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteServer: vi.fn(async () => {}) } };
});
import { apiService } from '@/services/api';

afterEach(() => { __setActivityOverride(null); cleanup(); });

const mount = (c: AppController, n: MobileNav = nav(), serverId = 's1') => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChannelsScreen serverId={serverId} ctx={{ c, nav: n, joinVoice: vi.fn() }} />
  </MemoryRouter>,
);

const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });
beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState({ permissions: new Map([['s1', perms(0n, true)]]) });
});

const lastHeaderButton = () => {
  const buttons = [...document.querySelectorAll('.screen-header-actions button')];
  return buttons[buttons.length - 1];
};

describe('ChannelsScreen', () => {
  it('waits while the store still points at another server', () => {
    mount(controller({ currentServer: null }));
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
    expect(document.querySelectorAll('.mobile-row').length).toBe(0);
  });

  it('never shows channels of the previous server after a switch', () => {
    // handleSelectServer ставит currentServer сразу, а channels обновляет позже.
    mount(controller({ currentServer: s2, channels: [ch] }), nav(), 's2');
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(s2.name);
    expect(document.querySelectorAll('.mobile-row').length).toBe(0);
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
    expect(document.querySelector('.mobile-empty-body')).toBeNull();
  });

  it('keeps only the rows of this server when the list is mixed', () => {
    const own: Channel = { ...ch, id: 'c2', server_id: 's2', name: 'свой' };
    mount(controller({ currentServer: s2, channels: [ch, own] }), nav(), 's2');
    const titles = [...document.querySelectorAll('.mobile-row-title')].map((n) => n.textContent);
    expect(titles).toEqual(['свой']);
  });

  it('shows the server name and its member count in the header', () => {
    mount(controller());
    expect(document.querySelector('.screen-header-name')?.textContent).toBe('Волчья стая');
    expect(document.querySelector('.screen-header-sub')?.textContent).toBe('1 участник');
  });

  it('hides the member count while the member list is still loading', () => {
    mount(controller({ members: [] }));
    expect(document.querySelector('.screen-header-sub')).toBeNull();
  });

  it('renders one row per channel and opens the chat on tap', () => {
    const n = nav();
    mount(controller(), n);
    expect(document.querySelectorAll('.mobile-row').length).toBe(1);
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(n.push).toHaveBeenCalledWith({ kind: 'chat', channelId: 'c1' });
  });

  it('shows who is in voice in the channel', () => {
    mount(controller({ voiceParticipants: new Map([['c1', ['u2']]]) }));
    expect(document.querySelector('.mobile-row-sub')?.textContent).toContain('Борис');
  });

  it('opens the channel menu on long press', async () => {
    mount(controller());
    fireEvent.pointerDown(document.querySelector('.mobile-row')!, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 });
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(document.querySelector('.sheet')).not.toBeNull();
  });

  it('opens the server menu from «…» in the header', async () => {
    mount(controller());
    fireEvent.click(lastHeaderButton());
    await act(async () => {});
    expect(document.querySelector('.sheet')).not.toBeNull();
  });

  it('leaves for the servers root when the server is deleted', async () => {
    const n = nav();
    const c = controller();
    mount(c, n);
    fireEvent.click(lastHeaderButton());
    await act(async () => {});
    const del = [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
    fireEvent.click(del);
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-danger') as HTMLButtonElement);
    await act(async () => {});
    expect(apiService.deleteServer).toHaveBeenCalledWith('s1');
    expect(c.serverRemoved).toHaveBeenCalledWith('s1');
    expect(n.back).toHaveBeenCalled();
  });

  it('shows the empty-channels hint when the server has none', () => {
    mount(controller({ channels: [] }));
    expect(document.querySelector('.mobile-empty-body')).not.toBeNull();
  });
});
