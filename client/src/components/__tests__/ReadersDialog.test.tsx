// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/services/api', async (orig) => ({
  ...(await orig<typeof import('@/services/api')>()),
  apiService: { getMessageReaders: vi.fn() },
}));

import { apiService } from '@/services/api';
import { ReadersDialog } from '../ReadersDialog';
import { canViewReaders } from '@/utils/readers';
import { useLocaleStore } from '@/stores/localeStore';
import { PERMISSIONS } from '@/utils/permissions';
import type { Message } from '@/types';

const api = vi.mocked(apiService);
beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); api.getMessageReaders.mockReset(); });
afterEach(cleanup);

describe('ReadersDialog', () => {
  it('loads and splits the list', async () => {
    api.getMessageReaders.mockResolvedValue({ read: [{ user_id: 'u2', username: 'boris' }], unread: [] });
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={vi.fn()} />);
    expect(document.body.textContent).toContain('Загрузка…');
    await waitFor(() => expect(document.body.textContent).toContain('Прочитали · 1'));
    expect(document.body.textContent).toContain('boris');
    expect(document.body.textContent).toContain('Не прочитали · 0');
    expect(document.body.textContent).toContain('Никого');
    expect(api.getMessageReaders).toHaveBeenCalledWith('c1', 'm1');
  });

  it('shows an error state', async () => {
    api.getMessageReaders.mockRejectedValue(new Error('403'));
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toContain('Не удалось загрузить список'));
  });

  it('closes on the close button', () => {
    api.getMessageReaders.mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    render(<ReadersDialog channelId="c1" messageId="m1" onClose={onClose} />);
    fireEvent.click(document.querySelector('.modal-close-btn')!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('canViewReaders', () => {
  const base: Message = { id: 'm', channel_id: 'c', user_id: 'me', content: 'x', kind: 'user', created_at: 't', updated_at: 't' };
  it('author, admin, owner — yes; others, guests, calls — no', () => {
    expect(canViewReaders(base, 'me', undefined)).toBe(true);
    expect(canViewReaders(base, 'u2', undefined)).toBe(false);
    expect(canViewReaders(base, 'u2', { isOwner: false, bits: PERMISSIONS.ADMINISTRATOR, highestPosition: 1 })).toBe(true);
    expect(canViewReaders(base, 'u2', { isOwner: true, bits: 0n, highestPosition: 1 })).toBe(true);
    expect(canViewReaders({ ...base, user_id: null, guest: { id: 'g', display_name: 'G' } }, 'me', { isOwner: true, bits: 0n, highestPosition: 1 })).toBe(false);
    expect(canViewReaders({ ...base, kind: 'call' }, 'me', undefined)).toBe(false);
  });
});
