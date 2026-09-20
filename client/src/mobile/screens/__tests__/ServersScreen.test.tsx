// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PermissionSet } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import { useServerStore } from '@/stores/serverStore';
import { ServersScreen } from '@/mobile/screens/ServersScreen';
import { __setActivityOverride } from '@/mobile/activity';
import { controller, nav, ch, s1, s2 } from './fixtures';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteServer: vi.fn(async () => {}) } };
});
import { apiService } from '@/services/api';

afterEach(() => { vi.useRealTimers(); __setActivityOverride(null); cleanup(); });

const mount = (c: AppController, n: MobileNav = nav()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ServersScreen ctx={{ c, nav: n, joinVoice: vi.fn() }} />
  </MemoryRouter>,
);

const PRIVATE_LABEL = 'Приватный сервер';
const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });
beforeEach(() => {
  vi.mocked(apiService.deleteServer).mockReset().mockResolvedValue(undefined);
  useServerStore.setState({ permissions: new Map([['s1', perms(0n, true)]]) });
});

describe('ServersScreen', () => {
  it('renders one row per server with its name', () => {
    mount(controller());
    const rows = [...document.querySelectorAll('.mobile-row')];
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.mobile-row-title')?.textContent).toContain('Волчья стая');
  });

  it('opens the channels screen on tap', () => {
    const n = nav();
    mount(controller(), n);
    fireEvent.click(document.querySelectorAll('.mobile-row')[1]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'channels', serverId: 's2' });
  });

  it('shows who is in voice on the current server only', () => {
    mount(controller({ voiceParticipants: new Map([['c1', ['u2', 'u3', 'u4', 'u5']]]) }));
    const subs = [...document.querySelectorAll('.mobile-row-sub')].map((n) => n.textContent);
    expect(subs[0]).toContain('Борис');
    expect(subs[0]).toContain('+2');
    // У чужого сервера данных о голосе нет — ничего не выдумываем.
    expect(document.querySelectorAll('.mobile-row')[1].querySelector('.mobile-row-sub')).toBeNull();
  });

  it('falls back to the activity preview when nobody is in voice', () => {
    __setActivityOverride((id) => (id === 's1'
      ? { preview: { authorName: 'Аня', kind: 'text', text: 'привет' }, timestamp: null, unreadCount: 3, hasUnread: true }
      : null));
    mount(controller());
    expect(document.querySelector('.mobile-row-sub')?.textContent).toBe('Аня: привет');
    expect(document.querySelector('.activity-badge')?.textContent).toBe('3');
  });

  it('never shows another server\'s voice while channels still belong to the previous server', () => {
    // handleSelectServer: currentServer already s2, channels still the s1 ones.
    mount(controller({
      currentServer: s2,
      channels: [ch],
      voiceParticipants: new Map([['c1', ['u2', 'u3']]]),
    }));
    expect(document.querySelectorAll('.mobile-row').length).toBe(2);
    expect(document.querySelectorAll('.mobile-row-sub').length).toBe(0);
  });

  const longPress = async (row: Element) => {
    vi.useFakeTimers();
    fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
    await act(async () => { vi.advanceTimersByTime(450); });
    vi.useRealTimers();
    await act(async () => {});
  };

  it('opens the server menu on long press and swallows the trailing click', async () => {
    const n = nav();
    mount(controller(), n);
    const row = document.querySelectorAll('.mobile-row')[0];
    await longPress(row);
    expect(document.querySelector('.sheet')).not.toBeNull();
    fireEvent.click(row);
    expect(n.push).not.toHaveBeenCalled();
  });

  describe('server menu wiring', () => {
    const openMenu = async (n: MobileNav, c = controller()) => {
      mount(c, n);
      await longPress(document.querySelectorAll('.mobile-row')[0]);
      return [...document.querySelectorAll('.action-sheet-item')];
    };

    it.each([
      [0, 'invites'],
      [1, 'serverSettings'],
      [2, 'stickers'],
    ])('item %i navigates to %s', async (index, kind) => {
      const n = nav();
      const items = await openMenu(n);
      fireEvent.click(items[index]);
      await act(async () => {});
      expect(n.push).toHaveBeenCalledWith({ kind, serverId: 's1' });
    });

    it('reports a confirmed delete through c.serverRemoved', async () => {
      const n = nav();
      const c = controller();
      const items = await openMenu(n, c);
      fireEvent.click(items.find((b) => b.classList.contains('is-danger'))!);
      await act(async () => {});
      fireEvent.click(document.querySelector('.confirm-modal .btn-danger') as HTMLButtonElement);
      await act(async () => {});
      expect(apiService.deleteServer).toHaveBeenCalledWith('s1');
      expect(c.serverRemoved).toHaveBeenCalledWith('s1');
    });
  });

  it('marks only private servers with a labelled lock', () => {
    mount(controller());
    const rows = document.querySelectorAll('.mobile-row');
    expect(rows[0].querySelector('svg[role="img"]')).toBeNull();
    expect(rows[1].querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(PRIVATE_LABEL);
  });

  it('renders an image avatar when the server has an icon and the initial otherwise', () => {
    const withIcon = { ...s1, icon_url: '/uploads/x.png' };
    mount(controller({ servers: [withIcon, s2], currentServer: withIcon }));
    const rows = document.querySelectorAll('.mobile-row');
    expect(rows[0].querySelector('img.server-avatar')).not.toBeNull();
    expect(rows[1].querySelector('img')).toBeNull();
    expect(rows[1].querySelector('span.server-avatar')?.textContent).toBe('Т');
  });

  it('offers create and find from the header «+»', async () => {
    const n = nav();
    mount(controller(), n);
    fireEvent.click(document.querySelector('.screen-header-actions button')!);
    await act(async () => {});
    const items = [...document.querySelectorAll('.action-sheet-item')];
    expect(items.length).toBe(2);
    fireEvent.click(items[1]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'findServer' });
  });

  it('shows the empty card with both buttons when there are no servers', () => {
    const n = nav();
    mount(controller({ servers: [], currentServer: null }), n);
    expect(document.querySelectorAll('.mobile-row').length).toBe(0);
    const buttons = [...document.querySelectorAll('.mobile-empty .btn')];
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'createServer' });
  });
});
