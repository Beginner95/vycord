# VYC-38: Автовключение шумоподавления — дизайн

Дата: 2026-07-19. Ветка: `VYC-38-nc-default-enable`.

## Цель

Шумоподавление (NC) включено по умолчанию после авторизации и реально применяется
к аудиопотоку в звонках; пользователь может включать/выключать его в любой момент,
включая активный звонок; ручной выбор сохраняется. Архитектура допускает добавление
новых моделей NC без переписывания основной логики.

## Принятые решения

1. **Default-on + персист.** NC включено по умолчанию для всех. Ручной выбор
   (вкл/выкл) сохраняется в `localStorage` и переживает перезапуск и перелогин.
   «Автовключение после авторизации» = дефолт настройки устройства, а не действие
   при каждом логине. Консистентно с остальными аудионастройками (`audioService`).
2. **Ленивое применение.** Вне звонка NC — персистентный флаг-намерение; микрофон
   не захватывается, пайплайн не строится. Пайплайн создаётся в момент появления
   реального аудиопотока (старт звонка).
3. **Только архитектура выбора модели, без UI.** Registry моделей + `setModel()`;
   по умолчанию DeepFilterNet3, RNNoise регистрируется как вторая модель.
   UI-селектор — вне скоупа.
4. **Единая Web Audio цепочка для mid-call toggle.** Аудио в звонке всегда идёт
   через один AudioContext; toggle — перекоммутация нод без `replaceTrack` и
   ренегоциации.

## Текущее состояние (до изменений)

- `client/src/services/noiseCancellation.ts` — DeepFilterNet3 через
  AudioWorklet + Web Worker + WASM; синглтон. Источник истины — in-memory
  `state.isEnabled`, не персистится.
- Тумблер в `Settings.tsx` при включении захватывает отдельный «тестовый»
  getUserMedia-стрим и строит пайплайн на нём; стрим никогда не освобождается
  (утечка, микрофон занят).
- `call.ts` и `groupCall.ts` вызывают `applyToStream(raw)` на старте звонка —
  обработка применяется только если флаг включён в этот момент.
- Переключение во время звонка не влияет на активный звонок.
- Бейдж `🔇 NC` в `ChannelSidebar.tsx` рядом с именем пользователя подписан на
  `onStateChange`.
- Модель `'deepfilternet'` и её конфиг захардкожены в `buildProcessor`;
  `rnnoise.wasm` грузится как fallback, но не выбирается.
- `groupCall.ts` содержит `routeAudioThroughWebAudio` — костыль: при выключенном
  NC звук всё равно прогоняется через Web Audio (баг Chrome с push-model
  захватом, когда Opus получает ноль фреймов).

## Секция 1 — Архитектура сервиса и registry моделей

Новый модуль `client/src/services/ncModels.ts`:

```ts
type NcModelId = 'deepfilternet3' | 'rnnoise';

interface NcModelDefinition {
  id: NcModelId;
  label: string;
  wasmAssets: string[];                  // какие .wasm грузить
  workerModuleId: string;                // moduleId для INIT воркера
  moduleConfig: Record<string, unknown>; // attenLimDb, postFilterBeta и т.п.
}

const NC_MODELS: Record<NcModelId, NcModelDefinition>;
const DEFAULT_NC_MODEL: NcModelId = 'deepfilternet3';
```

Захардкоженные `'deepfilternet'` и `moduleConfigs` переезжают из
`buildProcessor` в registry. RNNoise регистрируется как вторая модель —
расширяемость доказана без UI.

Состояние сервиса (единственный источник истины для UI и пайплайна):

```ts
{
  isEnabled: boolean;   // намерение пользователя, персистится
  isActive: boolean;    // worklet реально в аудиоцепочке (только в звонке)
  isLoading: boolean;
  error: string | null;
  modelId: NcModelId;
}
```

Персист: `localStorage['vycord_nc_settings'] = { enabled, modelId }`,
дефолт `{ enabled: true, modelId: 'deepfilternet3' }`. Читается при создании
синглтона.

Публичное API (заменяет `enableNoiseCancellation` / `disableNoiseCancellation` /
`applyToStream`):

- `setEnabled(enabled: boolean): Promise<void>` — единственная точка toggle:
  персистит и коммутирует все активные цепочки.
- `setModel(modelId: NcModelId): void` — персистит; применяется при следующем
  построении worklet-этапа. Горячая смена модели в активном звонке — вне скоупа.
- `createChain(rawStream: MediaStream): Promise<MediaStream>` — для сервисов
  звонков; возвращает стрим со стабильным аудиотреком.
- `releaseChain(streamId: string)` / `cleanup()` — конец звонка.

## Секция 2 — Единая аудиоцепочка и интеграция

В звонке аудио всегда идёт через Web Audio; наружу отдаётся трек
`MediaStreamAudioDestinationNode` — он стабилен на весь звонок:

```
NC ON:   mic → source → worklet(модель из registry) → destination → sender
NC OFF:  mic → source ────────────────────────────→ destination → sender
```

- Toggle mid-call = `connect`/`disconnect` нод в том же AudioContext. Трек не
  меняется → без `replaceTrack`, без ренегоциации; одинаково работает для p2p
  (`call.ts`) и SFU (`groupCall.ts`).
- При включении mid-call WASM догружается (индикация `isLoading`), затем worklet
  вставляется в цепочку.
- `routeAudioThroughWebAudio` в `groupCall.ts` удаляется — его роль (обход бага
  Chrome) теперь выполняет `createChain`, который всегда роутит через Web Audio.
- Логика `resume()` для suspended AudioContext сохраняется.

Интеграция:

- `call.ts` (startCall, acceptCall) и `groupCall.ts` (doJoinGroupCall):
  `applyToStream(raw)` → `createChain(raw)`; на teardown звонка — `releaseChain`.
- `Settings.tsx`: тумблер вызывает `setEnabled(next)`. Захват тестового
  getUserMedia-стрима удаляется — вне звонка включение меняет только флаг и
  персист (заодно чинится утечка стрима).
- `ChannelSidebar.tsx`: бейдж `🔇 NC` без изменений — та же подписка
  `onStateChange`, показывает `isEnabled`. Синхронизация UI↔пайплайн
  гарантирована: оба — проекции одного состояния сервиса.

## Секция 3 — Ошибки и edge cases

- **Сбой WASM/инициализации** (на старте звонка или mid-call): цепочка остаётся
  в bypass — звук идёт без обработки, звонок не ломается. Runtime
  `isEnabled → false` + `error` (бейдж гаснет — UI показывает факт), но персист
  не перетирается: ошибка ≠ ручное выключение; при следующем запуске/звонке
  попытка повторяется.
- **Гонки**: `setEnabled` во время построения цепочки сериализуется в сервисе
  (очередь через промис, последний вызов побеждает); тумблер disabled при
  `isLoading`. Повторный `createChain` для того же стрима переиспользует
  цепочку.
- **Нет AudioWorklet** (`isSupported() === false`): тумблер disabled,
  `createChain` возвращает сырой стрим.
- **Нет микрофона**: цепочка не строится, поведение звонков не меняется.
- **Перелогин/другой пользователь на устройстве**: настройка общая для
  устройства — консистентно с `audioService`.
- **Одновременные p2p и групповой звонок**: Map цепочек по `stream.id`
  сохраняется; toggle применяется ко всем активным цепочкам.

## Секция 4 — Тесты

Юнит-тестов в клиенте нет; есть e2e-инфраструктура
(`client/e2e/`: headless Chrome + реальный SFU + vite). По её образцу
добавляется `client/e2e/nc-toggle.html` + прогон в `run.sh`:

1. Чистый localStorage → `isEnabled === true` (default-on).
2. `createChain` при включённом NC: выходной трек живой, счётчик обработанных
   фреймов из воркера > 0 — доказательство, что обработка реально применяется.
3. Toggle off mid-chain → фреймы через worklet перестают идти, аудио продолжает
   идти в destination; toggle on → фреймы снова идут.
4. Персист: `setEnabled(false)` → перезагрузка страницы → `isEnabled === false`.

## Критерии готовности

- После авторизации на чистом устройстве NC включено (бейдж горит) и реально
  применяется при первом же звонке.
- Toggle во время звонка меняет фактическую обработку аудио без перезагрузки.
- Ручное выключение переживает перезапуск и перелогин.
- Бейдж рядом с именем пользователя и тумблер в Settings отражают фактическое
  состояние сервиса.
- DeepFilterNet3 работает как раньше; добавление новой модели = запись в
  `NC_MODELS`.
- Существующая логика авторизации и звонков не нарушена; e2e-тесты проходят.

## Изменяемые файлы

- `client/src/services/ncModels.ts` — новый (registry).
- `client/src/services/noiseCancellation.ts` — состояние, персист, API,
  единая цепочка.
- `client/src/services/call.ts` — `createChain`/`releaseChain`.
- `client/src/services/groupCall.ts` — `createChain`/`releaseChain`, удаление
  `routeAudioThroughWebAudio`.
- `client/src/components/Settings.tsx` — тумблер через `setEnabled`, удаление
  тестового стрима.
- `client/src/components/ChannelSidebar.tsx` — без изменений (проверить
  подписку).
- `client/e2e/nc-toggle.html`, `client/e2e/run.sh` — новый e2e-тест.
