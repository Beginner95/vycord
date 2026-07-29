/**
 * Подавление эха звонка в звуке демонстрации экрана.
 *
 * referenceBus — постоянно обновляемая сумма аудиотреков текущих удалённых
 * участников звонка (то же самое, что физически звучит из динамиков
 * пользователя). attachEchoCancellation() прогоняет захваченный системный
 * звук через AEC3 (Worklet + Worker, см. public/audio/EchoCancellation*.js)
 * с этим референсом и возвращает очищенный трек.
 *
 * ensureReferenceBus()/addReferenceTrack()/removeReferenceTrack() живут
 * ровно столько же, сколько активен шаринг со звуком — вызывающий код
 * (groupCall.ts) отвечает за то, чтобы вызвать teardownReferenceBus() при
 * остановке шаринга.
 */

const ASSETS_BASE: string = window.electronAPI?.audioAssetsUrl ?? '/audio/';
const SAMPLE_RATE = 48000;

export interface EchoCancellationHandle {
  track: MediaStreamTrack;
  detach: () => void;
}

interface RefSource {
  node: MediaStreamAudioSourceNode;
  track: MediaStreamTrack;
}

class EchoCancellationService {
  private refContext: AudioContext | null = null;
  private refDestination: MediaStreamAudioDestinationNode | null = null;
  private refSources = new Map<string, RefSource>();
  private refKeepAlive: ReturnType<typeof setInterval> | null = null;

  ensureReferenceBus(): void {
    if (this.refContext && this.refContext.state !== 'closed') return;
    // A previous context could in principle reach 'closed' by some path
    // other than teardownReferenceBus() (which already nulls this field) —
    // guard against leaking a keep-alive interval that would otherwise poll
    // a dead context's resume() forever.
    if (this.refKeepAlive !== null) {
      clearInterval(this.refKeepAlive);
      this.refKeepAlive = null;
    }
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    // Chrome creates a suspended context outside a user-gesture window; a
    // suspended context never renders, so nothing downstream (including the
    // AEC worklet later) would receive frames. Same reasoning and keep-alive
    // pattern as noiseCancellation.ts's doCreateChain.
    if (context.state !== 'running') {
      context.resume().catch(() => {});
    }
    this.refKeepAlive = setInterval(() => {
      if (context.state !== 'running') {
        context.resume().catch(() => {});
      }
    }, 2000);
    this.refContext = context;
    this.refDestination = context.createMediaStreamDestination();
    this.refSources.clear();
  }

  addReferenceTrack(streamId: string, track: MediaStreamTrack): void {
    if (!this.refContext || !this.refDestination) return;
    if (track.kind !== 'audio') return;
    const existing = this.refSources.get(streamId);
    if (existing) {
      // Same track already wired — nothing to do.
      if (existing.track === track) return;
      // A reconnect (new RTCPeerConnection, same remote streamId) replaces
      // the track object entirely; the old source node points at a dead
      // track and would otherwise leave this participant silently missing
      // from the reference bus for the rest of the share.
      existing.node.disconnect();
    }
    const node = this.refContext.createMediaStreamSource(new MediaStream([track]));
    node.connect(this.refDestination);
    this.refSources.set(streamId, { node, track });
  }

  removeReferenceTrack(streamId: string): void {
    const existing = this.refSources.get(streamId);
    if (!existing) return;
    existing.node.disconnect();
    this.refSources.delete(streamId);
  }

  teardownReferenceBus(): void {
    this.refSources.forEach(({ node }) => node.disconnect());
    this.refSources.clear();
    if (this.refKeepAlive !== null) {
      clearInterval(this.refKeepAlive);
      this.refKeepAlive = null;
    }
    this.refContext?.close().catch(() => {});
    this.refContext = null;
    this.refDestination = null;
  }

  /**
   * Прогоняет capturedTrack (захваченный системный звук) через AEC3 с
   * текущим referenceBus. Возвращает null (нефатально) при любой ошибке
   * инициализации — вызывающий код должен продолжить с сырым треком.
   */
  async attachEchoCancellation(capturedTrack: MediaStreamTrack): Promise<EchoCancellationHandle | null> {
    if (!this.refContext || !this.refDestination) return null;
    const context = this.refContext;

    let worker: Worker | null = null;
    try {
      await context.audioWorklet.addModule(`${ASSETS_BASE}EchoCancellationWorklet.js`);

      worker = new Worker(`${ASSETS_BASE}EchoCancellationWorker.js`);
      const channel = new MessageChannel();
      worker.postMessage({ type: 'CONNECT_PORT', port: channel.port1 }, [channel.port1]);

      await new Promise<void>((resolve, reject) => {
        channel.port2.onmessage = (e: MessageEvent) => {
          const msg = e.data as { type: string; error?: string };
          if (msg.type === 'INIT_OK') resolve();
          else if (msg.type === 'ERROR') reject(new Error(msg.error ?? 'AEC3 worker init failed'));
        };
        channel.port2.postMessage({
          type: 'INIT',
          sampleRate: context.sampleRate,
          renderChannels: 1,
          captureChannels: 1,
        });
      });

      const node = new AudioWorkletNode(context, 'echo-cancellation-processor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        outputChannelCount: [1],
      });
      node.port.postMessage({ type: 'INIT_PORT', dataPort: channel.port2 }, [channel.port2]);

      const refInputSource = context.createMediaStreamSource(this.refDestination.stream);
      const capSource = context.createMediaStreamSource(new MediaStream([capturedTrack]));
      refInputSource.connect(node, 0, 0);
      capSource.connect(node, 0, 1);

      const outputDestination = context.createMediaStreamDestination();
      node.connect(outputDestination);
      const cleanedTrack = outputDestination.stream.getAudioTracks()[0];

      const detach = () => {
        refInputSource.disconnect();
        capSource.disconnect();
        // FREE must go through the worklet, which relays it over dataPort —
        // the worker's own top-level self.onmessage only understands
        // CONNECT_PORT; the data-plane port (where FREE is actually
        // handled) was transferred away to the worklet at INIT_PORT and is
        // no longer reachable directly from here.
        node.port.postMessage({ type: 'FREE' });
        node.disconnect();
        worker!.terminate();
      };

      return { track: cleanedTrack, detach };
    } catch (err) {
      worker?.terminate();
      console.error('[EchoCancellation] init failed, falling back to raw system audio:', err);
      return null;
    }
  }
}

export const echoCancellationService = new EchoCancellationService();
export { EchoCancellationService };
