import { wsService } from './websocket';
import { noiseCancellationService } from './noiseCancellation';
import { getIceServers } from './iceConfig';
import { logger } from '@/utils/logger';
// Сервис — не компонент, подписаться на стор нечем: берём нереактивный t.
// Строка читается один раз в момент ошибки и сразу уходит в тост, поэтому
// смена языка после её показа значения не имеет.
import { t } from '@/i18n';
import { getDeniedMediaKinds } from './mediaPermissions';
import { acquireUserMedia, captureCameraTrack } from '@/services/mediaDevices';

interface WebRTCCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onCallEnded: () => void;
  onError: (error: string) => void;
  /** Включить камеру не вышло (запрещена, занята, отключена) — она снова «выкл». */
  onCameraFailed?: () => void;
}

/** Камера в начале звонка выключена: захват доказал, что она есть (трек
 *  остаётся в localStream), но устройство освобождается сразу — индикатор
 *  «камера используется» лишь мигает. Включение захватит её заново. */
function releaseInitialCamera(raw: MediaStream): void {
  raw.getVideoTracks().forEach((t) => {
    t.enabled = false;
    t.stop();
  });
}

/** Чёрный кадр для видео-отправителя, пока камера освобождена: собеседник
 *  видит чёрное, а не застывший последний кадр. */
function createBlackVideoTrack(): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  canvas.getContext('2d')?.fillRect(0, 0, 16, 16);
  return canvas.captureStream().getVideoTracks()[0];
}

class CallService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  /** Исходный камерный трек — целевой для setCameraOutput(null). */
  private cameraTrack: MediaStreamTrack | null = null;
  // Выключенный трек лишь чернит кадры: камера остаётся захваченной, и браузер
  // показывает «камера используется». Поэтому «выкл» освобождает устройство
  // (на отправителе — чёрная заглушка), «вкл» — захватывает заново.
  // Переключения и setCameraOutput идут по одной очереди (cameraChain).
  private cameraPlaceholder: MediaStreamTrack | null = null;
  private cameraChain: Promise<void> = Promise.resolve();
  private cameraSyncQueued = false;
  /** Эффект фона включён: заново захваченная камера ждёт его канвас за заглушкой. */
  private cameraEffectWanted = false;
  private cameraInputStream: MediaStream | null = null;
  private readonly cameraInputListeners = new Set<() => void>();
  /** Растёт в cleanup: захват камеры, переживший звонок, себя выбрасывает. */
  private callEpoch = 0;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private remoteUserId: string | null = null;
  private isInCall = false;
  private _microphoneAvailable = false;
  private callbacks: WebRTCCallbacks | null = null;
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private callAccepted = false;

  init(callbacks: WebRTCCallbacks): void {
    this.callbacks = callbacks;

    // Listen for WebRTC messages
    wsService.on('incoming_call', this.handleIncomingCall);
    wsService.on('call_started', this.handleCallStarted);
    wsService.on('call_accepted', this.handleCallAccepted);
    wsService.on('call_rejected', this.handleCallRejected);
    wsService.on('call_ended', this.handleCallEnded);
    wsService.on('webrtc_offer', this.handleWebRTCOffer);
    wsService.on('webrtc_answer', this.handleWebRTCAnswer);
    wsService.on('webrtc_ice_candidate', this.handleWebRTCICECandidate);
    wsService.on('error', this.handleError);
  }

  async startCall(receiverId: string): Promise<string | null> {
    try {
      this.remoteUserId = receiverId;
      this._microphoneAvailable = false;

      const api = (window as Window & typeof globalThis).electronAPI;
      const { cameraDenied, microphoneDenied } = await getDeniedMediaKinds(api);
      if (cameraDenied || microphoneDenied) {
        this.callbacks?.onError(t('call.mediaPermissionDenied'));
      }

      // Get local media stream; acquireUserMedia сам деградирует: выбранные
      // устройства → системные дефолты → audio-only → video-only → без медиа.
      try {
        const rawStream = await acquireUserMedia();
        if (rawStream) {
          releaseInitialCamera(rawStream);
          this.localStream = await noiseCancellationService.createChain(rawStream);
          this.cameraTrack = this.localStream.getVideoTracks()[0] ?? null;
          this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
        } else {
          this.localStream = null;
        }
      } catch {
        this.localStream = null;
      }

      // Create peer connection
      await this.createPeerConnection();

      // Add local stream tracks (if any)
      this.addLocalTracks();

      // Create offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      // Signal call start
      wsService.send('call_start', { receiver_id: receiverId });

      return new Promise((resolve) => {
        const checkCallId = setInterval(() => {
          if (this.currentCallId) {
            clearInterval(checkCallId);

            // Send offer
            wsService.send('webrtc_offer', {
              target_user_id: receiverId,
              sdp: this.peerConnection!.localDescription,
            });

            resolve(this.currentCallId);
          }
        }, 100);

        // Timeout after 30s
        setTimeout(() => {
          clearInterval(checkCallId);
          resolve(null);
        }, 30000);
      });
    } catch (err) {
      // err.message приходит из браузера (getUserMedia и т.п.) и остаётся
      // на языке браузера — переводится только наш собственный фолбэк.
      const message = err instanceof Error ? err.message : t('call.startFailed');
      this.callbacks?.onError(message);
      return null;
    }
  }

  async acceptCall(): Promise<void> {
    if (!this.localStream) {
      this._microphoneAvailable = false;

      const api = (window as Window & typeof globalThis).electronAPI;
      const { cameraDenied, microphoneDenied } = await getDeniedMediaKinds(api);
      if (cameraDenied || microphoneDenied) {
        this.callbacks?.onError(t('call.mediaPermissionDenied'));
      }

      const rawStream = await acquireUserMedia();
      if (rawStream) {
        releaseInitialCamera(rawStream);
        try {
          this.localStream = await noiseCancellationService.createChain(rawStream);
          this.cameraTrack = this.localStream.getVideoTracks()[0] ?? null;
          this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
        } catch {
          this.localStream = null;
        }
      } else {
        this.localStream = null;
      }
    }

    await this.createPeerConnection();

    this.addLocalTracks();

    this.callAccepted = true;

    if (this.currentCallId) {
      wsService.send('call_accept', { call_id: this.currentCallId });
    }

    // If offer arrived before peer connection was ready it's stored in pendingOffer.
    // If offer arrives after this point, handleWebRTCOffer will send the answer directly.
    if (this.pendingOffer) {
      await this.sendAnswer(this.pendingOffer);
      this.pendingOffer = null;
    }
  }

  private async sendAnswer(offerSdp: RTCSessionDescriptionInit): Promise<void> {
    await this.peerConnection!.setRemoteDescription(offerSdp);
    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    wsService.send('webrtc_answer', {
      target_user_id: this.remoteUserId ?? '',
      sdp: this.peerConnection!.localDescription,
    });
  }

  rejectCall(): void {
    if (this.currentCallId) {
      wsService.send('call_reject', { call_id: this.currentCallId });
    }
    this.cleanup();
  }

  endCall(): void {
    if (this.currentCallId) {
      wsService.send('call_end', { call_id: this.currentCallId });
    }
    this.cleanup();
  }

  toggleMuteAudio(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // returns true if muted
    }
    return false;
  }

  toggleMuteVideo(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.syncCamera();
      return !videoTrack.enabled; // returns true if muted
    }
    return false;
  }

  /**
   * Подменяет видео-трек, уходящий собеседнику (VYC-100): replaceTrack на
   * видео-сендере + removeTrack/addTrack в localStream, чтобы превью и
   * остальная логика (мьют, статистика) всегда видели актуальный трек.
   * null — вернуть исходный камерный трек. Аудио не трогается никогда.
   */
  setCameraOutput(track: MediaStreamTrack | null): Promise<void> {
    return this.enqueueCameraOp(() => this.applyCameraOutput(track));
  }

  private async applyCameraOutput(track: MediaStreamTrack | null): Promise<void> {
    const target = track ?? this.cameraTrack;
    if (!this.localStream || !target) return;
    const current = this.localStream.getVideoTracks()[0];
    if (current === target) return;

    const sender = this.videoSender();
    // На отправителе заглушка: откат на камеру её не снимает (камера
    // освобождена или ждёт канвас эффекта — снимет включение / syncCamera), и
    // запоздавший канвас при освобождённой камере тоже (иначе следующий откат
    // поставил бы на отправитель остановленную камеру).
    const cameraLive = this.cameraTrack?.readyState === 'live';
    const keepPlaceholder = sender !== null && this.cameraPlaceholder !== null
      && sender.track === this.cameraPlaceholder && (track === null || !cameraLive);
    try {
      if (sender && !keepPlaceholder) await sender.replaceTrack(target);
    } catch {
      return; // подмена не удалась — оставляем как было
    }
    if (sender && !keepPlaceholder && sender.track === target) this.dropCameraPlaceholder();
    if (!this.localStream) return;
    const now = this.localStream.getVideoTracks()[0];
    if (now) this.localStream.removeTrack(now);
    target.enabled = now ? now.enabled : true;
    this.localStream.addTrack(target);
  }

  /** Живая сырая камера — вход движка эффекта фона; null, пока освобождена. */
  get cameraInputState(): MediaStream | null {
    const cam = this.cameraTrack;
    if (!cam || cam.readyState !== 'live') {
      this.cameraInputStream = null;
      return null;
    }
    if (this.cameraInputStream?.getVideoTracks()[0] !== cam) {
      this.cameraInputStream = new MediaStream([cam]);
    }
    return this.cameraInputStream;
  }

  /** Подписка useSyncExternalStore на cameraInputState. */
  readonly subscribeCameraInput = (listener: () => void): (() => void) => {
    this.cameraInputListeners.add(listener);
    return () => {
      this.cameraInputListeners.delete(listener);
    };
  };

  /** Эффект фона вкл/выкл (CallUI). Пока вкл, заново захваченная камера ждёт
   *  его канвас за заглушкой — сырой кадр собеседнику не уходит. */
  setCameraEffectWanted(wanted: boolean): void {
    if (this.cameraEffectWanted === wanted) return;
    this.cameraEffectWanted = wanted;
    if (!wanted) this.syncCamera();
  }

  private notifyCameraInput(): void {
    this.cameraInputListeners.forEach((listener) => listener());
  }

  private videoSender(): RTCRtpSender | null {
    return this.peerConnection?.getSenders().find((s) => s.track?.kind === 'video') ?? null;
  }

  private dropCameraPlaceholder(): void {
    this.cameraPlaceholder?.stop();
    this.cameraPlaceholder = null;
  }

  private enqueueCameraOp(op: () => Promise<void>): Promise<void> {
    const run = this.cameraChain.then(op);
    this.cameraChain = run.catch(() => {});
    return run;
  }

  /** Приводит устройство к состоянию кнопки. В очереди не больше одного
   *  прохода: он читает состояние на момент запуска, быстрые переключения
   *  схлопываются в один проход по последнему. */
  private syncCamera(): void {
    if (this.cameraSyncQueued) return;
    this.cameraSyncQueued = true;
    void this.enqueueCameraOp(async () => {
      this.cameraSyncQueued = false;
      await this.syncCameraOnce();
    });
  }

  private async syncCameraOnce(): Promise<void> {
    const stream = this.localStream;
    const out = stream?.getVideoTracks()[0];
    if (!stream || !out) return;
    const cam = this.cameraTrack ?? out;
    const epoch = this.callEpoch;
    const sender = this.videoSender();

    if (!out.enabled) {
      if (cam.readyState !== 'live') return;
      // «Выкл»: на отправитель — чёрная заглушка, затем камера стопается.
      if (sender && sender.track !== this.cameraPlaceholder) {
        let placeholder: MediaStreamTrack | null = null;
        try {
          placeholder = createBlackVideoTrack();
          await sender.replaceTrack(placeholder);
        } catch {
          // Без заглушки у собеседника застынет кадр — камеру всё равно освобождаем.
        }
        if (placeholder && (epoch !== this.callEpoch || sender.track !== placeholder)) {
          placeholder.stop();
        } else if (placeholder) {
          this.cameraPlaceholder?.stop();
          this.cameraPlaceholder = placeholder;
        }
      }
      // Включили, пока ждали replaceTrack — следующий проход вернёт камеру.
      if (epoch !== this.callEpoch || out.enabled) return;
      cam.stop();
      this.notifyCameraInput();
      return;
    }

    // «Вкл»: освобождённую камеру захватываем заново.
    let live = cam;
    if (cam.readyState === 'ended') {
      try {
        live = await captureCameraTrack();
      } catch (err) {
        console.warn('[Call] camera capture failed:', err);
        const cur = this.localStream?.getVideoTracks()[0];
        if (epoch === this.callEpoch && cur?.enabled) {
          cur.enabled = false;
          this.callbacks?.onCameraFailed?.();
        }
        return;
      }
      if (epoch !== this.callEpoch || this.localStream !== stream) {
        live.stop();
        return;
      }
      if (stream.getVideoTracks().includes(cam)) {
        // Выключили во время захвата — состояние кнопки переносится, а
        // поставленный следом проход освободит камеру снова.
        live.enabled = cam.enabled;
        stream.removeTrack(cam);
        stream.addTrack(live);
      } else {
        live.enabled = true; // за канвасом эффекта: вкл/выкл несёт канвас
      }
      this.cameraTrack = live;
      this.notifyCameraInput();
    }

    // На отправитель — выход звонка; с эффектом сырая камера ждёт его канвас.
    const output = stream.getVideoTracks()[0];
    const holdForEffect = this.cameraEffectWanted && output === live;
    if (!sender || holdForEffect || sender.track === output) return;
    try {
      await sender.replaceTrack(output);
    } catch {
      return;
    }
    if (sender.track === output) this.dropCameraPlaceholder();
  }

  private addLocalTracks(): void {
    const stream = this.localStream;
    const pc = this.peerConnection;
    if (!stream || !pc) return;
    for (const track of stream.getTracks()) {
      if (track.kind === 'video' && track.readyState === 'ended') {
        // Камера освобождена (выключена с начала звонка): в слот — чёрная
        // заглушка, включение подменит её через replaceTrack.
        this.dropCameraPlaceholder();
        this.cameraPlaceholder = createBlackVideoTrack();
        pc.addTrack(this.cameraPlaceholder, stream);
      } else {
        pc.addTrack(track, stream);
      }
    }
  }

  private async createPeerConnection(): Promise<void> {
    // STUN+TURN: TURN credentials are ephemeral and fetched per call — without
    // a relay, peers behind symmetric NAT/VPN never connect.
    this.peerConnection = new RTCPeerConnection({ iceServers: await getIceServers() });

    this.peerConnection.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(event.track);
      this.callbacks?.onRemoteStream(this.remoteStream);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        wsService.send('webrtc_ice_candidate', {
          target_user_id: this.remoteUserId ?? '',
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (
        this.peerConnection?.connectionState === 'disconnected' ||
        this.peerConnection?.connectionState === 'failed'
      ) {
        this.callbacks?.onCallEnded();
        this.cleanup();
      }
    };
  }

  private handleIncomingCall = (payload: unknown): void => {
    const data = payload as { call_id: string; caller_id: string };
    this.currentCallId = data.call_id;
    this.remoteUserId = data.caller_id;
  };

  private handleCallStarted = (payload: unknown): void => {
    const data = payload as { call_id: string };
    this.currentCallId = data.call_id;
    this.isInCall = true;
  };

  private handleCallAccepted = (): void => {
    this.isInCall = true;
  };

  private handleCallRejected = (): void => {
    this.cleanup();
    this.callbacks?.onError(t('call.rejected'));
  };

  private handleCallEnded = (): void => {
    this.cleanup();
    this.callbacks?.onCallEnded();
  };

  private handleWebRTCOffer = (payload: unknown): void => {
    const data = payload as { from_user_id: string; sdp: RTCSessionDescriptionInit };

    if (!this.remoteUserId && data.from_user_id) {
      this.remoteUserId = data.from_user_id;
    }

    if (this.peerConnection && this.callAccepted) {
      // Ignore offers when not in stable state (glare scenario handling)
      if (this.peerConnection.signalingState !== 'stable') {
        return;
      }
      this.sendAnswer(data.sdp).catch((err) => logger.error('Failed to send WebRTC answer:', err, { module: 'call' }));
    } else {
      // acceptCall hasn't finished setting up yet; offer will be processed there
      this.pendingOffer = data.sdp;
    }
  };

  private handleWebRTCAnswer = (payload: unknown): void => {
    const data = payload as { from_user_id: string; sdp: RTCSessionDescriptionInit };
    if (this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
      this.peerConnection.setRemoteDescription(data.sdp).catch((err) => logger.error('setRemoteDescription failed:', err, { module: 'call' }));
    }
  };

  private handleWebRTCICECandidate = (payload: unknown): void => {
    const data = payload as { from_user_id: string; candidate: RTCIceCandidateInit };
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      this.peerConnection.addIceCandidate(data.candidate).catch((err) => logger.error('addIceCandidate failed:', err, { module: 'call' }));
    }
  };

  private handleError = (payload: unknown): void => {
    const data = payload as { message: string };
    this.callbacks?.onError(data.message);
  };

  private cleanup(): void {
    if (this.localStream) {
      // Демонтаж NC-цепочки стопает и raw-треки микрофона; для стримов без
      // цепочки (video-only fallback) releaseChain — no-op.
      noiseCancellationService.releaseChain(this.localStream.id);
      this.localStream.getTracks().forEach((track) => track.stop());
      // Оригинальный камерный трек при активном эффекте уже не в localStream
      // (подменён канвас-треком) — стопаем его отдельно, иначе камера
      // продолжит светиться после завершения звонка. stop() идемпотентен.
      this.cameraTrack?.stop();
      this.localStream = null;
    }
    this.cameraTrack = null;
    this.dropCameraPlaceholder();
    this.callEpoch++;
    this.cameraChain = Promise.resolve();
    this.cameraSyncQueued = false;
    this.cameraInputStream = null;
    this.notifyCameraInput();
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
    this.currentCallId = null;
    this.remoteUserId = null;
    this.isInCall = false;
    this._microphoneAvailable = false;
    this.pendingOffer = null;
    this.callAccepted = false;
  }

  get isInCallState(): boolean {
    return this.isInCall;
  }

  get localStreamState(): MediaStream | null {
    return this.localStream;
  }

  get isMicrophoneAvailable(): boolean {
    return this._microphoneAvailable;
  }

  get remoteUserIdState(): string | null {
    return this.remoteUserId;
  }
}

export const callService = new CallService();
