// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { StickersScreen } from '@/mobile/screens/StickersScreen';
import { MemoryRouter } from 'react-router-dom';

const WOLF = 'волк';
const FOX = 'лиса';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => [{ id: 'st1', name: WOLF, image_url: '/u/1.png' }]),
      uploadSticker: vi.fn(async () => ({ id: 'st2', name: FOX, image_url: '/u/2.png' })),
      deleteSticker: vi.fn(async () => {}),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // jsdom не реализует URL.createObjectURL: тело зовёт его для превью файла.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

const mount = (onBack = vi.fn(), onStickersChanged = vi.fn()) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <StickersScreen serverId="s1" onBack={onBack} onStickersChanged={onStickersChanged} />
    </MemoryRouter>,
  );
  return { onBack, onStickersChanged };
};

describe('StickersScreen', () => {
  it('lists the server stickers', async () => {
    mount();
    await act(async () => {});
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(1);
  });

  it('renders the body inside the form screen with the stickers title and no bottom action bar (D5)', async () => {
    mount();
    await act(async () => {});
    expect(document.querySelector('.form-screen-body .stickers-screen .sticker-dropzone')).not.toBeNull();
    expect(document.querySelector('.form-screen-actions')).toBeNull();
    expect(document.querySelector('.screen-header')?.textContent).toContain('Стикеры сервера');
  });

  it('uploads only when both a name and a file are present', async () => {
    const { onStickersChanged } = mount();
    await act(async () => {});
    // Без файла блока превью с кнопкой «Загрузить» вообще нет.
    expect(document.querySelector('.sticker-preview-info')).toBeNull();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 's.png', { type: 'image/png' })] },
    });
    await act(async () => {});
    const upload = document.querySelector('.sticker-preview-info .btn-primary') as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    fireEvent.change(document.querySelector('input.input')!, { target: { value: FOX } });
    await act(async () => {});
    fireEvent.click(document.querySelector('.sticker-preview-info .btn-primary')!);
    await act(async () => {});
    expect(apiService.uploadSticker).toHaveBeenCalled();
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(2);
    expect(onStickersChanged).toHaveBeenCalledTimes(1);
    // Успех сбрасывает форму: блок превью исчез, имя очищено.
    expect(document.querySelector('.sticker-preview-info')).toBeNull();
    expect((document.querySelector('input.input') as HTMLInputElement).value).toBe('');
  });

  it('deletes a sticker only after confirmation', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await act(async () => {});
    expect(apiService.deleteSticker).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal .btn-danger, .confirm-modal .btn-primary') as HTMLButtonElement);
    await act(async () => {});
    expect(apiService.deleteSticker).toHaveBeenCalledWith('s1', 'st1');
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(0);
    expect(document.querySelector('.confirm-modal')).toBeNull();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    mount();
    await act(async () => {});
    fireEvent.click(document.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary')!);
    await act(async () => {});
    expect(apiService.deleteSticker).not.toHaveBeenCalled();
    expect(document.querySelector('.confirm-modal')).toBeNull();
    expect(document.querySelectorAll('.sticker-manager-item').length).toBe(1);
  });

  it('a wrong file type shows the error toast and does not create a preview', async () => {
    mount();
    await act(async () => {});
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
    });
    await act(async () => {});
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(document.querySelector('.sticker-preview-info')).toBeNull();
  });
});
