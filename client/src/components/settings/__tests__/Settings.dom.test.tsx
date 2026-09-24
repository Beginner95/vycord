// client/src/components/settings/__tests__/Settings.dom.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Settings } from '@/components/Settings';
import { useAuthStore } from '@/stores/authStore';

vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'anna', email: 'anna@example.com', avatar_url: undefined,
      status: 'online', created_at: '', updated_at: '',
      show_last_seen: true, allow_friend_requests: 'everyone', allow_dm_from: 'friends',
    } as never,
  });
});
afterEach(() => { cleanup(); });

describe('Settings modal DOM (desktop parity, снято до VYC-95 этапа 5)', () => {
  it('вкладка «Профиль» по умолчанию', () => {
    render(<Settings isOpen onClose={() => {}} onLogout={() => {}} />);
    expect(document.body.innerHTML).toMatchFileSnapshot('./__snapshots__/Settings.profile.html');
  });
});
