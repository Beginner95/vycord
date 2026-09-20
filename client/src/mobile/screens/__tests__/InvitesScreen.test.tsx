// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvitesScreen } from '@/mobile/screens/InvitesScreen';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listInvites: vi.fn(async () => [{ code: 'OLD', server_id: 's1', uses: 3, created_by: 'u1' }]),
      createInvite: vi.fn(async () => ({ code: 'NEW', server_id: 's1', uses: 0, created_by: 'u1' })),
      revokeInvite: vi.fn(async () => {}),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <InvitesScreen serverId="s1" onBack={vi.fn()} />
  </MemoryRouter>,
);

describe('InvitesScreen', () => {
  it('lists the server invites', async () => {
    mount();
    await act(async () => {});
    expect(document.querySelector('.invites-code')?.textContent).toBe('OLD');
  });

  it('creates a link from the bottom button and puts it first', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.form-screen-actions .btn-primary')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledWith('s1');
    expect(document.querySelectorAll('.invites-code')[0].textContent).toBe('NEW');
  });

  it('creates a link on the first copy from the «invite friends» card', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.invite-friends-card .btn')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('NEW');
    // Второе нажатие переиспользует уже созданную ссылку.
    fireEvent.click(document.querySelector('.invite-friends-card .btn')!);
    await act(async () => {});
    expect(apiService.createInvite).toHaveBeenCalledTimes(1);
  });

  it('revokes a link and drops its row', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.invites-actions .panel-icon-btn.is-danger')!);
    await act(async () => {});
    expect(apiService.revokeInvite).toHaveBeenCalledWith('s1', 'OLD');
    expect(document.querySelector('.invites-code')).toBeNull();
  });
});
