import { app, BrowserWindow, ipcMain, Tray, Menu, session } from 'electron';
import * as path from 'path';

// __dirname is available via CommonJS module output
const electronDistDir = __dirname;
const projectRoot = path.resolve(electronDistDir, '..');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#313338',
    webPreferences: {
      preload: path.resolve(electronDistDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.resolve(projectRoot, 'dist/index.html'));
  }

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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open My Discrod',
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('My Discrod');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
  });
}

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

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

app.whenReady().then(() => {
  try {
    // Grant camera and microphone permissions for WebRTC
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    });

    createWindow();
    createTray();
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
