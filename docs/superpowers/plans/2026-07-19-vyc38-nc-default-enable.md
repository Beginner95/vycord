# VYC-38: Автовключение шумоподавления — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шумоподавление включено по умолчанию (default-on + персист), реально применяется к аудиопотоку через единую Web Audio цепочку, переключается во время звонка без ренегоциации; registry моделей позволяет добавлять новые модели без переписывания логики.

**Architecture:** Аудио звонков всегда идёт через `mic → source → [worklet] → destination → sender`; трек `destination` стабилен весь звонок, toggle = перекоммутация нод. Источник истины — синглтон `noiseCancellationService` с персистом намерения в `localStorage['vycord_nc_settings']`. Спека: `docs/superpowers/specs/2026-07-19-nc-default-enable-design.md`.

**Tech Stack:** TypeScript + React (vite), Web Audio API (AudioWorklet), Web Worker + WASM (`@cc-livekit/audio-pipeline-plugin`: DeepFilterNet3/RNNoise), e2e — headless Chrome через `client/e2e/run.sh`.

## Global Constraints

- **Коммиты и пуши делает пользователь сам.** НЕ выполнять `git commit`/`git push`; в конце каждой задачи оставить изменения в рабочем дереве и сообщить, что задача готова к коммиту. НИКОГДА не добавлять Claude как co-author.
- Node ≥ 20.19 нужен для vite; `run.sh` сам подхватывает новейший node из nvm.
- e2e гоняется командой `cd client && npm run test:e2e`; фильтр одного сценария: `E2E_ONLY=nc-toggle npm run test:e2e` (фильтр добавляется в Task 2).
- UI-бейдж `🔇 NC` в `ChannelSidebar.tsx` (строка ~148) и его расположение НЕ менять.
- Ключ localStorage: `vycord_nc_settings`, формат `{ enabled: boolean, modelId: NcModelId }`, дефолт `{ enabled: true, modelId: 'deepfilternet3' }`.
- До Task 6 включительно `tsc` может падать (старое API удалено в Task 3, потребители чинятся в Tasks 4–6) — это ожидаемо; полная проверка типов в Task 7.

---

### Task 1: Registry моделей `ncModels.ts`

**Files:**
- Create: `client/src/services/ncModels.ts`

**Interfaces:**
- Produces: `type NcModelId = 'deepfilternet3' | 'rnnoise'`, `interface NcModelDefinition`, `const NC_MODELS: Record<NcModelId, NcModelDefinition>`, `const DEFAULT_NC_MODEL: NcModelId`. Их импортирует Task 3.

- [ ] **Step 1: Создать файл registry**

```ts
/**
 * Registry моделей шумоподавления.
 *
 * Добавление новой модели = новая запись здесь (+ поддержка её moduleId в
 * AudioPipelineWorker). Основная логика сервиса от конкретной модели не зависит.
 */

export type NcModelId = 'deepfilternet3' | 'rnnoise';

export interface NcModelDefinition {
  id: NcModelId;
  label: string;
  /** moduleId для INIT воркера и stages.denoise ворклета. */
  workerModuleId: string;
  /** moduleConfigs[workerModuleId] для INIT/INIT_PIPELINE. */
  moduleConfig: Record<string, unknown>;
}

export const NC_MODELS: Record<NcModelId, NcModelDefinition> = {
  deepfilternet3: {
    id: 'deepfilternet3',
    label: 'DeepFilterNet3',
    workerModuleId: 'deepfilternet',
    moduleConfig: { attenLimDb: 100, postFilterBeta: 0.02 },
  },
  rnnoise: {
    id: 'rnnoise',
    label: 'RNNoise',
    workerModuleId: 'rnnoise',
    moduleConfig: {},
  },
};

export const DEFAULT_NC_MODEL: NcModelId = 'deepfilternet3';
```

- [ ] **Step 2: Проверить типы**

Run: `cd /www/my/vycord/client && npx tsc --noEmit`
Expected: PASS (0 ошибок; файл ещё никем не импортируется).

- [ ] **Step 3: Сообщить пользователю, что задача готова к коммиту** (сам коммит делает пользователь).

---

### Task 2: e2e-тест `nc-toggle.html` + мультисценарный `run.sh` (падающий тест)

**Files:**
- Create: `client/e2e/nc-toggle.html`
- Modify: `client/e2e/run.sh` (блок запуска Chrome, строки ~77–120)

**Interfaces:**
- Consumes: будущее API `noiseCancellationService` из Task 3: `getState(): { isEnabled, isActive, isLoading, error, modelId }`, `createChain(raw: MediaStream): Promise<MediaStream>`, `setEnabled(enabled: boolean): Promise<void>`.
- Produces: сценарий `nc-toggle` в `run.sh`, переменная окружения `E2E_ONLY=<имя>` для запуска одного сценария.

- [ ] **Step 1: Создать страницу теста**

Полное содержимое `client/e2e/nc-toggle.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>E2E: noise cancellation default-on and mid-call toggle</title>
</head>
<body>
  <pre id="status">starting…</pre>

  <script type="module">
    // E2E: шумоподавление default-on, реально влияет на звук, переключается на лету.
    //
    // Фаза 1 (чистый localStorage):
    //   1. isEnabled === true без каких-либо действий (default-on).
    //   2. createChain(белый шум) → isActive === true; медианный RMS выхода при
    //      включённом NC заметно ниже RMS bypass — алгоритм реально давит шум,
    //      а не только меняет флаг в UI.
    //   3. setEnabled(false) mid-chain → isActive === false, шум проходит (bypass).
    //   4. setEnabled(true) mid-chain → шум снова подавлен.
    //   5. setEnabled(false) + reload → фаза 2.
    // Фаза 2 (свежая загрузка): isEnabled === false (ручное выключение персистится).
    //
    // Result protocol: одна строка "E2E_RESULT {json}" — как в no-camera-screenshare.

    const statusEl = document.getElementById('status');
    function log(...args) {
      console.log('[E2E]', ...args);
      statusEl.textContent += '\n' + args.map(String).join(' ');
    }

    let finished = false;
    function finish(pass, reason, extra = {}) {
      if (finished) return;
      finished = true;
      console.log('E2E_RESULT ' + JSON.stringify({ pass, reason, ...extra }));
    }

    // Страница обязана дать результат сама; после reload таймер стартует заново.
    setTimeout(() => finish(false, 'watchdog timeout (90s)'), 90000);

    function makeNoiseStream() {
      const ctx = new AudioContext({ sampleRate: 48000 });
      const buf = ctx.createBuffer(1, 48000, 48000);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 0.6 - 0.3;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dst = ctx.createMediaStreamDestination();
      src.connect(dst);
      src.start();
      return dst.stream;
    }

    // Медианный RMS трека за durationMs после warmupMs (медиана гасит выбросы
    // на границах переключения).
    async function measureRms(stream, warmupMs, durationMs) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      if (ctx.state !== 'running') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      await new Promise((r) => setTimeout(r, warmupMs));
      const samples = [];
      const t0 = Date.now();
      while (Date.now() - t0 < durationMs) {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        samples.push(Math.sqrt(sum / data.length));
        await new Promise((r) => setTimeout(r, 100));
      }
      ctx.close().catch(() => {});
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)];
    }

    async function main() {
      if (location.hash !== '#phase2') {
        // ── Фаза 1 ──
        localStorage.clear();
        const { noiseCancellationService } = await import('/src/services/noiseCancellation.ts');

        const s0 = noiseCancellationService.getState();
        log('initial state:', JSON.stringify(s0));
        if (!s0.isEnabled) return finish(false, 'default-on failed: isEnabled=false on fresh storage', { state: s0 });

        const noise = makeNoiseStream();
        const out = await noiseCancellationService.createChain(noise);
        const s1 = noiseCancellationService.getState();
        log('after createChain:', JSON.stringify(s1));
        if (!s1.isActive) return finish(false, 'isActive=false after createChain with NC enabled', { state: s1 });
        if (out.getAudioTracks().length !== 1) return finish(false, 'no audio track in chain output');

        const rmsOn1 = await measureRms(out, 2000, 3000);
        log('rmsOn1 =', rmsOn1);

        await noiseCancellationService.setEnabled(false);
        const s2 = noiseCancellationService.getState();
        log('after setEnabled(false):', JSON.stringify(s2));
        if (s2.isActive) return finish(false, 'isActive=true after setEnabled(false)', { state: s2 });
        const rmsOff = await measureRms(out, 1000, 3000);
        log('rmsOff =', rmsOff);
        if (rmsOff < 0.05) return finish(false, 'bypass silent: noise does not pass when NC off', { rmsOff });

        await noiseCancellationService.setEnabled(true);
        const s3 = noiseCancellationService.getState();
        log('after re-enable:', JSON.stringify(s3));
        if (!s3.isActive) return finish(false, 'isActive=false after re-enable mid-chain', { state: s3 });
        const rmsOn2 = await measureRms(out, 2000, 3000);
        log('rmsOn2 =', rmsOn2);

        // Главная проверка: подавление реально меняет обрабатываемый звук.
        if (!(rmsOn1 < rmsOff * 0.5)) return finish(false, 'NC does not attenuate noise (initial)', { rmsOn1, rmsOff });
        if (!(rmsOn2 < rmsOff * 0.5)) return finish(false, 'NC does not attenuate noise (after re-enable)', { rmsOn2, rmsOff });

        // Ручное выключение + reload → фаза 2 проверит персист.
        await noiseCancellationService.setEnabled(false);
        sessionStorage.setItem('nc-e2e-phase1', JSON.stringify({ rmsOn1, rmsOff, rmsOn2 }));
        location.hash = '#phase2';
        location.reload();
      } else {
        // ── Фаза 2 ──
        const phase1 = JSON.parse(sessionStorage.getItem('nc-e2e-phase1') ?? 'null');
        if (!phase1) return finish(false, 'phase2 without phase1 results');
        const { noiseCancellationService } = await import('/src/services/noiseCancellation.ts');
        const s = noiseCancellationService.getState();
        log('phase2 state:', JSON.stringify(s));
        if (s.isEnabled) return finish(false, 'persisted disable lost after reload', { state: s });
        finish(true, 'ok', { ...phase1 });
      }
    }

    main().catch((err) => finish(false, 'exception: ' + (err && err.message ? err.message : String(err))));
  </script>
</body>
</html>
```

- [ ] **Step 2: Обобщить запуск Chrome в `run.sh` до нескольких сценариев**

В `client/e2e/run.sh` заменить блок от `echo "==> running headless Chrome"` до конца файла (строки ~77–120, включая текущие запуск Chrome, поллинг RESULT, разбор JSON и финальный `if/else`) на:

```bash
# Запускает один сценарий: страница обязана напечатать "E2E_RESULT {json}".
# E2E_ONLY=<имя> — прогнать только один сценарий.
run_scenario() {
  local name="$1" page_url="$2" log_file="$WORK_DIR/chrome-$name.log"
  if [ -n "${E2E_ONLY:-}" ] && [ "$E2E_ONLY" != "$name" ]; then
    echo "==> skipping scenario $name (E2E_ONLY=$E2E_ONLY)"
    return 0
  fi

  echo "==> running headless Chrome: $name"
  "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --autoplay-policy=no-user-gesture-required \
    --enable-logging=stderr \
    --user-data-dir="$WORK_DIR/chrome-profile-$name" \
    "$page_url" >"$log_file" 2>&1 &
  CHROME_PID=$!

  # The page prints one "E2E_RESULT {json}" line; poll for it (page watchdog: 90s).
  local result=""
  for _ in $(seq 1 220); do
    result="$(grep -o 'E2E_RESULT .*' "$log_file" 2>/dev/null | head -1)"
    [ -n "$result" ] && break
    kill -0 "$CHROME_PID" 2>/dev/null || break
    sleep 0.5
  done

  kill "$CHROME_PID" 2>/dev/null
  CHROME_PID=""

  [ -n "$result" ] || fail "$name: no E2E_RESULT in chrome output, see $log_file"

  # Strip prefix and the console-log quoting artifacts around the JSON.
  local json="${result#E2E_RESULT }"
  json="${json%\", source:*}"
  echo "==> $name result: $json"

  if echo "$json" | grep -q '"pass":true'; then
    echo "PASS: $name"
  else
    echo "--- [E2E] progress lines ($name):"
    grep -o '\[E2E\].*' "$log_file" | head -40
    fail "$name failed (full logs in $WORK_DIR)"
  fi
}

run_scenario "no-camera-screenshare" "http://localhost:$VITE_PORT/e2e/no-camera-screenshare.html"
run_scenario "nc-toggle" "http://localhost:$VITE_PORT/e2e/nc-toggle.html"

echo "PASS"
exit 0
```

Проверка вайтовой готовности выше по файлу (переменная `PAGE_URL`) остаётся как есть — она проверяет первую страницу; вторая обслуживается тем же vite.

- [ ] **Step 3: Запустить новый сценарий и убедиться, что он падает по правильной причине**

Run: `cd /www/my/vycord/client && E2E_ONLY=nc-toggle npm run test:e2e`
Expected: `FAIL` со строкой `nc-toggle failed`; причина — `default-on failed: isEnabled=false on fresh storage` (старый сервис стартует выключенным; это первый ассерт, до вызова ещё не существующего `createChain` дело не доходит). Если падение по другой причине (vite/Chrome не поднялся) — сначала чинить инфраструктуру.

- [ ] **Step 4: Проверить, что старый сценарий не сломан обобщением**

Run: `cd /www/my/vycord/client && E2E_ONLY=no-camera-screenshare npm run test:e2e`
Expected: `PASS: no-camera-screenshare` и итоговый `PASS`.

- [ ] **Step 5: Сообщить пользователю, что задача готова к коммиту.**

---

### Task 3: Переписать `noiseCancellation.ts` (персист, единая цепочка, toggle)

**Files:**
- Modify: `client/src/services/noiseCancellation.ts` (полная замена содержимого)
- Test: `client/e2e/nc-toggle.html` (из Task 2)

**Interfaces:**
- Consumes: `NC_MODELS`, `DEFAULT_NC_MODEL`, `NcModelId` из `./ncModels` (Task 1).
- Produces (используют Tasks 4–6):
  - `noiseCancellationService.getState(): { isEnabled: boolean; isActive: boolean; isLoading: boolean; error: string | null; modelId: NcModelId }`
  - `noiseCancellationService.onStateChange(listener): () => void`
  - `noiseCancellationService.createChain(rawStream: MediaStream): Promise<MediaStream>`
  - `noiseCancellationService.releaseChain(streamId: string): void`
  - `noiseCancellationService.setEnabled(enabled: boolean): Promise<void>`
  - `noiseCancellationService.setModel(modelId: NcModelId): void`
  - `noiseCancellationService.getChainContextState(streamId: string): string`
  - `noiseCancellationService.cleanup(): void`
  - `NoiseCancellationService.isSupported(): boolean` (статический, как раньше)
  - Старые `enableNoiseCancellation` / `disableNoiseCancellation` / `applyToStream` УДАЛЯЮТСЯ.

- [ ] **Step 1: Заменить содержимое файла**

Полное новое содержимое `client/src/services/noiseCancellation.ts`:

```ts
/**
 * Noise cancellation via AudioWorklet + Web Worker (модели — см. ncModels.ts).
 *
 * Аудио звонка ВСЕГДА идёт через единую Web Audio цепочку:
 *   mic → source → [worklet] → destination → sender
 * Трек destination стабилен на весь звонок; включение/выключение NC —
 * перекоммутация нод внутри того же AudioContext, без replaceTrack и
 * ренегоциации. Постоянный пропуск через Web Audio также решает баг Chrome с
 * push-model захватом (track live, но Opus получает ноль фреймов) — pull-model
 * рендер всегда производит фреймы для RTP.
 *
 * Источник истины для UI и пайплайна — состояние этого синглтона. Намерение
 * пользователя персистится в localStorage (default-on) и не перетирается
 * runtime-ошибками инициализации.
 *
 * Assets base URL is provided by the Electron preload (window.electronAPI.audioAssetsUrl),
 * which resolves to the correct path regardless of asar packaging or install location.
 * Falls back to '/audio/' for non-Electron environments (web dev, tests).
 *
 * Files:
 *   AudioPipelineWorklet.js  — real-time audio I/O worklet
 *   AudioPipelineWorker.js   — WASM compute worker
 *   deepfilter.wasm          — DeepFilterNet3 model (17 MB, weights embedded)
 *   rnnoise.wasm             — RNNoise model
 */

import { NC_MODELS, DEFAULT_NC_MODEL, type NcModelId } from './ncModels';

// window.electronAPI is populated synchronously by the preload before renderer scripts run.
const ASSETS_BASE: string = window.electronAPI?.audioAssetsUrl ?? '/audio/';
const WORKLET_NAME = 'AudioPipelineWorklet';
const NC_SETTINGS_KEY = 'vycord_nc_settings';

interface NcSettings {
  enabled: boolean;
  modelId: NcModelId;
}

interface NoiseCancellationState {
  /** Намерение пользователя (персистится; runtime-сброс при ошибке персист не трогает). */
  isEnabled: boolean;
  /** Worklet реально стоит в аудиоцепочке хотя бы одного активного звонка. */
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  modelId: NcModelId;
}

type StateListener = (state: NoiseCancellationState) => void;

interface WorkletStage {
  node: AudioWorkletNode;
  worker: Worker;
  modelId: NcModelId;
}

interface AudioChain {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
  /** Исходный getUserMedia-стрим: его аудиотреки стопаются в releaseChain,
   *  иначе микрофон остаётся захваченным после звонка. */
  rawStream: MediaStream;
  keepAlive: ReturnType<typeof setInterval>;
  /** addModule уже выполнен для этого AudioContext. */
  workletLoaded: boolean;
  stage: WorkletStage | null;
  /** true: source → worklet → destination; false: source → destination (bypass). */
  active: boolean;
}

function loadSettings(): NcSettings {
  try {
    const raw = localStorage.getItem(NC_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NcSettings>;
      return {
        enabled: parsed.enabled ?? true,
        modelId:
          parsed.modelId && parsed.modelId in NC_MODELS ? parsed.modelId : DEFAULT_NC_MODEL,
      };
    }
  } catch {
    /* битый storage — дефолты */
  }
  return { enabled: true, modelId: DEFAULT_NC_MODEL };
}

class NoiseCancellationService {
  private state: NoiseCancellationState;
  /** Персистируемое намерение. Отличается от state.isEnabled только после
   *  runtime-ошибки (ошибка ≠ ручное выключение). */
  private intendedEnabled: boolean;
  private listeners = new Set<StateListener>();
  /** key — id стрима, который вернул createChain. */
  private chains = new Map<string, AudioChain>();
  /** Сериализация createChain/setEnabled: коммутация нод не должна гоняться
   *  с построением worklet-этапа. */
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    const settings = loadSettings();
    this.intendedEnabled = settings.enabled;
    this.state = {
      isEnabled: settings.enabled,
      isActive: false,
      isLoading: false,
      error: null,
      modelId: settings.modelId,
    };
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  getState(): NoiseCancellationState {
    return { ...this.state };
  }

  static isSupported(): boolean {
    return (
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof fetch !== 'undefined'
    );
  }

  /** Диагностика для логов звонков. */
  getChainContextState(streamId: string): string {
    return this.chains.get(streamId)?.context.state ?? 'no-ctx';
  }

  private persist(): void {
    try {
      localStorage.setItem(
        NC_SETTINGS_KEY,
        JSON.stringify({ enabled: this.intendedEnabled, modelId: this.state.modelId }),
      );
    } catch {
      /* private mode / quota — настройка не переживёт перезапуск, не фатально */
    }
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.opQueue.then(op, op);
    this.opQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Строит аудиоцепочку звонка. Возвращает стрим со стабильным аудиотреком
   * (processed или bypass — трек один и тот же при любых toggle) плюс исходные
   * видеотреки. Без аудиотреков или без Web Audio возвращает rawStream как есть.
   */
  createChain(rawStream: MediaStream): Promise<MediaStream> {
    return this.enqueue(() => this.doCreateChain(rawStream));
  }

  private async doCreateChain(rawStream: MediaStream): Promise<MediaStream> {
    if (!rawStream.getAudioTracks().length || !NoiseCancellationService.isSupported()) {
      return rawStream;
    }

    const context = new AudioContext({ sampleRate: 48000 });
    // Chrome создаёт контекст suspended вне окна user-gesture; suspended контекст
    // даёт ноль фреймов → destination-трек не генерирует RTP и pion не видит трек.
    if (context.state !== 'running') {
      await context.resume().catch(() => {});
    }

    const source = context.createMediaStreamSource(rawStream);
    const destination = context.createMediaStreamDestination();

    // macOS/Android Chrome suspend-ят AudioContext без аудиовывода даже при
    // активном захвате: RTP шлётся, но Opus-фреймы зазероены. Поллинг + resume
    // держит контекст running (перенесено из groupCall.routeAudioThroughWebAudio).
    const keepAlive = setInterval(() => {
      if (context.state !== 'running') {
        context.resume().catch(() => {});
      }
    }, 2000);

    const chain: AudioChain = {
      context,
      source,
      destination,
      rawStream,
      keepAlive,
      workletLoaded: false,
      stage: null,
      active: false,
    };

    const outputStream = new MediaStream();
    destination.stream.getAudioTracks().forEach((t) => outputStream.addTrack(t));
    rawStream.getVideoTracks().forEach((t) => outputStream.addTrack(t));
    this.chains.set(outputStream.id, chain);

    if (this.state.isEnabled) {
      await this.activateChain(chain); // при ошибке сам уходит в bypass
    } else {
      this.wireBypass(chain);
    }
    this.refreshActive();
    this.notify();
    return outputStream;
  }

  /**
   * Единственная точка включения/выключения. Персистит намерение и
   * перекоммутирует все активные цепочки; вызовы сериализуются.
   */
  setEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(() => this.doSetEnabled(enabled));
  }

  private async doSetEnabled(enabled: boolean): Promise<void> {
    this.intendedEnabled = enabled;
    this.state.isEnabled = enabled;
    this.state.error = null;
    this.persist();
    this.notify();
    for (const chain of this.chains.values()) {
      if (enabled) {
        await this.activateChain(chain);
      } else {
        this.wireBypass(chain);
      }
    }
    this.refreshActive();
    this.notify();
  }

  /**
   * Выбор модели. Применяется при следующем построении worklet-этапа
   * (следующий звонок либо выкл/вкл NC); горячая смена в звонке — вне скоупа.
   */
  setModel(modelId: NcModelId): void {
    if (!(modelId in NC_MODELS)) return;
    this.state.modelId = modelId;
    this.persist();
    this.notify();
  }

  /**
   * Полный демонтаж цепочки в конце звонка. streamId — id стрима, который
   * вернул createChain; неизвестный id — no-op.
   */
  releaseChain(streamId: string): void {
    const chain = this.chains.get(streamId);
    if (!chain) return;
    this.destroyStage(chain);
    chain.source.disconnect();
    clearInterval(chain.keepAlive);
    chain.context.close().catch(() => {});
    chain.rawStream.getAudioTracks().forEach((t) => t.stop());
    this.chains.delete(streamId);
    this.refreshActive();
    this.notify();
  }

  /** Сносит все цепочки. Настройки (enabled/model) сохраняются. */
  cleanup(): void {
    for (const id of [...this.chains.keys()]) {
      this.releaseChain(id);
    }
    this.state.isLoading = false;
    this.state.error = null;
    // Runtime-сброс isEnabled из-за ошибки не должен пережить конец звонка.
    this.state.isEnabled = this.intendedEnabled;
    this.notify();
  }

  // ── Private: коммутация и построение worklet-этапа ─────────────────────────

  /**
   * Вставляет worklet в цепочку. При ошибке оставляет bypass (звонок не
   * ломается), пишет error и сбрасывает runtime isEnabled; персист-намерение
   * не трогает — при следующем звонке попытка повторится.
   */
  private async activateChain(chain: AudioChain): Promise<void> {
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();
    try {
      if (!chain.stage || chain.stage.modelId !== this.state.modelId) {
        this.destroyStage(chain);
        chain.stage = await this.buildStage(chain);
      }
      chain.source.disconnect();
      chain.source.connect(chain.stage.node);
      chain.stage.node.connect(chain.destination);
      chain.active = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'noise suppression init failed';
      console.error('[NC] pipeline init failed:', message, err);
      console.error('[NC] ASSETS_BASE resolved to:', new URL(ASSETS_BASE, document.baseURI).href);
      this.wireBypass(chain);
      this.state.error = message;
      this.state.isEnabled = false;
    } finally {
      this.state.isLoading = false;
      this.refreshActive();
      this.notify();
    }
  }

  private wireBypass(chain: AudioChain): void {
    chain.source.disconnect();
    if (chain.stage) {
      chain.stage.node.disconnect();
    }
    chain.source.connect(chain.destination);
    chain.active = false;
  }

  private destroyStage(chain: AudioChain): void {
    if (!chain.stage) return;
    chain.stage.node.disconnect();
    chain.stage.worker.terminate();
    chain.stage = null;
    chain.active = false;
  }

  private refreshActive(): void {
    let active = false;
    for (const chain of this.chains.values()) {
      if (chain.active) {
        active = true;
        break;
      }
    }
    this.state.isActive = active;
  }

  /** Загружает WASM, поднимает worker и worklet-ноду для текущей модели. */
  private async buildStage(chain: AudioChain): Promise<WorkletStage> {
    const model = NC_MODELS[this.state.modelId];

    // Контракт INIT воркера требует оба бинарника независимо от выбранной модели.
    const [rnnoiseWasm, deepfilterWasm] = await Promise.all([
      fetch(`${ASSETS_BASE}rnnoise.wasm`).then((r) => {
        if (!r.ok) throw new Error(`rnnoise.wasm fetch failed: ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(`${ASSETS_BASE}deepfilter.wasm`).then((r) => {
        if (!r.ok) throw new Error(`deepfilter.wasm fetch failed: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);

    if (!chain.workletLoaded) {
      await chain.context.audioWorklet.addModule(`${ASSETS_BASE}AudioPipelineWorklet.js`);
      chain.workletLoaded = true;
    }

    const worker = new Worker(`${ASSETS_BASE}AudioPipelineWorker.js`);
    const channel = new MessageChannel();
    worker.postMessage({ type: 'CONNECT_PORT', port: channel.port1 }, [channel.port1]);

    try {
      const frameLength = await new Promise<number>((resolve, reject) => {
        channel.port2.onmessage = (e: MessageEvent) => {
          const msg = e.data as { type: string; frameLength?: number; error?: string };
          if (msg.type === 'INIT_OK') resolve(msg.frameLength ?? 480);
          else if (msg.type === 'ERROR') reject(new Error(msg.error ?? 'Worker init error'));
        };
        channel.port2.postMessage(
          {
            type: 'INIT',
            wasmBinaries: { rnnoiseWasm, deepfilterWasm },
            moduleId: model.workerModuleId,
            moduleConfigs: { [model.workerModuleId]: model.moduleConfig },
            debugLogs: false,
          },
          [rnnoiseWasm, deepfilterWasm],
        );
      });

      const node = new AudioWorkletNode(chain.context, WORKLET_NAME);
      await new Promise<void>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          const msg = e.data as { type: string; requestId?: string; error?: string };
          if (msg.type === 'COMMAND_OK' && msg.requestId === 'init-pipeline') {
            node.port.removeEventListener('message', handler);
            resolve();
          } else if (msg.type === 'COMMAND_ERROR' && msg.requestId === 'init-pipeline') {
            node.port.removeEventListener('message', handler);
            reject(new Error(msg.error ?? 'Worklet init error'));
          }
        };
        node.port.addEventListener('message', handler);
        node.port.start();
        node.port.postMessage(
          {
            type: 'INIT_PIPELINE',
            requestId: 'init-pipeline',
            enable: true,
            debugLogs: false,
            workerPort: channel.port2,
            frameLength,
            batchFrames: 1,
            stages: { denoise: model.workerModuleId },
            moduleConfigs: { [model.workerModuleId]: model.moduleConfig },
          },
          [channel.port2],
        );
      });

      return { node, worker, modelId: this.state.modelId };
    } catch (err) {
      worker.terminate();
      throw err;
    }
  }
}

export const noiseCancellationService = new NoiseCancellationService();
export { NoiseCancellationService };
export type { NoiseCancellationState };
```

- [ ] **Step 2: Прогнать e2e-сценарий сервиса**

Run: `cd /www/my/vycord/client && E2E_ONLY=nc-toggle npm run test:e2e`
Expected: `PASS: nc-toggle`, в JSON — `"pass":true` и значения `rmsOn1`, `rmsOff`, `rmsOn2` с `rmsOn1 < rmsOff*0.5` и `rmsOn2 < rmsOff*0.5`.

Примечание: `npx tsc --noEmit` на этом шаге УПАДЁТ (call.ts/groupCall.ts/Settings.tsx ещё зовут удалённое API) — это ожидаемо, vite транслирует помодульно и e2e-страница импортирует только сервис. Потребители чинятся в Tasks 4–6.

- [ ] **Step 3: Сообщить пользователю, что задача готова к коммиту** (можно коммитить вместе с Task 4–6, на усмотрение пользователя).

---

### Task 4: Перевести `call.ts` на createChain/releaseChain

**Files:**
- Modify: `client/src/services/call.ts` (строки ~51, ~119, ~296)

**Interfaces:**
- Consumes: `noiseCancellationService.createChain(raw)`, `noiseCancellationService.releaseChain(streamId)` из Task 3.

- [ ] **Step 1: Заменить applyToStream в startCall**

В `startCall` (строка ~51) заменить:

```ts
        this.localStream = await noiseCancellationService.applyToStream(rawStream);
```

на:

```ts
        this.localStream = await noiseCancellationService.createChain(rawStream);
```

- [ ] **Step 2: Заменить applyToStream в acceptCall**

В `acceptCall` (строка ~119) — та же замена:

```ts
        this.localStream = await noiseCancellationService.createChain(rawStream);
```

- [ ] **Step 3: Демонтаж цепочки в cleanup**

В `private cleanup()` (строки ~296–300) заменить:

```ts
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
```

на:

```ts
    if (this.localStream) {
      // Демонтаж NC-цепочки стопает и raw-треки микрофона; для стримов без
      // цепочки (video-only fallback) releaseChain — no-op.
      noiseCancellationService.releaseChain(this.localStream.id);
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
```

- [ ] **Step 4: Проверить, что в call.ts не осталось старого API**

Run: `grep -n "applyToStream\|enableNoiseCancellation\|disableNoiseCancellation" /www/my/vycord/client/src/services/call.ts`
Expected: пусто.

- [ ] **Step 5: Сообщить пользователю, что задача готова к коммиту.**

---

### Task 5: Перевести `groupCall.ts` на createChain/releaseChain, удалить routeAudioThroughWebAudio

**Files:**
- Modify: `client/src/services/groupCall.ts` (строки ~126–127, ~205–236, ~600–640, ~1148, teardown ~1377–1410)

**Interfaces:**
- Consumes: `noiseCancellationService.createChain(raw)`, `releaseChain(streamId)`, `getChainContextState(streamId)`, `getState()` из Task 3.

- [ ] **Step 1: Заменить медиаблок в doJoinGroupCall**

Заменить блок (строки ~207–221):

```ts
      const raw = await this.acquireMedia();
      if (raw !== null) {
        const hasAudio = raw.getAudioTracks().length > 0;
        this._microphoneAvailable = hasAudio;
        if (hasAudio) {
          // When NC is disabled, Chrome's push-model audio capture may fail silently
          // on certain hardware (track reports live/enabled but Opus gets zero frames).
          // Routing through Web Audio forces a pull-model render cycle that always
          // produces frames, ensuring RTP actually reaches the SFU.
          this.localStream = await noiseCancellationService.applyToStream(raw);
          if (!noiseCancellationService.getState().isEnabled) {
            this.localStream = await this.routeAudioThroughWebAudio(this.localStream);
          }
        } else {
          this.localStream = raw;
        }
```

на:

```ts
      const raw = await this.acquireMedia();
      if (raw !== null) {
        this._microphoneAvailable = raw.getAudioTracks().length > 0;
        // Единая Web Audio цепочка NC-сервиса: worklet при включённом NC, bypass
        // при выключенном. Пропуск через Web Audio обязателен в обоих режимах —
        // Chrome's push-model audio capture may fail silently on certain hardware
        // (track reports live/enabled but Opus gets zero frames); pull-model
        // рендер всегда производит фреймы. Без аудиотреков createChain вернёт
        // raw как есть.
        this.localStream = await noiseCancellationService.createChain(raw);
```

(последующие строки `this.localStream.getVideoTracks().forEach(...)` и `gcLog(...)` остаются без изменений).

- [ ] **Step 2: Удалить поля audioCtx/audioCtxKeepAlive**

Удалить объявления полей (строки ~126–127):

```ts
  private audioCtx: AudioContext | null = null;
  private audioCtxKeepAlive: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 3: Удалить метод routeAudioThroughWebAudio целиком**

Удалить метод `private async routeAudioThroughWebAudio(...)` (строки ~600–640, от JSDoc-комментария секции не трогая заголовок `// ── Private: media acquisition ──`).

- [ ] **Step 4: Обновить диагностический лог**

В варнинге «0 audio packets sent» (строка ~1148) заменить:

```ts
                  audioCtxState: this.audioCtx?.state ?? 'no-ctx',
```

на:

```ts
                  audioCtxState: this.localStream
                    ? noiseCancellationService.getChainContextState(this.localStream.id)
                    : 'no-ctx',
```

- [ ] **Step 5: Обновить teardown**

В `private teardown()` заменить:

```ts
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;

    if (this.audioCtxKeepAlive !== null) {
      clearInterval(this.audioCtxKeepAlive);
      this.audioCtxKeepAlive = null;
    }
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
```

на:

```ts
    if (this.localStream) {
      // Демонтаж NC-цепочки: стопает raw-треки микрофона, закрывает AudioContext
      // и снимает keepAlive-поллинг (всё это теперь живёт внутри сервиса).
      noiseCancellationService.releaseChain(this.localStream.id);
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;
```

`partialTeardown()` не трогать: реконнект переиспользует localStream, цепочка должна пережить пересоздание PC/WS.

- [ ] **Step 6: Проверить, что старое API и поля не остались**

Run: `grep -n "applyToStream\|routeAudioThroughWebAudio\|audioCtx" /www/my/vycord/client/src/services/groupCall.ts`
Expected: только строка с `audioCtxState:` из Step 4 (имя ключа лога сохранено сознательно).

- [ ] **Step 7: Прогнать существующий e2e групповых звонков**

Run: `cd /www/my/vycord/client && E2E_ONLY=no-camera-screenshare npm run test:e2e`
Expected: `PASS: no-camera-screenshare` — единая цепочка не сломала путь аудио до SFU.

- [ ] **Step 8: Сообщить пользователю, что задача готова к коммиту.**

---

### Task 6: `Settings.tsx` — тумблер через setEnabled; проверка ChannelSidebar

**Files:**
- Modify: `client/src/components/Settings.tsx` (строки ~14–53)
- Verify (без изменений): `client/src/components/ChannelSidebar.tsx`

**Interfaces:**
- Consumes: `noiseCancellationService.setEnabled(enabled)`, `onStateChange`, `NoiseCancellationService.isSupported()` из Task 3.

- [ ] **Step 1: Убрать тестовый стрим, переключать через setEnabled**

Удалить строку состояния (строка ~20):

```ts
  const [testStreamId, setTestStreamId] = useState<string | null>(null);
```

Заменить обработчик (строки ~38–53):

```ts
  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    const next = !noiseCancellation;
    try {
      if (next) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setTestStreamId(stream.id);
        await noiseCancellationService.enableNoiseCancellation(stream);
      } else {
        noiseCancellationService.disableNoiseCancellation(testStreamId ?? '');
        setTestStreamId(null);
      }
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };
```

на:

```ts
  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    try {
      // Вне звонка меняет только персистентный флаг (микрофон не захватывается);
      // в звонке сервис перекоммутирует активную аудиоцепочку.
      await noiseCancellationService.setEnabled(!noiseCancellation);
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };
```

Подписка в `useEffect` (строки ~22–29) остаётся без изменений — `state.isEnabled`/`state.isLoading` существуют в новом состоянии.

- [ ] **Step 2: Проверить типы всего клиента**

Run: `cd /www/my/vycord/client && npx tsc --noEmit`
Expected: PASS, 0 ошибок (все потребители старого API переведены).

- [ ] **Step 3: Убедиться, что ChannelSidebar не требует изменений**

Run: `grep -n "noiseCancellation" /www/my/vycord/client/src/components/ChannelSidebar.tsx`
Expected: импорт сервиса, подписка `onStateChange` (строка ~42) и бейдж `{ncEnabled && <span className="nc-badge">🔇 NC</span>}` (строка ~148). Файл НЕ менять — бейдж рядом с именем и перед иконкой настроек сохраняется как есть.

- [ ] **Step 4: Сообщить пользователю, что задача готова к коммиту.**

---

### Task 7: Полная верификация

**Files:** нет новых изменений (только починка найденного).

- [ ] **Step 1: Полный прогон e2e (оба сценария)**

Run: `cd /www/my/vycord/client && npm run test:e2e`
Expected: `PASS: no-camera-screenshare`, `PASS: nc-toggle`, финальный `PASS`.

- [ ] **Step 2: Продакшен-сборка**

Run: `cd /www/my/vycord/client && npm run build:vite`
Expected: `tsc` и `vite build` без ошибок.

- [ ] **Step 3: Ручная проверка сценария из критериев готовности** (если доступен интерактивный запуск)

`npm run dev` → логин: бейдж `🔇 NC` горит сразу (default-on); войти в голосовой канал → в Settings выключить NC (бейдж гаснет, звук продолжает идти) → включить обратно; перезапустить приложение с выключенным NC → бейдж не горит. Если интерактивная проверка недоступна — явно сообщить пользователю, что этот пункт остался за ним.

- [ ] **Step 4: Сообщить пользователю итог и напомнить про коммит** (пользователь коммитит сам; сообщить список изменённых файлов).
