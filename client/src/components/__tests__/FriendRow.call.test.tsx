// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FriendRow } from '@/components/FriendRow';

const user = { user_id: 'bob', username: 'bob' };

describe('FriendRow: звонок', () => {
  afterEach(cleanup);

  it('кнопка есть при onCall и вызывает его', () => {
    const onCall = vi.fn();
    render(<FriendRow user={user} online onCall={onCall} />);
    fireEvent.click(screen.getByRole('button', { name: /позвонить|call/i }));
    expect(onCall).toHaveBeenCalled();
  });

  it('без onCall кнопки нет', () => {
    render(<FriendRow user={user} online />);
    expect(screen.queryByRole('button', { name: /позвонить|call/i })).toBeNull();
  });
});
