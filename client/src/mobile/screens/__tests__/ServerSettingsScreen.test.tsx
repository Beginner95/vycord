// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server } from '@/types';
import { ServerSettingsScreen } from '@/mobile/screens/ServerSettingsScreen';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      updateServer: vi.fn(async (id: string, name: string, isPrivate: boolean) => ({ id, name, is_private: isPrivate })),
    },
  };
});
import { apiService } from '@/services/api';

beforeAll(() => {
  // jsdom не реализует URL.createObjectURL, а окно кропа зовёт его при монтировании.
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
});
afterEach(cleanup);

const server = { id: 's1', name: 'Pack', is_private: false, guest_links_enabled: true, owner_id: 'u1' } as Server;

const mount = (onBack = vi.fn()) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <ServerSettingsScreen server={server} onBack={onBack} />
    </MemoryRouter>,
  );
  return onBack;
};

describe('ServerSettingsScreen', () => {
  it('does not steal focus into the name field on entry (the keyboard would cover the toggles)', () => {
    mount();
    expect(document.activeElement).not.toBe(document.querySelector('#edit-server-name'));
  });

  it('renders its single primary button inside the form, with no cancel button', () => {
    mount();
    expect(document.querySelectorAll('form .form-screen-actions .btn')).toHaveLength(1);
    expect(document.querySelector('form .form-screen-actions .btn-primary')).not.toBeNull();
    expect(document.querySelector('.modal-actions')).toBeNull();
  });

  it('saves and goes back', async () => {
    const onBack = mount();
    fireEvent.change(document.querySelector('#edit-server-name')!, { target: { value: 'Pack2' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(apiService.updateServer).toHaveBeenCalledWith('s1', 'Pack2', false);
    expect(onBack).toHaveBeenCalled();
  });

  it('mounts the crop modal itself over the screen and closes it on cancel', async () => {
    mount();
    expect(document.querySelector('.avatar-crop-modal')).toBeNull();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 'i.png', { type: 'image/png' })] },
    });
    await act(async () => {});
    const crop = document.querySelector('.avatar-crop-modal');
    expect(crop).not.toBeNull();
    // Кроп — вне FormScreen: сестра экрана, а не потомок тела формы.
    expect(document.querySelector('.form-screen')!.contains(crop)).toBe(false);
    fireEvent.click(crop!.querySelector('.modal-actions .btn-secondary')!);
    expect(document.querySelector('.avatar-crop-modal')).toBeNull();
  });
});
