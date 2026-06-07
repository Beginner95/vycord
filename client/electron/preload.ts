import { contextBridge, ipcRenderer } from 'electron';

// With sandbox:true, Node.js modules (path, fs) are unavailable in preload.
// Main process computes the correct audio URL and returns it synchronously.
const audioAssetsUrl: string = ipcRenderer.sendSync('get-audio-assets-url-sync');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  audioAssetsUrl,
});
