import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import log from 'electron-log';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10 * 1000;
const RELEASES_URL = 'https://github.com/Beginner95/vycord/releases/latest';

let announcedThisSession = false;

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.logger = log;
  log.transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  // electron-updater installs a downloaded update on quit by default even
  // without user confirmation — we require an explicit confirmation instead.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    announcedThisSession = true;
    mainWindow.webContents.send('update:available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    mainWindow.webContents.send('update:ready', { version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('autoUpdater error', err);
    if (announcedThisSession) {
      mainWindow.webContents.send('update:error', { releasesUrl: RELEASES_URL });
    }
  });

  ipcMain.handle('update:confirmInstall', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('update:openReleasesPage', () => {
    shell.openExternal(RELEASES_URL);
  });

  const runCheck = () => {
    autoUpdater.checkForUpdates().catch((err) => log.error('checkForUpdates failed', err));
  };

  setTimeout(runCheck, INITIAL_CHECK_DELAY_MS);
  setInterval(runCheck, CHECK_INTERVAL_MS);
}
