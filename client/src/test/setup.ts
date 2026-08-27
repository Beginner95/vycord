import { beforeEach } from 'vitest';

const store = new Map<string, string>();

const listeners = new Map<string, Set<(event: unknown) => void>>();

function addListener(key: string, type: string, listener: (event: unknown) => void): void {
  const mapKey = `${key}:${type}`;
  if (!listeners.has(mapKey)) listeners.set(mapKey, new Set());
  listeners.get(mapKey)!.add(listener);
}

export function fireTestEvent(key: string, type: string, event: unknown = {}): void {
  listeners.get(`${key}:${type}`)?.forEach((listener) => listener(event));
}

// В node-окружении настоящих window/document нет — подставляем минимальные
// заглушки. В файлах с "@vitest-environment jsdom" они уже настоящие, и
// затирать их нельзя: на них держится @testing-library/react.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    electronAPI: undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => addListener('window', type, listener),
    removeEventListener: () => {},
    setTimeout: ((fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms)) as unknown as Window['setTimeout'],
    clearTimeout: ((id: number) => globalThis.clearTimeout(id)) as unknown as Window['clearTimeout'],
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    documentElement: { setAttribute: () => {} },
    visibilityState: 'visible',
    addEventListener: (type: string, listener: (event: unknown) => void) => addListener('document', type, listener),
    removeEventListener: () => {},
  } as unknown as Document;
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (typeof globalThis.Event === 'undefined') {
  class TestEvent {
    constructor(readonly type: string) {}
  }
  globalThis.Event = TestEvent as unknown as typeof Event;
}

/** Созданные в тесте сокеты — по одному на каждый вызов `new WebSocket(...)`. */
export const mockSockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  private handlers = new Map<string, Set<(e: unknown) => void>>();

  constructor(readonly url: string) {
    mockSockets.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.get(type)?.delete(fn);
  }

  send(data: string): void { this.sent.push(data); }

  close(): void { this.readyState = MockWebSocket.CLOSED; }

  /** Тестовые хелперы — не часть настоящего WebSocket API. */
  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitClose(code = 1006): void {
    this.readyState = MockWebSocket.CLOSED;
    const event = { type: 'close', code, reason: '', wasClean: code === 1000, target: this };
    this.handlers.get('close')?.forEach((fn) => fn(event));
  }

  /** Число слушателей заданного типа — для проверки, что cleanup их снял. */
  listenerCount(type: string): number { return this.handlers.get(type)?.size ?? 0; }
}

globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

beforeEach(() => {
  store.clear();
  listeners.clear();
  mockSockets.length = 0;
});