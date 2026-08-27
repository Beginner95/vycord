// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { apiService } from '@/services/api';
import { useAttachmentStore } from '@/stores/attachmentStore';
import { useAttachmentUpload } from '@/hooks/useAttachmentUpload';

describe('useAttachmentUpload', () => {
  beforeEach(() => {
    // Стор — синглтон zustand, тесты внутри файла делят его состояние.
    useAttachmentStore.getState().clear('chan-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('файл больше лимита не уходит на сервер', () => {
    const spy = vi.spyOn(apiService, 'uploadAttachment');
    const { result } = renderHook(() => useAttachmentUpload('chan-1'));

    act(() => {
      result.current.addFiles([new File([new Uint8Array(26 * 1024 * 1024)], 'big.bin')]);
    });

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.drafts[0].errorCode).toBe('attachment_too_large');
  });

  it('повтор файла больше лимита тоже не уходит на сервер', () => {
    // Ровно тот дефект, который поймало ревью Task 16: кнопка «Повторить» на
    // таком чипе отправляла файл, и пользователь упирался в обрыв nginx.
    const spy = vi.spyOn(apiService, 'uploadAttachment');
    const { result } = renderHook(() => useAttachmentUpload('chan-1'));

    act(() => {
      result.current.addFiles([new File([new Uint8Array(26 * 1024 * 1024)], 'big.bin')]);
    });
    const localId = result.current.drafts[0].localId;

    act(() => { result.current.retry(localId); });

    expect(spy).not.toHaveBeenCalled();
    expect(result.current.drafts[0].errorCode).toBe('attachment_too_large');
  });

  it('для канала без черновиков селектор отдаёт стабильную ссылку и не зацикливает рендер', () => {
    // Регресс на дефект: `s.drafts.get(channelId) ?? []` создавал новый
    // массив при каждом вызове селектора. Zustand v5 сравнивает снимок по
    // ссылке через useSyncExternalStore, и под настоящим React это уходило
    // в бесконечную перерисовку прямо на монтировании — до появления тестов
    // с jsdom хук никто не рендерил, и дефект был невидим.
    const { result, rerender } = renderHook(() => useAttachmentUpload('chan-empty'));
    const first = result.current.drafts;

    rerender();

    expect(result.current.drafts).toBe(first);
  });
});
