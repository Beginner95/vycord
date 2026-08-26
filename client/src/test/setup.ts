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

const localStorageImpl = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() {
    return store.size;
  },
};

globalThis.window = {
  electronAPI: undefined,
  addEventListener: (type: string, listener: (event: unknown) => void) => addListener('window', type, listener),
  removeEventListener: () => {},
  localStorage: localStorageImpl as any,
} as unknown as Window & typeof globalThis;

globalThis.document = {
  documentElement: { setAttribute: () => {} },
  visibilityState: 'visible',
  addEventListener: (type: string, listener: (event: unknown) => void) => addListener('document', type, listener),
  removeEventListener: () => {},
} as unknown as Document;

globalThis.localStorage = localStorageImpl;

beforeEach(() => {
  store.clear();
  listeners.clear();
});