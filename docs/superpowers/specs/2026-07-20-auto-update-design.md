# Трекинг и автообновление приложения (Electron-клиент)

## Контекст и цель

Клиент Vy Cord — Electron-приложение, собираемое через `electron-builder`
(`client/package.json`, targets: Windows nsis+portable, Linux AppImage; macOS не
сконфигурирован). Репозиторий `Beginner95/vycord` на GitHub — **публичный**.
Сейчас релизы не публикуются автоматически, `electron-updater` не подключён,
CI/CD для сборки клиента отсутствует.

Цель: при выходе новой версии на GitHub Releases приложение само обнаруживает
обновление, ненавязчиво предлагает пользователю обновиться, и после
подтверждения устанавливает обновление без ошибок и без прерывания активного
звонка.

## Ограничения и решения, зафиксированные в брейнсторминге

- Репозиторий публичный → `electron-updater` читает GitHub Releases напрямую,
  без embedded-токена.
- Автообновление реализуется для **Windows (nsis)** и **Linux (AppImage)** —
  единственных целей, которые `electron-updater` поддерживает "из коробки".
  Portable-сборка Windows остаётся без автообновления (ограничение самого
  electron-updater, не наше решение).
- Публикация релизов — через **GitHub Actions по git-тегу**, не вручную.
- Проверка обновлений — при старте приложения и периодически в фоне;
  обнаружение показывается пользователю как ненавязчивый баннер/тост, а не
  блокирующий диалог.
- Скачивание файла обновления начинается сразу после обнаружения, **до**
  подтверждения пользователем — к моменту клика "Установить" обновление обычно
  уже готово.
- Если во время подтверждения/после него активен звонок (1:1 или групповой) —
  установка откладывается до выхода из звонка; скачивание при этом никогда не
  блокируется звонком.
- При сбое скачивания/установки — тихий fallback (лог + ссылка на страницу
  релизов для ручной установки), без блокирующих диалогов. Ошибка показывается
  пользователю только если до этого уже было показано "доступно обновление" —
  сбои фоновых периодических проверок (например, временно нет сети) не
  показываются вовсе.

## Архитектура

```
GitHub tag push (vX.Y.Z)
        │
        ▼
GitHub Actions (release.yml)
  ├─ windows-latest: build + electron-builder --publish always
  └─ ubuntu-latest:  build + electron-builder --publish always
        │
        ▼
GitHub Release (installers + latest.yml / latest-linux.yml)
        │
        ▼
electron-updater (main process, client/electron/updater.ts)
        │  IPC events: update:available / update:ready / update:error
        ▼
Renderer: UpdateBanner.tsx (App.tsx, глобально)
        │  confirmInstall() — с проверкой активного звонка
        ▼
autoUpdater.quitAndInstall()
```

## Раздел 1 — CI/CD: сборка и публикация релиза

**Версионирование и релиз (ручной шаг мейнтейнера):**

```bash
cd client
npm version patch   # bump client/package.json + git commit + git tag vX.Y.Z
git push origin main --tags
```

**`client/package.json`** — добавляется секция `publish` в блок `build`:

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "Beginner95",
    "repo": "vycord"
  }
}
```

**`.github/workflows/release.yml`:**

- Триггер: `on.push.tags: ['v*.*.*']`.
- `permissions: contents: write`.
- Матрица `os: [windows-latest, ubuntu-latest]`.
- На каждой ОС: checkout → `actions/setup-node` (Node 22) → `npm ci`
  (`working-directory: client`) → `npm run build` → `npx electron-builder --publish always`.
- `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — встроенный токен достаточен,
  отдельный PAT не нужен (публичный репозиторий, тот же owner).
- `electron-builder` сам создаёт/дополняет GitHub Release для тега и заливает
  инсталляторы + `latest.yml` (Windows) / `latest-linux.yml` (Linux). Релиз
  публикуется сразу (не draft) — как только оба джоба завершились, обновление
  видно клиентам.

Без code signing (не запрашивалось): на Windows это означает предупреждение
SmartScreen при первой ручной установке; на автообновление уже установленных
клиентов не влияет.

## Раздел 2 — Main-процесс: модуль автообновления

Новый файл `client/electron/updater.ts`, инициализируется из `main.ts` внутри
`app.whenReady()`.

- Активируется только когда `app.isPackaged === true` — в
  `npm run dev:electron` модуль не запускается.
- `autoUpdater.autoDownload = true` — скачивание сразу при обнаружении.
- `autoUpdater.autoInstallOnAppQuit = false` — явно отключаем стандартное
  поведение electron-updater "тихо установить при выходе из приложения":
  установка должна происходить только по явному подтверждению пользователя
  через UI, а не при любом закрытии окна.
- Логирование через `electron-log` (файл в userData) — для диагностики
  проблем обновления у реальных пользователей.
- Проверка обновлений: первая — через ~10 сек после старта (не блокируя
  загрузку окна), далее — каждые 4 часа через `setInterval`.
- Обработчики `autoUpdater`, транслируются в renderer через
  `mainWindow.webContents.send(...)`:
  - `update-available` → IPC `update:available` (версия) + внутренний флаг
    `announcedThisSession = true`.
  - `update-downloaded` → IPC `update:ready` (версия).
  - `error` → если `announcedThisSession` — IPC `update:error` (ссылка на
    страницу релизов); если нет — только запись в лог, никакого UI.
  - `update-not-available` → no-op.
- `ipcMain.handle('update:confirmInstall')` → вызывает
  `autoUpdater.quitAndInstall()`. Проверки "не в звонке" здесь нет — это
  ответственность renderer.

## Раздел 3 — Renderer: UI и логика отложенной установки

**`preload.ts`** добавляет в `contextBridge`:

```ts
update: {
  onAvailable(cb), onReady(cb), onError(cb),
  confirmInstall(), openReleasesPage(),
}
```

`openReleasesPage()` — IPC до main, который вызывает
`shell.openExternal('https://github.com/Beginner95/vycord/releases/latest')`
(внешние ссылки не должны открываться внутри окна приложения).

**Компонент `UpdateBanner.tsx`**, монтируется один раз в `App.tsx` на верхнем
уровне — виден на любом экране, не привязан к роуту.

Состояния: `idle → available → ready → error`.

- `available` (пришло `update:available`): баннер "Доступна версия vX.Y.Z",
  кнопки **Установить** / **Позже**. Скачивание уже идёт в фоне независимо от
  этого баннера.
- `ready` (пришло `update:ready`) — показывается даже если пользователь ранее
  закрыл баннер кнопкой "Позже", так как готовность к установке важнее:
  "Обновление vX.Y.Z готово", кнопка **Перезапустить и установить**.
- `error` (пришло `update:error`, то есть после того как уже был показан
  `available`): "Не удалось обновиться автоматически", кнопка
  **Скачать вручную** → `openReleasesPage()`.

**Логика клика "Перезапустить и установить":**

```ts
const busy = groupCallService.isInGroupCallState || callService.isInCallState;
```

- `false` → сразу `electronAPI.update.confirmInstall()`.
- `true` → баннер переключается в текст "Установится после звонка", без
  дополнительных действий пользователя. Запускается `setInterval` (~5 сек),
  опрашивающий те же два геттера; когда оба становятся `false` —
  `clearInterval` + `confirmInstall()`.

Выбран поллинг публичных boolean-геттеров, а не подписка на события звонка:
у `groupCallService` и `callService` — модель "один потребитель callbacks"
(`init(callbacks)`), которой уже владеют `GroupCallUI`/`CallUI`. Вклиниваться
туда вторым подписчиком было бы более хрупким решением, чем безопасный
поллинг двух уже существующих публичных геттеров
(`isInGroupCallState`, `isInCallState`).

## Раздел 4 — Тестирование

Реальный процесс автообновления (скачивание и запуск настоящего инсталлятора)
не воспроизводится в headless Chrome — существующий `client/e2e/run.sh` здесь
не подходит. План ручного тестирования:

1. Собрать и установить версию `v0.1.0`.
2. Опубликовать релиз `v0.1.1` через workflow.
3. Убедиться: баннер "Доступна версия" появляется без перезапуска клиента (в
   пределах интервала проверки), обновление скачивается в фоне, баннер
   переходит в состояние "готово".
4. Проверить сценарий звонка: зайти в групповой звонок, подтвердить установку —
   баннер должен показать отложенный текст и установить обновление только
   после выхода из звонка.
5. Проверить сценарий ошибки: временно отключить сеть после появления баннера
   "Доступна версия" — должен появиться баннер ошибки со ссылкой на релизы, а
   не блокирующий диалог.
6. Повторить пп. 1–3 для Linux AppImage.

Юнит-тестами покрывать нечего отдельно ценного — вся логика представляет собой
тонкую обёртку над `electron-updater`/IPC; основной риск — в E2E-сценарии
выше, не в изолированной бизнес-логике.

## Известные ограничения (не в скоупе)

- macOS не поддерживается (не сконфигурирован в electron-builder вообще).
- Windows portable-сборка не участвует в автообновлении — ограничение
  electron-updater.
- Нет code signing — на Windows будет предупреждение SmartScreen при первой
  ручной установке.
- Нет каналов (beta/stable) и поэтапных раскаток — не запрашивалось, любой
  опубликованный релиз с тегом `vX.Y.Z` доступен всем клиентам сразу.
