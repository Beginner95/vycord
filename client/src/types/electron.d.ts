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
  getAppVersion: () => Promise<string>;
  platform: string;
  getScreenSources: () => Promise<ScreenSourcesResult>;
  audioAssetsUrl: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
