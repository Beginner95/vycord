import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: {
    createGuestLink: vi.fn(async () => ({ id: 'l1', secret: 's3cr3t', expires_at: '2026-09-18T00:00:00Z' })),
    listGuestLinks: vi.fn(async () => ({ links: [], guests: [] })),
    revokeGuestLink: vi.fn(async () => {}),
    admitGuest: vi.fn(async () => {}),
    rejectGuest: vi.fn(async () => {}),
    kickGuest: vi.fn(async () => {}),
  },
}));
vi.mock('@/services/callCredentials', () => ({ publicWebUrl: () => 'https://front.example' }));

import { apiService } from '@/services/api';
import { useGuestManagementStore } from '../guestManagementStore';

beforeEach(() => {
  useGuestManagementStore.getState().reset();
  vi.clearAllMocks();
});

describe('guestManagementStore', () => {
  it('builds the link from the secret and keeps the secret out of the list', async () => {
    const created = await useGuestManagementStore.getState().createLink('ch1');
    expect(created?.url).toBe('https://front.example/guest#s3cr3t');
    expect(JSON.stringify(useGuestManagementStore.getState().links)).not.toContain('s3cr3t');
  });

  it('tracks lobby requests without duplicates', () => {
    const s = useGuestManagementStore.getState();
    s.onLobbyRequest({ channel_id: 'ch1', guest_id: 'g1', display_name: 'Вася', link_id: 'l1' });
    s.onLobbyRequest({ channel_id: 'ch1', guest_id: 'g1', display_name: 'Вася', link_id: 'l1' });
    expect(useGuestManagementStore.getState().lobby).toHaveLength(1);

    s.onLobbyResolved({ channel_id: 'ch1', guest_id: 'g1', result: 'admitted' });
    expect(useGuestManagementStore.getState().lobby).toHaveLength(0);
  });

  it('kicks with the ban flag', async () => {
    useGuestManagementStore.setState({
      guests: [{ id: 'g1', link_id: 'l1', channel_id: 'ch1', display_name: 'Вася', status: 'admitted', banned: false, created_at: '' }],
    });
    await useGuestManagementStore.getState().kick('g1', true);
    expect(apiService.kickGuest).toHaveBeenCalledWith('g1', true);
    expect(useGuestManagementStore.getState().guests).toHaveLength(0);
  });
});
