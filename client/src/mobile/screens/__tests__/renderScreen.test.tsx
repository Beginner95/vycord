// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// themeStore читает matchMedia в момент импорта (SearchScreen тянет его через
// renderScreen), а jsdom его не определяет.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
import { MemoryRouter } from 'react-router-dom';
import { renderScreen } from '@/mobile/screens/renderScreen';
import { controller, nav } from './fixtures';

const SEARCH_IN = 'Искать в канале #общий';

afterEach(cleanup);

const show = (screen: Parameters<typeof renderScreen>[0], c = controller()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    {renderScreen(screen, { c, nav: nav(), joinVoice: vi.fn() })}
  </MemoryRouter>,
);

describe('renderScreen (stage 2)', () => {
  it('mounts the mobile servers screen, not the desktop rail', () => {
    show({ kind: 'servers' });
    expect(document.querySelector('.servers-screen')).not.toBeNull();
    expect(document.querySelector('.server-list')).toBeNull();
  });

  it('mounts the mobile channels screen, not the desktop sidebar', () => {
    show({ kind: 'channels', serverId: 's1' });
    expect(document.querySelector('.channels-screen')).not.toBeNull();
    expect(document.querySelector('.channel-sidebar')).toBeNull();
  });

  it('«create own» on the find screen REPLACES it with the create screen (no stale find entry in history)', () => {
    const n = nav();
    const stack = [{ kind: 'servers' }, { kind: 'findServer' }] as const;
    render(
      <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: stack, b: 1 } }]}>
        {renderScreen({ kind: 'findServer' }, { c: controller(), nav: { ...n, stack }, joinVoice: vi.fn() })}
      </MemoryRouter>,
    );
    fireEvent.click(document.querySelector('.find-server-footer .btn')!);
    expect(n.replaceStack).toHaveBeenCalledWith([{ kind: 'servers' }, { kind: 'createServer' }]);
    expect(n.push).not.toHaveBeenCalled();
  });

  it.each([
    ['createServer', {}],
    ['findServer', {}],
    ['serverSettings', { serverId: 's1' }],
    ['invites', { serverId: 's1' }],
    ['stickers', { serverId: 's1' }],
  ])('mounts a full-screen form for %s', (kind, extra) => {
    show({ kind, ...extra } as never);
    expect(document.querySelector('.form-screen')).not.toBeNull();
    expect(document.querySelector('.mobile-screen-loading')).toBeNull();
  });

  it('serverSettings resolves the server from the list, independent of currentServer', () => {
    show({ kind: 'serverSettings', serverId: 's2' }, controller({ currentServer: null }));
    expect(document.querySelector('.form-screen')).not.toBeNull();
  });

  it('serverSettings for an unknown server shows the loading stub', () => {
    show({ kind: 'serverSettings', serverId: 'nope' });
    expect(document.querySelector('.form-screen')).toBeNull();
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
  });

  it('still falls back to the stub for screens of later stages', () => {
    show({ kind: 'friendAdd' });
    expect(document.querySelector('.mobile-screen-loading')).not.toBeNull();
  });

  it('search renders the search screen; channelId is the chat directly below it', () => {
    const c = controller();
    const search = { kind: 'search' } as const;
    const stack = [{ kind: 'servers' }, { kind: 'chat', channelId: 'c1' }, search] as const;
    const n = { ...nav(), stack, top: search };
    render(
      <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
        {renderScreen(search, { c, nav: n, joinVoice: vi.fn() })}
      </MemoryRouter>,
    );
    expect(document.querySelector('.search-screen')).not.toBeNull();
    // Под search лежит чат c1 → доступна «искать в канале».
    expect(document.body.textContent).toContain(SEARCH_IN);
  });
});
