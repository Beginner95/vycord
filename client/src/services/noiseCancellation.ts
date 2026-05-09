/**
 * DeepFilterNet3 noise cancellation via AudioWorklet + Web Worker.
 *
 * Assets loaded from /audio/ (public dir):
 *   AudioPipelineWorklet.js  — real-time audio I/O worklet
 *   AudioPipelineWorker.js   — WASM compute worker
 *   deepfilter.wasm          — DeepFilterNet3 model (17 MB, weights embedded)
 *   rnnoise.wasm             — RNNoise fallback model
 */

const ASSETS_BASE = '/audio/';
const WORKLET_NAME = 'AudioPipelineWorklet';

interface NoiseCancellationState {
  isEnabled: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

type StateListener = (state: NoiseCancellationState) => void;

interface ActiveProcessor {
  context: AudioContext;
  worker: Worker;
  workletNode: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
}

class NoiseCancellationService {
  private state: NoiseCancellationState = {
    isEnabled: false,
    isInitialized: false,
    isLoading: false,
    error: null,
  };

  private listeners = new Set<StateListener>();
  private processors = new Map<string, ActiveProcessor>();
  // AudioContext instances whose worklet module is already loaded — avoid double addModule
  private loadedContexts = new WeakSet<AudioContext>();

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

  /**
   * Enable noise cancellation.
   * Returns the processed MediaStream (audio through DeepFilterNet, video unchanged).
   */
  async enableNoiseCancellation(stream: MediaStream): Promise<MediaStream | null> {
    this.state.isEnabled = true;
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    const result = await this.buildProcessor(stream);

    this.state.isLoading = false;
    if (result) {
      this.state.isInitialized = true;
    }
    this.notify();
    return result;
  }

  /**
   * Apply noise cancellation to a MediaStream if globally enabled.
   * Called by call services — returns processed stream or original if disabled.
   */
  async applyToStream(stream: MediaStream): Promise<MediaStream> {
    if (!this.state.isEnabled) return stream;
    const processed = await this.buildProcessor(stream);
    return processed ?? stream;
  }

  disableNoiseCancellation(streamId: string): void {
    this.releaseProcessor(streamId);
    this.state.isEnabled = false;
    this.state.isInitialized = false;
    this.notify();
  }

  private releaseProcessor(streamId: string): void {
    const p = this.processors.get(streamId);
    if (!p) return;
    p.workletNode.disconnect();
    p.source.disconnect();
    p.worker.terminate();
    p.context.close().catch(() => {});
    this.processors.delete(streamId);
  }

  private async buildProcessor(stream: MediaStream): Promise<MediaStream | null> {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return null;

    try {
      // Fetch WASM binaries on the main thread before transferring to worker
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

      const audioContext = new AudioContext({ sampleRate: 48000 });

      // Load worklet module once per AudioContext
      if (!this.loadedContexts.has(audioContext)) {
        await audioContext.audioWorklet.addModule(`${ASSETS_BASE}AudioPipelineWorklet.js`);
        this.loadedContexts.add(audioContext);
      }

      // Start Web Worker
      const worker = new Worker(`${ASSETS_BASE}AudioPipelineWorker.js`);

      // Create MessageChannel for worklet ↔ worker communication
      const channel = new MessageChannel();

      // Give port1 to the worker
      worker.postMessage({ type: 'CONNECT_PORT', port: channel.port1 }, [channel.port1]);

      // Initialize worker with WASM binaries; wait for INIT_OK
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
            moduleId: 'deepfilternet',
            moduleConfigs: {
              deepfilternet: { attenLimDb: 100, postFilterBeta: 0.02 },
            },
            debugLogs: false,
          },
          [rnnoiseWasm, deepfilterWasm],
        );
      });

      // Create AudioWorkletNode
      const workletNode = new AudioWorkletNode(audioContext, WORKLET_NAME);

      // Initialize worklet pipeline; wait for COMMAND_OK
      await new Promise<void>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          const msg = e.data as { type: string; requestId?: string; error?: string };
          if (msg.type === 'COMMAND_OK' && msg.requestId === 'init-pipeline') {
            workletNode.port.removeEventListener('message', handler);
            resolve();
          } else if (msg.type === 'COMMAND_ERROR' && msg.requestId === 'init-pipeline') {
            workletNode.port.removeEventListener('message', handler);
            reject(new Error(msg.error ?? 'Worklet init error'));
          }
        };
        workletNode.port.addEventListener('message', handler);
        workletNode.port.start();
        workletNode.port.postMessage(
          {
            type: 'INIT_PIPELINE',
            requestId: 'init-pipeline',
            enable: true,
            debugLogs: false,
            workerPort: channel.port2,
            frameLength,
            batchFrames: 1,
            stages: { denoise: 'deepfilternet' },
            moduleConfigs: {
              deepfilternet: { attenLimDb: 100, postFilterBeta: 0.02 },
            },
          },
          [channel.port2],
        );
      });

      // Wire: source → worklet → destination
      const source = audioContext.createMediaStreamSource(stream);
      const destination = audioContext.createMediaStreamDestination();
      source.connect(workletNode);
      workletNode.connect(destination);

      this.processors.set(stream.id, { context: audioContext, worker, workletNode, source, destination });

      // Build output stream: processed audio + original video tracks
      const processedStream = new MediaStream();
      destination.stream.getAudioTracks().forEach((t) => processedStream.addTrack(t));
      stream.getVideoTracks().forEach((t) => processedStream.addTrack(t));

      return processedStream;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : 'DeepFilterNet init failed';
      this.state.isEnabled = false;
      this.notify();
      return null;
    }
  }

  async cleanup(): Promise<void> {
    for (const [id] of this.processors) {
      this.releaseProcessor(id);
    }
    this.state = { isEnabled: false, isInitialized: false, isLoading: false, error: null };
    this.notify();
  }
}

export const noiseCancellationService = new NoiseCancellationService();
export { NoiseCancellationService };
