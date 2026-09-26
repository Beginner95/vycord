# Дизайн: имена устройств ввода/вывода и выбор устройств в настройках

Дата: 2026-09-26
Ветка: `VYC-99-camera-and-microphone-name`

## Проблема

Три селекта устройств в настройках — статичные плейсхолдеры с одной опцией
«по умолчанию», без перечисления реальных устройств:

- Настройки → Аудио → «Устройства»: ввод (`AudioSettings.tsx:271-284`),
  вывод (`AudioSettings.tsx:286-299`)
- Настройки → Видео → Камера (`VideoSettings.tsx:15-22`)

`enumerateDevices` нигде не доходит до настроек: все звонковые пути
(`groupCall.acquireMedia`, `rebuildMicPipeline`, P2P `call.ts`, тест микрофона)
работают с системными устройствами по умолчанию без `deviceId`.

Пользователи с несколькими микрофонами/динамиками/камерами не видят имён
устройств и не могут выбрать конкретное.

## Решения

- Селекты показывают имена реальных устройств + опцию «Система по умолчанию».
- Выбор применяется: микрофон/камера через `deviceId` в `getUserMedia`,
  динамики через `setSinkId`. Применяется и на десктопе, и на мобилке.
- Мобильная кнопка переключения динамика на экране звонка остаётся, но
  получает список устройств из общего стора.
- Псевдоустройства `default`/`communications` не показываются в списках —
  им соответствует опция «Система по умолчанию» (значение `''`).
- Разрешение на микрофон запрашивается тихо при открытии раздела «Аудио»,
  на камеру — при открытии раздела «Видео» (метки устройств доступны только
  после выдачи разрешения).
- При удалении выбранного устройства из системы — автооткат на `''`.

## Архитектура

### 1. Стор `client/src/stores/mediaDeviceStore.ts` (Zustand)

Состояние:

- `devices: Record<DeviceKind, MediaDeviceInfo[]>` — по
  `audioinput | audiooutput | videoinput`; из реальных списков выкинуты
  псевдоустройства `default`/`communications`
- `selected: Record<DeviceKind, string>` — выбранный `deviceId`;
  **`''` = «Система по умолчанию»** — констрейнт не выставляется
- `permissions: Record<DeviceKind, 'unknown'|'granted'|'denied'>`

Действия:

- `ensurePermission(kind)` — тихий `getUserMedia({ audio: true })` /
  `({ video: true })`, затем `refreshDevices()`. Исключения (NotAllowedError
  и пр.) валятся в `'denied'`, не пробрасываются наверх.
- `refreshDevices()` — `enumerateDevices()`, раскладка по kind, фильтрация
  псевдоустройств, затем `prune()`.
- `setSelected(kind, id)` — обновляет стор, пишет в localStorage; если
  `kind === 'audiooutput'` — применяет вывод сразу через
  `applySinkToCallAudio(id)` (см. раздел «Вывод»).
- `prune()` — если `selected[kind]` отсутствует в свежем списке → сброс в `''`.
  Без ошибок и уведомлений.
- Хелперы `isReady(kind)` и геттеры (`getState()` поверх Zustand) для чтения
  из не-React кода (звонковый слой).

Персистентность: localStorage, ключ `vycord_media_devices`, значение
`{ audioinput, audiooutput, videoinput }` (deviceId). Инициализация читает
сохранённое; валидация происходит при первом `refreshDevices()` через `prune()`.

### 2. Вотчер `watchDeviceChange()`

Модульная функция, вызывается один раз при старте приложения (десктоп и
мобилка): подписка на `navigator.mediaDevices.devicechange` → дебаунс 300 мс →
`refreshDevices()`. Списки обновляются живьём, пока приложение открыто. Метки
остаются после выдачи разрешения (permission держится на origin).

### 3. Хелперы констрейнтов

Новый модуль `client/src/services/mediaDevices.ts`:

- `buildMicConstraints()` — возвращает MIC_AUDIO_CONSTRAINTS-подобный объект;
  при выбранном микрофоне добавляет `deviceId: { exact }`, при `''` — как сейчас
- `buildCameraConstraints()` — то же для камеры

Обе функции читают `selected` из стора.

### 4. Применение выбора в звонковом слое

**Ввод и камера:**

- `groupCall.acquireMedia` (`groupCall.ts:1763-1780`) — ограничения собираются
  через хелперы
- `rebuildMicPipeline` (`groupCall.ts:1918`) — тот же хелпер: перезахват идёт
  на выбранный микрофон
- P2P `call.ts` (`:59-69`, `:136-146`) — те же хелперы
- тест микрофона (`AudioSettings.tsx:81`) — через хелпер

**Откат при провале:** если `getUserMedia` с `{ exact }` упал (устройство
занято/выдрано), существующие фолбэки `acquireMedia` пробуют следующие
комбинации без `deviceId` — звонок продолжается с системным дефолтом. Выбор
в настройках сохраняется; следующий звонок попробует применить его снова.

**Вывод (динамики):**

- при выборе в настройках — сразу `applySinkToCallAudio(id)` из
  `client/src/components/call/callAudioSinks.ts` (реестр уже переживает звонки
  через `resetCallAudioSink`)
- при вступлении в звонок выбранный sink применяется повторно в точке, где
  сейчас вызывается `applySinkId` (`useCallStageModel.ts:668-679`)

### 5. Мобильная кнопка динамика

`client/src/mobile/hooks/useAudioOutput.ts` перестаёт сам вызывать
`enumerateDevices`: читает `devices.audiooutput` из стора. Публичный контракт
`{ supported, cycle, currentLabel }` не меняется → `MobileCallScreen` не
трогаем. Логика цикла и `applySinkId` остаются.

### 6. UI селектов

Селекты в `AudioSettings.tsx` (ввод, вывод) и `VideoSettings.tsx` (камера):

- первая опция — значение `''`, текст из существующих строк
  (`settings.defaultMicrophone` / `defaultSpeakers` / `defaultCamera`)
- затем реальные устройства: `<option value={deviceId}>{label}</option>`
- `value` селекта из `selected[kind]`, `onChange` → `setSelected(kind, value)`
- пустая `label` (разрешение не дано) → строка `settings.unnamedDevice`;
  ключ option — `deviceId`; устройства с одинаковыми метками не схлопываются
- разметка без изменений: `.select-wrap` / `.select-control` /
  `.select-chevron` (канонические примитивы, `primitives.css:177-217`)

Открытие раздела «Аудио» → `ensurePermission('audioinput')`. Открытие раздела
«Видео» → `ensurePermission('videoinput')`. Метки `audiooutput` появляются
в Chromium вместе с разрешением на микрофон, отдельного запроса не требуют.

## Краевые случаи

| Ситуация | Поведение |
|---|---|
| Разрешение отказано | Список: только «по умолчанию» + реальные устройства с текстом «Без названия» |
| Устройств нет вообще | Только опция «по умолчанию» |
| Выбранное устройство удалено | `prune()` на `devicechange` → автооткат на `''` без ошибки |
| gUM с `{ exact }` упал | Фолбэк без `deviceId`, звонок идёт; выбор сохранён |
| `devicechange` во время звонка | Списки обновляются живьём; `checkMicMigration`/`rebuildMicPipeline` не меняют логику, только собирают constraints через хелперы |

## i18n

Одна новая строка в `ru.ts`/`en.ts` (обязательна симметрия, гейт
`npm run check:i18n`):

- `settings.unnamedDevice` — «Без названия» / «Unnamed device»

Имена устройств из `label` не переводятся — это системные строки ОС.

## Тестирование

Витест, паттерн фикстур как в
`client/src/mobile/hooks/__tests__/useAudioOutput.test.ts` (помеченные
`MediaDeviceInfo`):

- стор: раскладка по kind; фильтрация `default`/`communications`; `prune`
  сбрасывает пропавший выбор; `setSelected` пишет в localStorage;
  инициализация читает сохранённое
- хелперы констрейнтов: `''` → без `deviceId`; выбранный id → `{ exact }`
- `useAudioOutput`: читает список из стора; цикл и метка работают

В существующих тестах `groupCall` стор мокается так, что `selected` = `''` —
поведение текущих тестов не меняется.

## Гейты

Из `client/`: `npx tsc --noEmit` (0 байт вывода), stylelint (0 ошибок),
`npm run check:i18n`, `npm test` — единственные падения: 3 в
`api.network-retry.test.ts` (не трогать).

## Не входит в объём

- Автоматическое переключение микрофона в звонке (логика `checkMicMigration`
  не меняется)
- Управление громкостью микрофона/устройств
- Гостевая страница (`GuestPage`) — у гостя нет настроек