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
  body: unknown = null;

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
  send(body?: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

describe('uploadAttachment', () => {
  beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    // По умолчанию getFreshAccessToken возвращает текущий токен
    // (успешно обновляет его или просто возвращает текущий).
    vi.spyOn(apiService, 'getFreshAccessToken').mockResolvedValue('test-token');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('отправляет файл и channel_id, отдаёт разобранный ответ', async () => {
    const file = new File(['data'], 'pic.png', { type: 'image/png' });
    const handle = apiService.uploadAttachment('chan-1', file, {});

    await Promise.resolve();
    await Promise.resolve();

    const xhr = FakeXHR.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/api/v1/attachments');
    expect(xhr.headers['Authorization']).toBe('Bearer test-token');

    // Проверяем, что FormData отправлена с channel_id и файлом.
    const body = xhr.body as FormData;
    expect(body.get('channel_id')).toBe('chan-1');
    expect(body.get('file')).toBeInstanceOf(File);

    xhr.status = 201;
    xhr.responseText = JSON.stringify({ id: 'att-1', kind: 'image', file_name: 'pic.png' });
    xhr.onload?.();

    await expect(handle.promise).resolves.toMatchObject({ id: 'att-1', kind: 'image' });
  });

  it('сообщает прогресс отправки', async () => {
    const onProgress = vi.fn();
    const handle = apiService.uploadAttachment('chan-1', new File(['data'], 'a.bin'), { onProgress });

    await Promise.resolve();
    await Promise.resolve();

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

    await Promise.resolve();
    await Promise.resolve();

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

  it('обновляет токен перед стартом загрузки', async () => {
    // Переопределяем мок для возврата свежего токена
    vi.mocked(apiService.getFreshAccessToken).mockResolvedValue('fresh-token');

    const handle = apiService.uploadAttachment('chan-1', new File(['x'], 'a.bin'), {});
    await Promise.resolve();
    await Promise.resolve();

    expect(apiService.getFreshAccessToken).toHaveBeenCalled();
    expect(FakeXHR.last.headers['Authorization']).toBe('Bearer fresh-token');

    FakeXHR.last.status = 201;
    FakeXHR.last.responseText = '{"id":"a"}';
    FakeXHR.last.onload?.();
    await handle.promise;
  });

  it('отмена до отправки не оставляет промис висеть', async () => {
    const handle = apiService.uploadAttachment('chan-1', new File(['x'], 'a.bin'), {});

    // Отменяем немедленно — до того, как отработало ожидание токена.
    handle.abort();

    await expect(handle.promise).rejects.toMatchObject({ code: 'upload_aborted' });
  });
});
