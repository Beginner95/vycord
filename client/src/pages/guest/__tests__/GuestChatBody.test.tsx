// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { GuestChatBody } from '../GuestChatBody';
import { useGuestCallStore } from '@/stores/guestCallStore';

beforeAll(() => {
  // jsdom не реализует scrollTo — как и в GuestCallView.dom.test.tsx.
  Element.prototype.scrollTo = vi.fn();
});

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    preview: { server_name: 's', channel_name: 'general', participant_count: 1 },
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
    messages: [{
      id: 'm1', content: 'привет всем', created_at: '2026-09-23T10:00:00Z',
      author: { kind: 'guest', guest_id: 'g1', display_name: 'Аня' },
    }],
    chatUnread: 0,
  } as never);
});
afterEach(() => { cleanup(); useGuestCallStore.getState().reset(); });

describe('GuestChatBody', () => {
  it('показывает сообщение из стора', () => {
    render(<GuestChatBody />);
    expect(screen.getByText('привет всем')).toBeTruthy();
  });
});
