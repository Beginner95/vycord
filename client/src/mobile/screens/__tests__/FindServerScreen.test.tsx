// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { FindServerScreen } from '@/mobile/screens/FindServerScreen';

const h = vi.hoisted(() => ({ invite: false, FOUND: 'Найденный', INVITE: 'Инвайт' }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      searchServers: vi.fn(async () => [{ id: 's9', name: h.FOUND }]),
      previewInvite: vi.fn(async () => {
        if (h.invite) return { server_name: h.INVITE, member_count: 3 };
        throw new Error('404');
      }),
      joinViaInvite: vi.fn(async () => ({ id: 's7', name: h.INVITE })),
    },
  };
});

afterEach(() => { cleanup(); h.invite = false; });

const FOUND = 'Найденный';
const QUERY = 'най';

const mount = () => {
  const p = { onJoinServer: vi.fn(), onServerJoined: vi.fn(), onCreateServer: vi.fn(), onBack: vi.fn() };
  render(<FindServerScreen {...p} />);
  return p;
};
const search = async () => {
  fireEvent.change(document.querySelector('input')!, { target: { value: QUERY } });
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
};

describe('FindServerScreen', () => {
  it('renders the found servers', async () => {
    mount();
    await search();
    expect(document.querySelector('.find-server-row')?.textContent).toContain(FOUND);
  });

  it('calls onBack only from the header back button', () => {
    const p = mount();
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(p.onBack).toHaveBeenCalledTimes(1);
  });

  // Навигацию после входа/создания ведёт событие контроллера / явный push хоста;
  // nav.back() асинхронен и гонялся бы с ними по истории.
  it('does not navigate back after joining a found server', async () => {
    const p = mount();
    await search();
    fireEvent.click(document.querySelector('.find-server-row .btn-primary')!);
    expect(p.onJoinServer).toHaveBeenCalledTimes(1);
    expect(p.onBack).not.toHaveBeenCalled();
  });

  it('does not navigate back after joining by invite', async () => {
    h.invite = true;
    const p = mount();
    await search();
    fireEvent.click(document.querySelector('.find-server-row.is-invite .btn-primary')!);
    await act(async () => {});
    expect(p.onServerJoined).toHaveBeenCalledTimes(1);
    expect(p.onBack).not.toHaveBeenCalled();
  });

  it('does not navigate back on "create own", only asks the host to open it', () => {
    const p = mount();
    fireEvent.click(document.querySelector('.find-server-footer .btn')!);
    expect(p.onCreateServer).toHaveBeenCalledTimes(1);
    expect(p.onBack).not.toHaveBeenCalled();
  });
});
