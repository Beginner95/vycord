# ВИДЕОЭФФЕКТЫ ДЛЯ ВЕБ-КАМЕРЫ (VYC-100) — SPEC

- **Дата:** 2026-09-26
- **Ветка:** `VYC-100-webcamera-background`
- **Статус:** утверждено брейнштормингом (все секции одобрены)

## Контекст

В звонках (P2P и групповых/SFU) есть веб-камера: локальный `MediaStream` доступен
в `call.ts` / `groupCall.ts` и рендерится в превью (`CallUI`, `CallStage`).
Необходимо дать пользователю три режима обработки камеры в реальном времени:

1. `none` — оригинал (без изменений);
2. `blur` — размытие заднего фона;
3. `image` — замена фона на виртуальную картинку из списка.

Эффект виден и в локальном превью, и собеседникам (подмена видео-трека
через `replaceTrack` на передатчике). Работает в обоих типах звонков — P2P
(`call.ts` + `CallUI`) и групповых (`groupCall.ts` + `CallStage`).

Целевая производительность: 30+ FPS на 720p без фризов интерфейса.

## Решения (по итогам вопросов)

| Вопрос | Решение |
|---|---|
| Область применения эффекта | Локальное превью + собеседники (replaceTrack) |
| Типы звонков | И P2P, и групповые |
| Размещение UI | Полная галерея в настройках «Видео» + быстрая панель в звонке |
| Источник фонов | Фиксированный набор файлов в каталоге на сервере, список из скана каталога |
| Движок | `@mediapipe/tasks-vision` ImageSegmenter (GPU, WebGL/WASM), модель `selfie_multiclass_256x256` |

## Архитектура клиента

### Новые файлы

```
client/src/services/videoBackground.ts   — VideoBackgroundProcessor (движок)
client/src/hooks/useVideoEffects.ts      — публичный хук
client/src/stores/backgroundStore.ts     — zustand: режим/фон/список
client/src/components/settings/BackgroundSettings.tsx — секция настроек + превью
client/src/components/call/BackgroundPicker.tsx       — быстрая панель в звонке
client/src/components/call/BackgroundPicker.css
```

### Публичный хук

```ts
useVideoEffects(
  input: MediaStream | null,
  mode: 'none' | 'blur' | 'image',
  backgroundImageId: string | null,
  onTrack: (track: MediaStreamTrack | null) => void, // подмена трека в звонке
): {
  output: MediaStream | null;
  status: 'loading' | 'ready' | 'error';
}
```

- `input === null` или `mode === 'none'` → движок простаивает, `output` === `input`
  как есть (0% GPU, canvas-цепочка не подключена).
- Подключение: `CallUI` и `CallStage` монтируют хук каждый на свой
  `localStreamState`; `onTrack` → `service.setCameraOutput(track)`.
- Хук следит за сменой камерного трека внутри пути (ре-аквайр камеры после
  фона в групповом звонке, смена устройства) и пересоздаёт конвейер на новом
  треке.
- При размонтировании: `dispose()` движка — остановка канвас-трека, сброс
  подмены трека на оригинальный.
- Аудио-треки движок не трогает никогда: подменяется только видео-трек, аудио
  остаётся на сендере как было.

### Движок VideoBackgroundProcessor (главный поток)

Пайплайн на кадр (rAF-луп):

1. Локальный `<video>` (muted, playsInline) проигрывает входной поток.
2. **Сегментация:** кадр рисуется в малый canvas 320×180 (`drawImage` — GPU,
   без CPU-читалки); `segmentForVideo` модели `selfie_multiclass_256x256`
   (WebGL внутри MediaPipe Tasks) → confidence-маска человека (мягкие края).
3. **Композит** на canvas разрешения камеры:
   - `blur`: фон = тот же кадр с `ctx.filter = 'blur(...)'`; силуэт человека
     (маска через `destination-in` на отдельном person-canvas) поверх — резкий.
   - `image`: фон = `drawImage(фоновое изображение, cover-fit)`; силуэт поверх.
   - Маска из 320×180 в полный размер — `drawImage`-апскейл (GPU, мягкие края).
4. `canvas.captureStream(0)` + явный `requestFrame()` после нового кадра —
   pull-режим: рендер только когда энкодеру нужен кадр; в `none`-режиме
   канвас-цепочка не запускается вовсе.

Прочее:

- Фоновое изображение (mode `image`) прелоадится `HTMLImageElement`'ом по URL из
  списка; cover-fit — pure-функция (тестируется).
- При `document.hidden` отсутствует через rAF автоматически (браузер не тикает
  rAF в фоне).
- Неудача загрузки модели → `status: 'error'`, хук отдаёт исходный поток,
  приложение продолжает работать; UI показывает предупреждение.
- Один инстанс движка на активную звёздную поверхность (CallUI и CallStage
  рендерятся взаимоисключающе).

## Интеграция подмены трека

### Единый метод в обеих службах

```ts
setCameraOutput(track: MediaStreamTrack | null): void
// null — вернуть исходный камерный трек обратно
```

Применяет подмену в двух местах:

1. `peerConnection`: видео-сендер камеры → `sender.replaceTrack(newTrack)`.
2. `localStream`: `removeTrack(старый) / addTrack(новый)` — чтобы всё, что
   читает `localStream.getVideoTracks()[0]` (превью, статистика, VYC-96
   placeholder-логика), видело актуальный трек без дополнительных правок.

### P2P — `call.ts`

- Видео-сендер единственный: `peerConnection.getSenders().find(s => s.track?.kind === 'video')`.
- `toggleMuteVideo` уже работает через `localStream.getVideoTracks()[0].enabled`
  (строка ~200) — после подмены мутится эффект-трек, правок не требует.
- Исходный камерный трек запоминается (`cameraTrack`), возвращается при `null`.

### Групповой — `groupCall.ts`

- Вся камерная логика строится вокруг трека в `localStream`; после
  `removeTrack/addTrack` существующие механики (мьют, `cameraPlaceholder`,
  `releaseCameraForBackground`, `reacquireCameraAfterBackground`) продолжают
  работать без изменений, т.к. ищут трек в `localStream`.
- `releaseCameraForBackground` при активном эффекте стопает исходную камеру, а
  эффект-трек продолжает отдавать (уже «замороженный») кадр — поведение лучше
  нынешнего placeholder. Дополнительных правок не требует.
- После `reacquireCameraAfterBackground` хук получает сигнал о новом треке
  (`onCameraTrackChanged` / наблюдение за `getVideoTracks()[0]`) и пересоздаёт
  конвейер на свежем треке.

## Стор и UI

### `backgroundStore.ts` (zustand, персист в localStorage)

```ts
mode: 'none' | 'blur' | 'image';
backgroundId: string | null;
list: Background[] | null;   // GET /api/v1/backgrounds (кэш, один фетч)
listStatus: 'idle' | 'loading' | 'ready' | 'error';
// actions: setMode, setBackground, fetchBackgrounds
```

### Настройки — `BackgroundSettings` в разделе «Видео»

- Три кнопки-переключателя: Оригинал / Размытие / Картинка.
- При режиме «Картинка» — грид-галерея миниатюр из `url`, выбранный отмечен.
- Живое превью: маленький `<video>` + тот же `useVideoEffects` с временной
  камерой (`getUserMedia` при открытии раздела, стоп при закрытии) — заодно
  валидирует движок вне звонка.
- При `listStatus === 'error'` — сообщение о недоступности списка.
- При `status: 'error'` движка — предупреждение «эффект недоступен».

### Быстрая панель в звонке — `BackgroundPicker` (CallUI + CallStage)

- Кнопка с иконкой `Layers` (lucide) в панели управления у локального превью.
- Поповер по overlay-контракту дизайн-системы: `useDismissOnOutside`, токен
  `--z-popover`, Escape закрывает, не блокирует ничего.
- Внутри: 3 кнопки режимов + при «Картинке» горизонтальная лента миниатюр.
- CSS: токены дизайн-системы, `component-thing` именование классов.

### i18n

Новые ключи в `ru.ts` и `en.ts` (гейт `check:i18n`):

```
settings.backgroundTitle, settings.backgroundDescription
settings.bgModeNone, settings.bgModeBlur, settings.bgModeImage
settings.backgroundUnavailable
call.bgMenu, call.bgModeNone, call.bgModeBlur, call.bgModeImage
call.bgUnavailable
```

## Бэкенд (Go)

### Конфиг — `internal/config/config.go`

```go
BackgroundsDir      string // env BACKGROUNDS_DIR, default ./backgrounds
BackgroundsURLPrefix string // env BACKGROUNDS_URL_PREFIX, default /backgrounds
```

### Хендлер — `internal/delivery/http/handler/background.go`

Без usecase/БД (паттерн `uploadsHandler`, а не `StickerHandler` — список
сканируется с диска):

- `ListBackgrounds` — скан `BackgroundsDir`, фильтр расширений
  (`.jpg/.jpeg/.png/.webp`), сортировка по имени, ответ:
  ```json
  { "backgrounds": [ { "id": "ocean", "name": "ocean", "url": "/backgrounds/ocean/file" } ] }
  ```
- `ServeFile` — безопасный резолв `{id}` → путь внутри каталога (на базе
  нормализации из `uploads.go`), `http.ServeFile`, 404 если файла нет.

### Маршруты — `cmd/api/main.go`

```go
router.HandleFunc("GET /api/v1/backgrounds", authMid.RequireAuth(backgroundHandler.ListBackgrounds))
router.Handle("GET /backgrounds/{id}/file", backgroundHandler.ServeFile) // публичный, как /uploads/
```

### Клиент — `src/services/api.ts`

- `fetchBackgrounds()` через существующий request-хелпер (bearer).
- `url` из ответа резолвится через `API_BASE_URL` (паттерн `resolveUrl`).

### Тесты — `background_test.go`

Список из `t.TempDir()` (фильтр, сортировка, пустой каталог → `[]`); раздача
файла (200, 404, path traversal отклонён).

## Пакетирование ассетов модели

- `@mediapipe/tasks-vision` в `dependencies`.
- npm-скрипт `copy-mediapipe-assets` (паттерн `copy-audio-assets`): копирует
  `image_segmenter.wasm` + `selfie_multiclass_256x256.tflite` из node_modules в
  `public/vision/`; вызывается в цепочке `build:vite`.
- `electron-builder`: в `asarUnpack` добавить `dist/vision/**`.

## Тестирование и гейты

- **Client (Vitest):** `backgroundStore.test.ts` (режимы, парсинг ответа,
  персист); расширение теста парсинга API; pure-функции движка (cover-fit,
  резолв url). Движок/GPU не юнит-тестируются — проверяется через превью в
  настройках.
- **Gates:** `npx tsc --noEmit` → 0 байт; `npx stylelint "src/**/*.css"` → 0
  байт; `npm run check:i18n` → чисто; `npm test` → ровно 3 известных фейла,
  новых нет.
- **Go:** `make test`, `make vet`, `make lint` (из корня).
- **Ручная проверка:** превью в настройках (обе темы), панель в P2P и
  групповом звонке, смена камеры, ре-аквайр после фона группы, мьют видео при
  активном эффекте, FPS на 720p без фризов UI.

## Не-цели

- Улучшение качества сегментации вне готовой модели (трекинг, временная
  стабилизация маски) — отдельная задача при необходимости.
- Админ-загрузка фонов в БД — при необходимости отдельной фичей.
- Вынос пайплайна в Web Worker / OffscreenCanvas — запасной путь при
  профилировании; в текущей версии движок на главном потоке (нагрузка на JS
  мала: GPU делает всё тяжёлое).

## Риски

- Качество маски на сложных фонах/волосах — ограничение модели, не баг.
- `ctx.filter` blur в Chromium на большом canvas может быть дорогим — при
  фризах размытие можно считать на 480p-канвасе и апскейлить.
- mediapipe wasm/tflite в asar — закрыто `asarUnpack`.