import { contextBridge, ipcRenderer } from 'electron';

// With sandbox:true, Node.js modules (path, fs) are unavailable in preload.
// Main process computes the correct audio URL and returns it synchronously.
const audioAssetsUrl: string = ipcRenderer.sendSync('get-audio-assets-url-sync');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  audioAssetsUrl,
  setLocale: (locale: string) => ipcRenderer.send('locale:changed', locale),
  setTheme: (theme: string) => ipcRenderer.send('theme:changed', theme),
  update: {
    onAvailable: (cb: (version: string) => void) =>
      ipcRenderer.on('update:available', (_event, data: { version: string }) => cb(data.version)),
    onReady: (cb: (version: string) => void) =>
      ipcRenderer.on('update:ready', (_event, data: { version: string }) => cb(data.version)),
    onError: (cb: () => void) =>
      ipcRenderer.on('update:error', () => cb()),
    confirmInstall: () => ipcRenderer.invoke('update:confirmInstall'),
    openReleasesPage: () => ipcRenderer.invoke('update:openReleasesPage'),
  },
});
