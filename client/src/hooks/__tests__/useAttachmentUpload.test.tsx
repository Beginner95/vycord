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

  it('clearSent убирает отправленное и оставляет чип с ошибкой', async () => {
    // Дефект финального ревью: uploads.clear() после успешной отправки стирал
    // ВСЕ черновики канала. Приложил два файла, один не прошёл по размеру,
    // отправил — и не прошедший исчезал без следа.
    const uploaded = {
      id: 'att-1', channel_id: 'chan-1', user_id: 'u', kind: 'file' as const,
      file_name: 'ok.txt', content_type: 'text/plain', size_bytes: 3,
      url: '/api/v1/attachments/att-1/content', created_at: '2026-08-27T10:00:00Z',
    };
    vi.spyOn(apiService, 'uploadAttachment').mockReturnValue({
      promise: Promise.resolve(uploaded),
      abort: () => {},
    });

    const { result } = renderHook(() => useAttachmentUpload('chan-1'));

    await act(async () => {
      result.current.addFiles([
        new File(['ok'], 'ok.txt'),
        new File([new Uint8Array(26 * 1024 * 1024)], 'big.bin'),
      ]);
    });

    expect(result.current.readyIds).toEqual(['att-1']);

    act(() => { result.current.clearSent(result.current.readyIds); });

    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].file.name).toBe('big.bin');
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
