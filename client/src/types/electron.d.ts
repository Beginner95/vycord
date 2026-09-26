import type { Locale } from '@/stores/localeStore';

export interface DesktopCapturerSource {
  id: string;
  name: string;
  thumbnail: string; // data URL
  appIconUrl: string | null;
}

export interface ScreenSourcesResult {
  sources?: DesktopCapturerSource[];
  error?: string; // 'screen_permission_denied' | 'failed_to_get_sources'
}

export type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export interface MediaAccessStatusResult {
  camera: MediaAccessStatus;
  microphone: MediaAccessStatus;
}

export interface ElectronAPI {
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean | null>;
  getAppVersion: () => Promise<string>;
  platform: string;
  getScreenSources: () => Promise<ScreenSourcesResult>;
  // Опционально по той же причине, что и setLocale/setTheme: старые сборки
  // клиента и веб-сборка этого метода не имеют.
  getMediaAccessStatus?: () => Promise<MediaAccessStatusResult>;
  // Показывает системный запрос macOS (TCC) для ещё не решённых камеры/микрофона
  // и возвращает итоговые статусы. Опционально по той же причине.
  requestMediaAccess?: () => Promise<MediaAccessStatusResult>;
  audioAssetsUrl: string;
  /** Базовый URL каталога wasm/модели MediaPipe Video Background (VYC-100). */
  visionAssetsUrl: string;
  // Опционально: в веб-сборке electronAPI нет вовсе, а у клиентов,
  // собранных до появления локализации, нет этого метода.
  setLocale?: (locale: Locale) => void;
  // Опционально по той же причине, что и setLocale: старые сборки клиента
  // и веб-сборка этого метода не имеют.
  setTheme?: (theme: string) => void;
  update: {
    onAvailable: (cb: (version: string) => void) => void;
    onManual: (cb: (version: string) => void) => void;
    onReady: (cb: (version: string) => void) => void;
    onError: (cb: () => void) => void;
    confirmInstall: () => Promise<void>;
    openReleasesPage: () => Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
