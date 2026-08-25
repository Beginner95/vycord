import { app, BrowserWindow, ipcMain, Tray, Menu, session, desktopCapturer, systemPreferences, shell, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initAutoUpdater } from './updater';
import { TRAY_LABELS, isTrayLocale, type TrayLocale } from './tray-labels';
import * as Sentry from '@sentry/electron/main';
import { SENTRY_DSN } from './sentry-config';

// __dirname is available via CommonJS module output
const electronDistDir = __dirname;
const projectRoot = path.resolve(electronDistDir, '..');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentTrayLocale: TrayLocale = 'ru';

const isDev = process.env.NODE_ENV === 'development';

// As early as possible, same PROD-only gating as the renderer
// (services/errorReporting.ts) — no reporting from local dev runs.
if (!isDev && SENTRY_DSN !== 'REPLACE_WITH_GLITCHTIP_DSN') {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: 'production',
    release: app.getVersion(),
  });
  Sentry.setTag('platform', 'electron-main');
}

// Тема окна до загрузки рендерера: renderer localStorage главному процессу
// недоступен, поэтому renderer зеркалит выбор темы в ui-prefs.json (IPC
// 'theme:changed' ниже). До первой записи — системная тема (nativeTheme),
// как и getInitialTheme() в stores/themeStore.ts.
function windowBackgroundColor(): string {
  const prefsPath = path.join(app.getPath('userData'), 'ui-prefs.json');
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8')) as { theme?: string };
    if (prefs.theme === 'dark') return '#0E1017';
    if (prefs.theme === 'light') return '#FFFFFF';
  } catch {
    // no prefs yet — fall through to system theme
  }
  return nativeTheme.shouldUseDarkColors ? '#0E1017' : '#FFFFFF';
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: path.resolve(electronDistDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Allow media autoplay without requiring a prior user gesture.
      // Without this, Chrome blocks el.play() on audio-bearing streams that arrive
      // via WebRTC ontrack callbacks — the gesture context from "join call" click
      // is long expired by the time ICE+DTLS completes and ontrack fires.
      // This causes B to not hear A for 1-2 minutes until Chrome's internal retry
      // triggers on the next user interaction. Safe for a desktop chat app.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.resolve(projectRoot, 'dist/index.html'));
  }

  const openExternal = (url: string) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow!.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createTray(): void {
  const iconPath = path.resolve(projectRoot, 'public/icon.png');
  const fallbackPath = path.resolve(projectRoot, 'public/vite.svg');

  try {
    tray = new Tray(iconPath);
  } catch {
    try {
      tray = new Tray(fallbackPath);
    } catch {
      return;
    }
  }

  tray.setToolTip('Vy Cord');
  buildTrayMenu();

  tray.on('click', () => {
    mainWindow?.show();
  });
}

// Пересобирается при каждой смене языка в рендерере — Electron не умеет
// менять подписи уже установленного меню, только заменять меню целиком.
function buildTrayMenu(): void {
  // isDestroyed: before-quit делает tray.destroy(), но переменную не обнуляет,
  // а locale:changed может прийти уже после этого.
  if (!tray || tray.isDestroyed()) return;

  const labels = TRAY_LABELS[currentTrayLocale];
  const contextMenu = Menu.buildFromTemplate([
    {
      label: labels.open,
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// Локаль приходит из рендерера: значение произвольное, поэтому валидируется.
ipcMain.on('locale:changed', (_event, locale: unknown) => {
  if (!isTrayLocale(locale) || locale === currentTrayLocale) return;
  currentTrayLocale = locale;
  buildTrayMenu();
});

ipcMain.on('theme:changed', (_event, theme: unknown) => {
  if (theme !== 'dark' && theme !== 'light') return;
  const prefsPath = path.join(app.getPath('userData'), 'ui-prefs.json');
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({ theme }));
  } catch {
    // non-fatal: worst case is a wrong launch background next start
  }
});

// Sync IPC: preload (sandbox:true, no Node.js) calls this to get the correct audio URL.
// Main process has full Node.js access and knows where asarUnpack placed the files.
ipcMain.on('get-audio-assets-url-sync', (event) => {
  if (isDev) {
    event.returnValue = '/audio/';
    return;
  }
  const audioDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'audio');
  const normalized = audioDir.replace(/\\/g, '/');
  // Unix: normalized = /path/to/audio  → file:///path/to/audio/
  // Win:  normalized = C:/path/audio   → file://C:/path/audio/
  event.returnValue = `file://${normalized}/`;
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:toggle-fullscreen', () => {
  const win = mainWindow;
  if (!win) return null;
  // The DOM Fullscreen API can silently fail on a frameless Electron window, so
  // screen-share fullscreen is driven through the main process. setFullScreen is
  // async (notably on macOS), so report the intended state back to the renderer.
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-screen-sources', async () => {
  // macOS 10.15+ requires Screen Recording permission.
  // If explicitly denied, getSources returns black thumbnails and no window names —
  // surface this as an actionable error rather than silently showing broken previews.
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied') {
      return { error: 'screen_permission_denied' };
    }
    // 'not-determined' → getSources call below will prompt the user
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return {
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIconUrl: s.appIcon ? s.appIcon.toDataURL() : null,
      })),
    };
  } catch {
    return { error: 'failed_to_get_sources' };
  }
});

app.whenReady().then(() => {
  try {
    // Grant camera and microphone permissions for WebRTC
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media' || permission === 'display-capture') {
        callback(true);
      } else {
        callback(false);
      }
    });

    const win = createWindow();
    createTray();
    initAutoUpdater(win);
  } catch (err) {
    console.error('Failed to initialize app:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err) => {
  console.error('Failed to start app:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  tray?.destroy();
});
