// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactorsSheet } from '../ReactorsSheet';
import { useLocaleStore } from '@/stores/localeStore';
import { ru } from '@/i18n/locales/ru';
import type { MemberWithUser } from '@/types';

beforeEach(() => useLocaleStore.setState({ locale: 'ru' }));
afterEach(cleanup);

describe('ReactorsSheet', () => {
  it('lists everyone who reacted, unknown ids dropped', () => {
    const members = [{ user_id: 'a', username: 'аня' }] as unknown as MemberWithUser[];
    render(<MemoryRouter><ReactorsSheet reaction={{ key: '👍', emoji: '👍', count: 2, user_ids: ['a', '12345678-aaaa'] }} members={members} onClose={vi.fn()} /></MemoryRouter>);
    const items = Array.from(document.querySelectorAll('.reactors-sheet-item')).map((el) => el.textContent);
    expect(items).toEqual(['аня']);
    expect(document.body.textContent).toContain(ru.chat.reactionsTitle);
  });

  it('renders nothing without a reaction', () => {
    render(<ReactorsSheet reaction={null} members={[]} onClose={vi.fn()} />);
    expect(document.querySelector('.reactors-sheet-item')).toBeNull();
  });
});
