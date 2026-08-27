import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiService } from '@/services/api';
import { ACCESS_TOKEN_KEY } from '@/stores/authStore';

// XMLHttpRequest используется вместо fetch ради прогресса отправки — у fetch
// его нет, а без прогресса на 25 МБ пользователь смотрит в пустой экран.
class FakeXHR {
  static last: FakeXHR;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  aborted = false;
  headers: Record<string, string> = {};
  method = '';
  url = '';

  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {}
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

describe('uploadAttachment', () => {
  beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('отправляет файл и channel_id, отдаёт разобранный ответ', async () => {
    const handle = apiService.uploadAttachment('chan-1', new File(['data'], 'pic.png', { type: 'image/png' }), {});

    const xhr = FakeXHR.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/v1/attachments');
    expect(xhr.headers['Authorization']).toBe('Bearer test-token');

    xhr.status = 201;
    xhr.responseText = JSON.stringify({ id: 'att-1', kind: 'image', file_name: 'pic.png' });
    xhr.onload?.();

    await expect(handle.promise).resolves.toMatchObject({ id: 'att-1', kind: 'image' });
  });

  it('сообщает прогресс отправки', async () => {
    const onProgress = vi.fn();
    const handle = apiService.uploadAttachment('chan-1', new File(['data'], 'a.bin'), { onProgress });

    const xhr = FakeXHR.last;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 } as ProgressEvent);

    expect(onProgress).toHaveBeenCalledWith(25);

    xhr.status = 201;
    xhr.responseText = '{"id":"a"}';
    xhr.onload?.();
    await handle.promise;
  });

  it('превращает код ошибки сервера в ApiError с этим кодом', async () => {
    const handle = apiService.uploadAttachment('chan-1', new File(['x'], 'big.bin'), {});

    const xhr = FakeXHR.last;
    xhr.status = 413;
    xhr.responseText = JSON.stringify({ error: 'file is too large', code: 'attachment_too_large' });
    xhr.onload?.();

    await expect(handle.promise).rejects.toMatchObject({ code: 'attachment_too_large', status: 413 });
  });

  it('abort отменяет запрос и отклоняет промис', async () => {
    const handle = apiService.uploadAttachment('chan-1', new File(['x'], 'a.bin'), {});

    handle.abort();

    expect(FakeXHR.last.aborted).toBe(true);
    await expect(handle.promise).rejects.toBeTruthy();
  });
});
