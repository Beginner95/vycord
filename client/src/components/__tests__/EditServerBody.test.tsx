// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import type { Server } from '@/types';
import { EditServerBody, uploadServerIcon } from '@/components/EditServerBody';
import { useServerStore } from '@/stores/serverStore';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      updateServer: vi.fn(async (id: string, name: string, isPrivate: boolean) => ({ id, name, is_private: isPrivate })),
      setServerGuestLinks: vi.fn(async () => { throw new Error('nope'); }),
      uploadServerIcon: vi.fn(async () => ({ icon_url: '/uploads/new.jpg' })),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const server = { id: 's1', name: 'Стая', is_private: false, guest_links_enabled: true, owner_id: 'u1' } as Server;

const mount = (onDone = vi.fn()) => {
  render(
    <EditServerBody
      server={server}
      onDone={onDone}
      onCropFile={vi.fn()}
      renderActions={({ saving }) => (
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>ok</button>
        </div>
      )}
    />,
  );
  return onDone;
};

describe('EditServerBody', () => {
  it('saves the trimmed name and the privacy flag, then finishes', async () => {
    const onDone = mount();
    fireEvent.change(document.querySelector('#edit-server-name')!, { target: { value: '  Новая стая  ' } });
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(apiService.updateServer).toHaveBeenCalledWith('s1', 'Новая стая', true);
    expect(onDone).toHaveBeenCalled();
  });

  it('puts the guest-links toggle back and shows the error when the request fails', async () => {
    mount();
    const guest = document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
    expect(guest.checked).toBe(true);
    fireEvent.click(guest);
    await act(async () => {});
    expect(apiService.setServerGuestLinks).toHaveBeenCalledWith('s1', false);
    expect((document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked).toBe(true);
    expect(document.querySelector('.modal-error')).not.toBeNull();
  });

  it('hands a chosen icon file to the caller instead of cropping it itself', () => {
    const onCropFile = vi.fn();
    render(
      <EditServerBody server={server} onDone={vi.fn()} onCropFile={onCropFile} renderActions={() => null} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'i.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onCropFile).toHaveBeenCalledWith(file);
    expect(document.querySelector('.avatar-crop-modal')).toBeNull();
  });

  it('rejects a file of the wrong type without handing it to the caller', () => {
    const onCropFile = vi.fn();
    render(
      <EditServerBody server={server} onDone={vi.fn()} onCropFile={onCropFile} renderActions={() => null} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'i.gif', { type: 'image/gif' })] } });
    expect(onCropFile).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-error')).not.toBeNull();
  });

  it('uploadServerIcon sends the blob and patches the store with the new icon', async () => {
    const patch = vi.spyOn(useServerStore.getState(), 'patchServer');
    const blob = new Blob(['x']);
    await uploadServerIcon('s1', blob);
    expect(apiService.uploadServerIcon).toHaveBeenCalledWith('s1', blob);
    expect(patch).toHaveBeenCalledWith('s1', { icon_url: '/uploads/new.jpg' });
    patch.mockRestore();
  });
});
