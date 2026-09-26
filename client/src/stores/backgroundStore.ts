import { create } from 'zustand';
import { apiService } from '@/services/api';
import { API_BASE_URL, type CallBackground } from '@/services/api';

export type BackgroundMode = 'none' | 'blur' | 'image';
export type BackgroundListStatus = 'idle' | 'loading' | 'ready' | 'error';

export const BACKGROUND_MODES: BackgroundMode[] = ['none', 'blur', 'image'];

const STORAGE_KEY = 'vycord_background';
const DEFAULT_MODE: BackgroundMode = 'none';

interface PersistedBackgroundPrefs {
  mode: BackgroundMode;
  backgroundId: string | null;
}

function loadPrefs(): PersistedBackgroundPrefs {
  const result: PersistedBackgroundPrefs = { mode: DEFAULT_MODE, backgroundId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<PersistedBackgroundPrefs>;
    if (BACKGROUND_MODES.includes(parsed.mode as BackgroundMode)) result.mode = parsed.mode as BackgroundMode;
    if (typeof parsed.backgroundId === 'string') result.backgroundId = parsed.backgroundId;
  } catch {
    // Невалидный JSON — начинаем с дефолтов.
  }
  return result;
}

function persistPrefs(prefs: PersistedBackgroundPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage недоступен — преференсы живут до перезагрузки.
  }
}

/** Относительный url с сервера → абсолютный (резолв против API_BASE_URL). */
export function resolveBackgroundUrl(url: string): string {
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

interface BackgroundState {
  /** Выбранный пользователем режим (персист). */
  mode: BackgroundMode;
  /** Выбранный фон (персист, применятся только при mode='image'). */
  backgroundId: string | null;
  /** Список фонов с сервера, url уже абсолютные. */
  list: CallBackground[] | null;
  listStatus: BackgroundListStatus;
  setMode: (mode: BackgroundMode) => void;
  setBackground: (id: string | null) => void;
  fetchBackgrounds: () => Promise<void>;
  urlById: (id: string) => string | null;
}

function applyPrefs(prefs: PersistedBackgroundPrefs): Pick<BackgroundState, 'mode' | 'backgroundId'> {
  return { mode: prefs.mode, backgroundId: prefs.backgroundId };
}

export const useBackgroundStore = create<BackgroundState>((set, get) => ({
  ...applyPrefs(loadPrefs()),
  list: null,
  listStatus: 'idle',

  setMode: (mode) => {
    set({ mode });
    persistPrefs({ mode, backgroundId: get().backgroundId });
  },

  setBackground: (backgroundId) => {
    set({ backgroundId });
    persistPrefs({ mode: get().mode, backgroundId });
  },

  fetchBackgrounds: async () => {
    if (get().list !== null) return;
    set({ listStatus: 'loading' });
    try {
      const raw = await apiService.fetchBackgrounds();
      const list = raw.map((b) => ({ ...b, url: resolveBackgroundUrl(b.url) }));
      set({ list, listStatus: 'ready' });
      // Выбранный фон исчез с сервера — сбрасываем выбор, чтобы UI не
      // показывал мёртвую миниатюру.
      const { backgroundId } = get();
      if (backgroundId !== null && !list.some((b) => b.id === backgroundId)) {
        get().setBackground(null);
      }
    } catch {
      set({ listStatus: 'error' });
    }
  },

  urlById: (id) => {
    const found = get().list?.find((b) => b.id === id);
    return found ? found.url : null;
  },
}));