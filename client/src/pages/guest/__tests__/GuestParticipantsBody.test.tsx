// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { GuestParticipantsBody } from '../GuestParticipantsBody';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';

beforeEach(() => {
  useGuestCallStore.setState({
    guestId: 'g1',
    participants: {
      users: [{ user_id: 'u2', username: 'boris', avatar_url: undefined }],
      guests: [{ id: 'g1', display_name: 'Аня' }],
    },
  } as never);
});
afterEach(() => {
  cleanup();
  useGuestCallStore.getState().reset();
  useCallStore.getState().reset();
});

describe('GuestParticipantsBody', () => {
  // Бейдж «вы» на собственной строке гостя здесь намеренно НЕ проверяется: он
  // сейчас не рендерится вовсе (isSelf сравнивает `guest:${guestId}` с id без
  // префикса) — известный дефект, унаследованный от десктопной GuestCallView,
  // см. спеку 2026-09-20-mobile-redesign-design.md, «Этап 6 — отложено».
  // it.todo ниже — место для проверки после того фикса.
  it('показывает строку гостя и второго участника', () => {
    render(<GuestParticipantsBody />);
    expect(screen.getByText('Аня')).toBeTruthy();
    expect(screen.getByText('boris')).toBeTruthy();
  });

  it.todo('помечает собственную строку гостя бейджем «вы» (после фикса isSelf, см. «Этап 6 — отложено»)');
});
