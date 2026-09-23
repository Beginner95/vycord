// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GuestChatScreen } from '../GuestChatScreen';
import { useGuestCallStore } from '@/stores/guestCallStore';

beforeAll(() => {
  // jsdom не реализует scrollTo — как и в GuestChatBody.test.tsx.
  Element.prototype.scrollTo = vi.fn();
});

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    participants: { users: [], guests: [] },
    messages: [], chatUnread: 0,
  } as never);
});
afterEach(() => { cleanup(); useGuestCallStore.getState().reset(); });

describe('GuestChatScreen', () => {
  it('заголовок «Чат» и кнопка назад', () => {
    const onBack = vi.fn();
    render(<GuestChatScreen onBack={onBack} />);
    expect(screen.getByText('Чат')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(onBack).toHaveBeenCalled();
  });
});
