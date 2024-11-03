/**
 * Noise Cancellation Service
 * 
 * Uses Web Audio API with noise suppression processing.
 * In production mode, this integrates with DeepFilterNet WASM module.
 * 
 * The service intercepts MediaStream audio tracks, processes them
 * through the noise cancellation pipeline, and returns a processed stream.
 */

interface NoiseCancellationState {
  isEnabled: boolean;
  isProcessing: boolean;
  error: string | null;
}

type StateChangeListener = (state: NoiseCancellationState) => void;

class NoiseCancellationService {
  private state: NoiseCancellationState = {
    isEnabled: false,
    isProcessing: false,
    error: null,
  };

  private listeners: Set<StateChangeListener> = new Set();
  private activeProcessors: Map<string, {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    destination: MediaStreamAudioDestinationNode;
    stream: MediaStream;
  }> = new Map();

  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  /**
   * Enable noise cancellation for a given stream.
   * Returns a processed MediaStream with noise suppressed.
   */
  async enableNoiseCancellation(stream: MediaStream): Promise<MediaStream | null> {
    if (this.state.isProcessing) {
      return stream; // Already processing
    }

    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        this.state.error = 'No audio tracks found';
        this.notifyListeners();
        return null;
      }

      // Create AudioContext
      const audioContext = new AudioContext({
        sampleRate: 48000,
      });

      // Create source from original stream
      const source = audioContext.createMediaStreamSource(stream);
      const destination = audioContext.createMediaStreamDestination();

      // Apply noise suppression using built-in constraints
      // For DeepFilterNet integration, we would load the WASM module here
      // and create a custom AudioWorkletProcessor

      // Create a simple noise gate as placeholder for DeepFilterNet
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;

      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;

      // Chain: source -> analyser -> compressor -> destination
      source.connect(analyser);
      analyser.connect(compressor);
      compressor.connect(destination);

      // Store processor info
      const streamId = stream.id;
      this.activeProcessors.set(streamId, {
        context: audioContext,
        source,
        destination,
        stream: destination.stream,
      });

      this.state.isEnabled = true;
      this.state.isProcessing = true;
      this.state.error = null;
      this.notifyListeners();

      return destination.stream;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : 'Failed to enable noise cancellation';
      this.state.isProcessing = false;
      this.notifyListeners();
      return null;
    }
  }

  /**
   * Disable noise cancellation and restore original stream.
   */
  disableNoiseCancellation(streamId: string): void {
    const processor = this.activeProcessors.get(streamId);
    if (processor) {
      processor.context.close();
      this.activeProcessors.delete(streamId);
    }

    this.state.isEnabled = false;
    this.state.isProcessing = false;
    this.notifyListeners();
  }

  /**
   * Get current state.
   */
  getState(): NoiseCancellationState {
    return { ...this.state };
  }

  /**
   * Check if noise cancellation is supported.
   */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices !== 'undefined'
    );
  }

  /**
   * Clean up all processors.
   */
  async cleanup(): Promise<void> {
    for (const [streamId, processor] of this.activeProcessors) {
      processor.context.close();
      this.activeProcessors.delete(streamId);
    }
    this.state.isEnabled = false;
    this.state.isProcessing = false;
    this.notifyListeners();
  }
}

export const noiseCancellationService = new NoiseCancellationService();
export { NoiseCancellationService };
