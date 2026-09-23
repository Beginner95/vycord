// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { GuestParticipantsScreen } from '../GuestParticipantsScreen';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1',
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
  } as never);
});
afterEach(() => {
  cleanup();
  useGuestCallStore.getState().reset();
  useCallStore.getState().reset();
});

describe('GuestParticipantsScreen', () => {
  it('заголовок «Участники» и строка себя', () => {
    const onBack = vi.fn();
    render(<GuestParticipantsScreen onBack={onBack} />);
    expect(screen.getByText('Участники')).toBeTruthy();
    expect(screen.getByText('Аня')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(onBack).toHaveBeenCalled();
  });
});
