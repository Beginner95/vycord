// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestAttention } from '@/services/desktopAttention';

describe('requestAttention', () => {
  const ctor = vi.fn();
  const flashFrame = vi.fn();

  beforeEach(() => {
    ctor.mockClear();
    flashFrame.mockClear();
    class N {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts: unknown) { ctor(title, opts); }
    }
    vi.stubGlobal('Notification', N);
    (window as unknown as { electronAPI: unknown }).electronAPI = { flashFrame };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('в фокусе — ничего', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    requestAttention('t', 'b');
    expect(ctor).not.toHaveBeenCalled();
    expect(flashFrame).not.toHaveBeenCalled();
  });

  it('не в фокусе — уведомление и flashFrame', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    requestAttention('t', 'b');
    expect(ctor).toHaveBeenCalledWith('t', { body: 'b', silent: true, tag: 'incoming-call' });
    expect(flashFrame).toHaveBeenCalled();
  });
});

describe('requestAttention: ветки', () => {
  const ctor = vi.fn();
  const requestPermission = vi.fn();
  const setup = (permission: string) => {
    class N {
      static permission = permission;
      static requestPermission = requestPermission;
      onclick: (() => void) | null = null;
      constructor(title: string, opts: unknown) { ctor(title, opts); }
    }
    vi.stubGlobal('Notification', N);
  };
  beforeEach(() => { ctor.mockClear(); requestPermission.mockReset(); vi.spyOn(document, 'hasFocus').mockReturnValue(false); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('вкладка скрыта при фокусе — всё равно привлекает внимание', () => {
    setup('granted');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    requestAttention('t', 'b');
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('permission default: запрашивает и показывает после granted', async () => {
    setup('default');
    requestPermission.mockResolvedValue('granted');
    requestAttention('t', 'b');
    expect(requestPermission).toHaveBeenCalled();
    await Promise.resolve(); await Promise.resolve();
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('permission default и отказ — уведомления нет', async () => {
    setup('default');
    requestPermission.mockResolvedValue('denied');
    requestAttention('t', 'b');
    await Promise.resolve(); await Promise.resolve();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('permission denied — ни запроса, ни уведомления', () => {
    setup('denied');
    requestAttention('t', 'b');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('без electronAPI не падает и показывает уведомление', () => {
    setup('granted');
    expect(() => requestAttention('t', 'b')).not.toThrow();
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
