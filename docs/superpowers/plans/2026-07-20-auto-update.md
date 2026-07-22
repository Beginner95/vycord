# Автообновление клиента (Electron) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron-клиент Vy Cord сам обнаруживает новую версию, опубликованную на GitHub Releases, ненавязчиво предлагает обновиться и после подтверждения устанавливает обновление без ошибок, откладывая установку, если идёт звонок.

**Architecture:** `electron-updater` в main-процессе проверяет GitHub Releases (провайдер `github`), скачивает обновление в фоне сразу после обнаружения и транслирует события через IPC (`update:available` / `update:ready` / `update:error`) в renderer. Renderer показывает баннер `UpdateBanner` и решает, когда безопасно вызвать установку (`update:confirmInstall` → `autoUpdater.quitAndInstall()`), проверяя перед этим состояние звонка через уже существующие геттеры `groupCallService.isInGroupCallState` / `callService.isInCallState`. Публикация релизов — через GitHub Actions по git-тегу `vX.Y.Z`.

**Tech Stack:** Electron 41, electron-builder 26, electron-updater ^6.8.9, electron-log ^5.4.4, TypeScript 6, React 19, GitHub Actions.

## Global Constraints

- Репозиторий `Beginner95/vycord` — публичный, `electron-updater` читает GitHub Releases без токена.
- Автообновление покрывает только Windows (nsis) и Linux (AppImage) — единственные targets, которые `electron-updater` поддерживает "из коробки"; portable Windows-сборка не участвует.
- Публикация — только через GitHub Actions по тегу `v*.*.*`, релиз публикуется сразу (не draft).
- `autoUpdater.autoDownload = true` — скачивание сразу после обнаружения, без ожидания подтверждения.
- `autoUpdater.autoInstallOnAppQuit = false` — обязательно, иначе electron-updater тихо установит обновление при любом закрытии приложения без подтверждения пользователя.
- Проверка обновлений: первая через 10 сек после старта, далее каждые 4 часа.
- Ошибка показывается пользователю в UI только если до этого уже был показан `update:available` в этой сессии (флаг `announcedThisSession`); фоновые периодические сбои — только в лог, без UI.
- Установка (`autoUpdater.quitAndInstall()`) может быть вызвана только когда `groupCallService.isInGroupCallState === false` и `callService.isInCallState === false`.
- Node 22 — версия для сборки клиента (используется в существующих workflow-соглашениях проекта).
- В `client/` нет unit-test фреймворка (jest/vitest) — верификация по коду делается через `tsc`/сборочные команды проекта (`npm run build:electron-main`, `npm run build:vite`), финальная проверка — по ручному QA-чеклисту (Task 6), т.к. реальный цикл автообновления требует настоящего GitHub-релиза и установленного инсталлятора.
- Владелец/репозиторий для `publish`-конфига: `owner: "Beginner95"`, `repo: "vycord"`.

---

## Файловая карта

| Файл | Статус | Ответственность |
|---|---|---|
| `client/package.json` | Modify | зависимости `electron-updater`/`electron-log`, `build.publish` |
| `client/electron/updater.ts` | Create | вся логика autoUpdater + IPC-обработчики `update:*` в main-процессе |
| `client/electron/main.ts` | Modify | вызов `initAutoUpdater(win)` при старте |
| `client/electron/preload.ts` | Modify | мост `electronAPI.update.*` в renderer |
| `client/src/types/electron.d.ts` | Modify | типы `ElectronAPI.update` |
| `client/src/components/UpdateBanner.tsx` | Create | UI баннера + логика отложенной установки во время звонка |
| `client/src/components/UpdateBanner.css` | Create | стили баннера (через существующие CSS-переменные темы) |
| `client/src/App.tsx` | Modify | монтирование `<UpdateBanner />` |
| `.github/workflows/release.yml` | Create | сборка + публикация релиза по тегу |

---

### Task 1: Зависимости и publish-конфиг

**Files:**
- Modify: `client/package.json`

**Interfaces:**
- Produces: пакеты `electron-updater`, `electron-log` установлены и резолвятся из `client/node_modules`; `client/package.json` содержит `build.publish` с `provider: "github"`.

- [ ] **Step 1: Добавить зависимости в `client/package.json`**

В блоке `"dependencies"` (сейчас содержит `react-router-dom`, `socket.io-client`, `zustand`) добавить:

```json
"dependencies": {
  "electron-log": "^5.4.4",
  "electron-updater": "^6.8.9",
  "react-router-dom": "^7.14.0",
  "socket.io-client": "^4.8.3",
  "zustand": "^5.0.12"
},
```

- [ ] **Step 2: Добавить `publish` в блок `build`**

В блоке `"build"` сразу после `"directories": { "output": "release" },` добавить:

```json
"publish": {
  "provider": "github",
  "owner": "Beginner95",
  "repo": "vycord"
},
```

- [ ] **Step 3: Установить зависимости и проверить, что модули резолвятся**

```bash
cd client && npm install
node -e "require('electron-updater'); require('electron-log'); console.log('ok')"
```

Expected: вывод `ok`, без ошибок `Cannot find module`.

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore(client): add electron-updater/electron-log and GitHub publish config"
```

---

### Task 2: Main-процесс — модуль автообновления

**Files:**
- Create: `client/electron/updater.ts`
- Modify: `client/electron/main.ts`

**Interfaces:**
- Consumes: `BrowserWindow` из `electron` (тип), IPC-канал `update:confirmInstall`/`update:openReleasesPage` (обрабатываются здесь).
- Produces: `export function initAutoUpdater(mainWindow: BrowserWindow): void`. Отправляет в renderer через `mainWindow.webContents.send`: `'update:available'` с payload `{ version: string }`, `'update:ready'` с payload `{ version: string }`, `'update:error'` с payload `{ releasesUrl: string }`.

- [ ] **Step 1: Создать `client/electron/updater.ts`**

```ts
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
```

- [ ] **Step 2: Подключить в `client/electron/main.ts`**

Добавить импорт рядом с остальными импортами (после `import * as path from 'path';`):

```ts
import { initAutoUpdater } from './updater';
```

Найти в `main.ts` блок:

```ts
    createWindow();
    createTray();
  } catch (err) {
```

Заменить на:

```ts
    const win = createWindow();
    createTray();
    initAutoUpdater(win);
  } catch (err) {
```

- [ ] **Step 3: Проверить компиляцию main-процесса**

```bash
cd client && npm run build:electron-main
```

Expected: команда завершается без ошибок TypeScript, в `client/electron-dist/` появляются `main.cjs` и `updater.js`.

- [ ] **Step 4: Commit**

```bash
git add client/electron/updater.ts client/electron/main.ts
git commit -m "feat(client): wire electron-updater into main process"
```

---

### Task 3: Preload-мост и типы

**Files:**
- Modify: `client/electron/preload.ts`
- Modify: `client/src/types/electron.d.ts`

**Interfaces:**
- Consumes: IPC-каналы `update:available`, `update:ready`, `update:error` (события из Task 2), `update:confirmInstall`, `update:openReleasesPage` (handlers из Task 2).
- Produces: `window.electronAPI.update` с методами `onAvailable(cb: (version: string) => void): void`, `onReady(cb: (version: string) => void): void`, `onError(cb: () => void): void`, `confirmInstall(): Promise<void>`, `openReleasesPage(): Promise<void>`.

- [ ] **Step 1: Обновить `client/electron/preload.ts`**

Текущий `contextBridge.exposeInMainWorld('electronAPI', { ... })` дополнить полем `update` (внутри того же объекта, после `audioAssetsUrl`):

```ts
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  audioAssetsUrl,
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
```

- [ ] **Step 2: Обновить `client/src/types/electron.d.ts`**

В интерфейс `ElectronAPI` добавить поле `update` (после `audioAssetsUrl: string;`):

```ts
export interface ElectronAPI {
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  platform: string;
  getScreenSources: () => Promise<ScreenSourcesResult>;
  audioAssetsUrl: string;
  update: {
    onAvailable: (cb: (version: string) => void) => void;
    onReady: (cb: (version: string) => void) => void;
    onError: (cb: () => void) => void;
    confirmInstall: () => Promise<void>;
    openReleasesPage: () => Promise<void>;
  };
}
```

- [ ] **Step 3: Проверить компиляцию**

```bash
cd client && npm run build:electron-main
```

Expected: без ошибок. `preload.cjs` пересобран.

- [ ] **Step 4: Commit**

```bash
git add client/electron/preload.ts client/src/types/electron.d.ts
git commit -m "feat(client): expose update IPC bridge via preload"
```

---

### Task 4: UI-баннер и отложенная установка во время звонка

**Files:**
- Create: `client/src/components/UpdateBanner.tsx`
- Create: `client/src/components/UpdateBanner.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.update.*` (Task 3), `groupCallService.isInGroupCallState` (`client/src/services/groupCall.ts`), `callService.isInCallState` (`client/src/services/call.ts`).
- Produces: `export function UpdateBanner(): JSX.Element | null`, смонтирован в `App.tsx`.

- [ ] **Step 1: Создать `client/src/components/UpdateBanner.css`**

```css
.update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
}

.update-banner button {
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  background: var(--brand-color);
  color: var(--text-inverse);
}

.update-banner button:hover {
  background: var(--brand-hover);
}

.update-banner__dismiss {
  background: transparent;
  color: var(--text-secondary);
}

.update-banner__dismiss:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 2: Создать `client/src/components/UpdateBanner.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { groupCallService } from '@/services/groupCall';
import { callService } from '@/services/call';
import './UpdateBanner.css';

type UpdateStatus = 'idle' | 'available' | 'ready' | 'error';

const CALL_POLL_INTERVAL_MS = 5000;

function isBusyWithCall(): boolean {
  return groupCallService.isInGroupCallState || callService.isInCallState;
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [waitingForCallEnd, setWaitingForCallEnd] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.update;
    if (!api) return;

    api.onAvailable((v) => {
      setVersion(v);
      setStatus('available');
      setDismissed(false);
    });
    api.onReady((v) => {
      setVersion(v);
      setStatus('ready');
      setDismissed(false);
    });
    api.onError(() => {
      setStatus('error');
      setDismissed(false);
    });

    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const handleInstall = () => {
    const api = window.electronAPI?.update;
    if (!api) return;

    if (isBusyWithCall()) {
      setWaitingForCallEnd(true);
      pollRef.current = window.setInterval(() => {
        if (!isBusyWithCall()) {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setWaitingForCallEnd(false);
          api.confirmInstall();
        }
      }, CALL_POLL_INTERVAL_MS);
    } else {
      api.confirmInstall();
    }
  };

  const handleManualDownload = () => {
    window.electronAPI?.update?.openReleasesPage();
  };

  if (!window.electronAPI?.update || dismissed || status === 'idle') {
    return null;
  }

  return (
    <div className="update-banner" role="status">
      {status === 'available' && (
        <>
          <span>Доступна версия {version}</span>
          <button onClick={handleInstall}>Установить</button>
          <button className="update-banner__dismiss" onClick={() => setDismissed(true)}>
            Позже
          </button>
        </>
      )}
      {status === 'ready' && (
        <>
          <span>
            {waitingForCallEnd
              ? `Обновление ${version} установится после звонка`
              : `Обновление ${version} готово`}
          </span>
          {!waitingForCallEnd && <button onClick={handleInstall}>Перезапустить и установить</button>}
        </>
      )}
      {status === 'error' && (
        <>
          <span>Не удалось обновиться автоматически</span>
          <button onClick={handleManualDownload}>Скачать вручную</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Смонтировать баннер в `client/src/App.tsx`**

```tsx
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter';
import { UpdateBanner } from './components/UpdateBanner';

function App() {
  return (
    <BrowserRouter>
      <UpdateBanner />
      <AppRouter />
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Проверить компиляцию и сборку renderer**

```bash
cd client && npm run build:vite
```

Expected: сборка завершается без ошибок TypeScript/Vite.

- [ ] **Step 5: Ручная проверка в dev-режиме**

```bash
cd client && npm run dev
```

Открыть приложение в браузере (не Electron) — `window.electronAPI` там `undefined`, значит `UpdateBanner` должен не рендерить ничего (вернуть `null`) и не бросать ошибок в консоли. Проверить консоль браузера — ошибок нет.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/UpdateBanner.tsx client/src/components/UpdateBanner.css client/src/App.tsx
git commit -m "feat(client): add update banner UI with call-aware install deferral"
```

---

### Task 5: GitHub Actions — сборка и публикация релиза

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: git-тег `v*.*.*`, `client/package.json` `build.publish` (Task 1).
- Produces: GitHub Release с инсталляторами Windows (nsis) и Linux (AppImage) + `latest.yml`/`latest-linux.yml`.

- [ ] **Step 1: Создать `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  release:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm ci

      - run: npm run build

      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Проверить синтаксис workflow**

```bash
cd /www/my/vycord
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "yaml ok"
```

Expected: `yaml ok`. Если `python3`/`yaml` недоступны — открыть файл и визуально сверить отступы с примером выше (YAML чувствителен к пробелам).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add tag-triggered release workflow for electron-builder publish"
```

---

### Task 6: End-to-end проверка на реальном релизе

Эту задачу выполняет мейнтейнер вручную после того, как Tasks 1-5 смерджены в `main` — она требует реального пуша тега, реального GitHub Release и установленного на машине инсталлятора, что не автоматизируется агентом.

**Files:** нет изменений кода.

- [ ] **Step 1: Выпустить первую версию с автообновлением**

```bash
cd client
npm version patch
git push origin main --tags
```

Дождаться зелёного прогона `Release` workflow в GitHub Actions на оба таргета (Windows, Linux).

- [ ] **Step 2: Установить собранную версию и убедиться, что приложение запускается**

Скачать инсталлятор из только что созданного релиза (Windows `.exe` или Linux `.AppImage`), установить/запустить.

- [ ] **Step 3: Выпустить вторую версию и проверить обнаружение**

```bash
cd client
npm version patch
git push origin main --tags
```

В уже запущенном (не переустановленном) клиенте — в пределах ~10 сек после старта или следующей 4-часовой проверки — должен появиться баннер «Доступна версия vX.Y.Z».

- [ ] **Step 4: Проверить путь без звонка**

Нажать «Установить» (или дождаться «Обновление готово» → «Перезапустить и установить»). Приложение должно перезапуститься уже на новой версии без диалогов ошибок.

- [ ] **Step 5: Проверить путь со звонком**

Запустить старую версию, зайти в групповой звонок (или 1:1 звонок), дождаться баннера, нажать «Установить»/«Перезапустить и установить» во время звонка. Баннер должен показать текст «установится после звонка». Завершить звонок — установка должна запуститься автоматически без дополнительных действий.

- [ ] **Step 6: Проверить тихий fallback при сбое**

После появления баннера «Доступна версия» отключить сеть (или заблокировать доступ к `github.com` в файрволе) до завершения скачивания. Должен появиться баннер «Не удалось обновиться автоматически» со ссылкой «Скачать вручную», ведущей на страницу релизов, без блокирующих диалогов.

- [ ] **Step 7: Повторить Step 2-4 для второй платформы**

Если Step 1-4 проверялись на Windows — повторить на Linux AppImage (и наоборот), чтобы покрыть оба поддерживаемых таргета.
