// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { AddFriendForm } from '@/components/AddFriendForm';
import { apiService } from '@/services/api';

vi.mock('@/services/api', () => ({
  apiService: {
    sendFriendRequest: vi.fn(),
  },
  apiErrorText: () => 'err',
}));

vi.mock('@/stores/friendStore', () => ({
  useFriendStore: (selector: (s: { load: () => Promise<void> }) => unknown) =>
    selector({ load: vi.fn().mockResolvedValue(undefined) }),
}));

describe('AddFriendForm', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(apiService.sendFriendRequest).mockReset();
  });

  it('ввод, похожий на номер, уходит как { phone }', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'Анна' }, created_at: '' } });

    const { getByPlaceholderText, getByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: '89123456789' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    expect(apiService.sendFriendRequest).toHaveBeenCalledWith({ phone: '89123456789' });
  });

  it('обычный ввод уходит как { username }', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'anna' }, created_at: '' } });

    const { getByPlaceholderText, getByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: 'anna' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    expect(apiService.sendFriendRequest).toHaveBeenCalledWith({ username: 'anna' });
  });

  it('после успеха показывает имя найденного пользователя', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'Анна' }, created_at: '' } });

    const { getByPlaceholderText, getByRole, findByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: '89123456789' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    const msg = await findByRole('status');
    expect(msg.textContent).toContain('Анна');
  });
});