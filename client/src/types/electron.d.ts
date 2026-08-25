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

export interface ElectronAPI {
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  toggleFullscreen: () => Promise<boolean | null>;
  getAppVersion: () => Promise<string>;
  platform: string;
  getScreenSources: () => Promise<ScreenSourcesResult>;
  audioAssetsUrl: string;
  // Опционально: в веб-сборке electronAPI нет вовсе, а у клиентов,
  // собранных до появления локализации, нет этого метода.
  setLocale?: (locale: Locale) => void;
  // Опционально по той же причине, что и setLocale: старые сборки клиента
  // и веб-сборка этого метода не имеют.
  setTheme?: (theme: string) => void;
  update: {
    onAvailable: (cb: (version: string) => void) => void;
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
