const store = new Map<string, string>();

globalThis.window = { electronAPI: undefined } as unknown as Window & typeof globalThis;

globalThis.document = {
  documentElement: { setAttribute: () => {} },
} as unknown as Document;

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