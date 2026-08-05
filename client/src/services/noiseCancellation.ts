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
  /** Постоянный узел между веткой микрофона (worklet/bypass) и destination.
   *  Мьют микрофона (setMicMuted) управляет только этим gain; звук шаринга
   *  экрана теперь идёт отдельным треком через SFU и не проходит через
   *  эту Web Audio цепочку. */
  micGain: GainNode;
  /** Исходный getUserMedia-стрим: его аудиотреки стопаются в releaseChain,
   *  иначе микрофон остаётся захваченным после звонка. */
  rawStream: MediaStream;
  keepAlive: ReturnType<typeof setInterval>;
  /** addModule уже выполнен для этого AudioContext. */
  workletLoaded: boolean;
  stage: WorkletStage | null;
  /** true: source → worklet → micGain → destination; false: source → micGain → destination (bypass). */
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
    const micGain = context.createGain();
    micGain.connect(destination);

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
      micGain,
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
   * Мьютит/анмьютит ветку микрофона. Возвращает false, если цепочки для
   * streamId нет (например, Web Audio не поддерживается) — тогда вызывающий
   * код должен сам замьютить трек через track.enabled.
   */
  setMicMuted(streamId: string, muted: boolean): boolean {
    const chain = this.chains.get(streamId);
    if (!chain) return false;
    chain.micGain.gain.value = muted ? 0 : 1;
    return true;
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
    if (this.chains.size === 0) {
      // Runtime-сброс isEnabled после ошибки инициализации не должен пережить
      // конец звонка: намерение персистится, при следующем звонке попытка
      // повторяется (спека, секция 3).
      this.state.isEnabled = this.intendedEnabled;
      this.state.error = null;
    }
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
      chain.stage.node.connect(chain.micGain);
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
    chain.source.connect(chain.micGain);
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
