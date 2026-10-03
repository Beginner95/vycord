// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ServerList } from '../ServerList';
import { useUnreadStore } from '@/stores/unreadStore';
import { useLocaleStore } from '@/stores/localeStore';
import type { Server } from '@/types';

vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), apiService: {} }));

const srv = (id: string): Server => ({ id, name: id.toUpperCase(), owner_id: 'o' } as Server);
const mount = () => render(
  <ServerList servers={[srv('s1'), srv('s2')]} currentServer={null} user={null} onSelectServer={vi.fn()}
    onCreateServer={vi.fn()} onOpenFindServer={vi.fn()} onServerDeleted={vi.fn()} onSelectHome={vi.fn()} pendingCount={0} />,
);

beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  useUnreadStore.setState({
    channels: {
      a: { serverId: 's1', count: 3, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
      b: { serverId: 's1', count: 7, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
      c: { serverId: 's2', count: 0, cursor: { at: '2026-10-03T10:00:00Z', id: null } },
    },
  });
});
afterEach(cleanup);

describe('ServerList unread badge', () => {
  it('shows the sum of channel counters, hides zero', () => {
    mount();
    const badges = document.querySelectorAll(".server-icon[title='S1'] .server-icon-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('10');
    expect(badges[0].getAttribute('aria-label')).toBe('Непрочитанных: 10');
    expect(document.querySelector(".server-icon[title='S2'] .server-icon-badge")).toBeNull();
  });

  it('caps at 99+', () => {
    useUnreadStore.setState((s) => ({ channels: { ...s.channels, a: { ...s.channels.a, count: 100 } } }));
    mount();
    expect(document.querySelector(".server-icon[title='S1'] .server-icon-badge")?.textContent).toBe('99+');
  });
});
