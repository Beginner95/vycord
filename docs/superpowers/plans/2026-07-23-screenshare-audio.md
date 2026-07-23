# Screen Share Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a participant shares their screen in a group call, listeners hear the shared computer's audio (default output device), captured automatically at share start — no SFU/protocol changes.

**Architecture:** Purely client-side. Desktop/system audio captured alongside the screen video is mixed via Web Audio directly into the same persistent outgoing audio track that already carries the microphone (the one built by `noiseCancellationService`'s `mic → source → [worklet] → destination → sender` chain), instead of adding a second SFU audio transceiver. Mic mute moves from `track.enabled` to a dedicated `GainNode` inside that chain so muting the mic never silences the mixed-in screen-share audio.

**Tech Stack:** TypeScript, Web Audio API (`AudioContext`, `GainNode`, `MediaStreamAudioSourceNode`), existing `getUserMedia`/`getDisplayMedia` capture paths already used for screen sharing. No new dependencies.

## Global Constraints

- No changes to the SFU (Go), signaling protocol, or any backend code — this is a client-only feature (per spec: adding a second SFU audio transceiver was explicitly rejected as too risky for the most bug-prone part of the codebase).
- Audio capture is always automatic when screen sharing starts — no UI toggle, no changes to `GroupCallUI.tsx`.
- If system audio capture is unsupported on the current platform/source, or there's no microphone-based audio chain to mix into, screen sharing must still work as video-only — silently, no error shown to the user.
- Muting the microphone during a screen share with audio must NOT silence the shared audio for listeners.
- No new client test infrastructure exists (no Jest/Vitest) — verification is `npx tsc --noEmit` + manual browser QA + the existing `client/e2e` regression script, per repo convention (see `docs/superpowers/plans/2026-07-20-participant-volume-control.md`).
- Scope is group calls only (`client/src/services/groupCall.ts`); P2P calls (`client/src/services/call.ts`) have no screen sharing and are untouched.

---

## File Structure

- Modify: `client/src/services/noiseCancellation.ts` — add a persistent `micGain: GainNode` to `AudioChain`, plus two new public methods: `setMicMuted(streamId, muted)` and `attachExtraAudio(streamId, stream)`.
- Modify: `client/src/services/groupCall.ts` — capture system audio in `startScreenShare` (both the Electron `sourceId` path and the browser `getDisplayMedia` path), mix it in via `attachExtraAudio`, detach it in `stopScreenShare`/`teardown`, and switch `toggleMuteAudio` to use `setMicMuted`.

---

### Task 1: `noiseCancellation.ts` — mic gain node + mixing API

**Files:**
- Modify: `client/src/services/noiseCancellation.ts:57-70` (`AudioChain` interface), `:169-217` (`doCreateChain`), `:248-253` (after `setModel`, insert new methods), `:298-323` (`activateChain`), `:325-332` (`wireBypass`)

**Interfaces:**
- Produces: `NoiseCancellationService.setMicMuted(streamId: string, muted: boolean): boolean` and `NoiseCancellationService.attachExtraAudio(streamId: string, stream: MediaStream): (() => void) | null` on the exported `noiseCancellationService` singleton — consumed by Task 2 from `groupCall.ts`.

- [ ] **Step 1: Add `micGain` to the `AudioChain` interface**

`client/src/services/noiseCancellation.ts:57-70` currently:

```ts
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
```

Change to:

```ts
interface AudioChain {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
  /** Постоянный узел между веткой микрофона (worklet/bypass) и destination.
   *  Мьют микрофона (setMicMuted) управляет только этим gain — звук шаринга
   *  экрана, подмешанный через attachExtraAudio напрямую в destination, не
   *  завязан на него и не глушится мьютом. */
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
```

- [ ] **Step 2: Create the gain node in `doCreateChain` and connect it to `destination`**

`client/src/services/noiseCancellation.ts:169-217` currently:

```ts
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
```

Change to:

```ts
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
```

- [ ] **Step 3: Route the worklet/bypass output through `micGain` instead of straight to `destination`**

`client/src/services/noiseCancellation.ts:298-323` (`activateChain`) currently contains:

```ts
      chain.source.disconnect();
      chain.source.connect(chain.stage.node);
      chain.stage.node.connect(chain.destination);
      chain.active = true;
```

Change to:

```ts
      chain.source.disconnect();
      chain.source.connect(chain.stage.node);
      chain.stage.node.connect(chain.micGain);
      chain.active = true;
```

`client/src/services/noiseCancellation.ts:325-332` (`wireBypass`) currently:

```ts
  private wireBypass(chain: AudioChain): void {
    chain.source.disconnect();
    if (chain.stage) {
      chain.stage.node.disconnect();
    }
    chain.source.connect(chain.destination);
    chain.active = false;
  }
```

Change to:

```ts
  private wireBypass(chain: AudioChain): void {
    chain.source.disconnect();
    if (chain.stage) {
      chain.stage.node.disconnect();
    }
    chain.source.connect(chain.micGain);
    chain.active = false;
  }
```

- [ ] **Step 4: Add `setMicMuted` and `attachExtraAudio` public methods**

`client/src/services/noiseCancellation.ts:248-253` currently:

```ts
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
```

Change to:

```ts
  setModel(modelId: NcModelId): void {
    if (!(modelId in NC_MODELS)) return;
    this.state.modelId = modelId;
    this.persist();
    this.notify();
  }

  /**
   * Мьютит/анмьютит ветку микрофона независимо от любого звука, подмешанного
   * через attachExtraAudio (тот подключён напрямую к destination, в обход
   * micGain). Возвращает false, если цепочки для streamId нет (например, Web
   * Audio не поддерживается) — тогда вызывающий код должен сам замьютить
   * трек через track.enabled, как это делалось до появления этого метода.
   */
  setMicMuted(streamId: string, muted: boolean): boolean {
    const chain = this.chains.get(streamId);
    if (!chain) return false;
    chain.micGain.gain.value = muted ? 0 : 1;
    return true;
  }

  /**
   * Подмешивает произвольный MediaStream (например, звук шаринга экрана)
   * напрямую в исходящий трек звонка, в обход micGain и NC-worklet'а — этот
   * звук не должен ни глушиться мьютом микрофона, ни обрабатываться
   * шумоподавлением, рассчитанным на голос. Возвращает функцию отключения
   * узла, либо null, если цепочки для streamId нет (например, звонок начат
   * без микрофона) — тогда вызывающий код должен продолжить без подмешивания.
   */
  attachExtraAudio(streamId: string, stream: MediaStream): (() => void) | null {
    const chain = this.chains.get(streamId);
    if (!chain) return null;
    const source = chain.context.createMediaStreamSource(stream);
    source.connect(chain.destination);
    return () => { source.disconnect(); };
  }

  /**
   * Полный демонтаж цепочки в конце звонка. streamId — id стрима, который
   * вернул createChain; неизвестный id — no-op.
   */
  releaseChain(streamId: string): void {
```

- [ ] **Step 5: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (new methods aren't consumed anywhere yet, but the file must type-check standalone).

- [ ] **Step 6: Commit**

```bash
git add client/src/services/noiseCancellation.ts
git commit -m "feat(noise-cancellation): add mic gain node and extra-audio mixing API"
```

---

### Task 2: `groupCall.ts` — capture, mix, and clean up screen-share audio; gain-based mic mute

**Files:**
- Modify: `client/src/services/groupCall.ts:127-132` (new field), `:375-380` (`toggleMuteAudio`), `:395-498` (`startScreenShare`), `:552-578` (`stopScreenShare`), `:1329-1389` (`teardown`)

**Interfaces:**
- Consumes: `noiseCancellationService.setMicMuted(streamId, muted): boolean` and `noiseCancellationService.attachExtraAudio(streamId, stream): (() => void) | null` from Task 1.
- Produces: nothing consumed by later tasks — this is the final integration task.

- [ ] **Step 1: Add `screenAudioDetach` and `micMuted` fields**

`client/src/services/groupCall.ts:127-132` currently:

```ts
  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  // Placeholder video track sent when no camera is available — see createDummyVideoTrack.
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private _isScreenSharing = false;
  private _microphoneAvailable = false;
```

Change to:

```ts
  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  // Detaches the desktop-audio source node mixed into the outgoing audio
  // track via noiseCancellationService.attachExtraAudio — see startScreenShare.
  private screenAudioDetach: (() => void) | null = null;
  // Placeholder video track sent when no camera is available — see createDummyVideoTrack.
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private _isScreenSharing = false;
  private _microphoneAvailable = false;
  // Tracked explicitly because toggleMuteAudio no longer reads mute state off
  // track.enabled — the track must stay enabled so mixed-in screen-share
  // audio (same physical track) is never silenced by mic mute.
  private micMuted = false;
```

- [ ] **Step 2: Switch `toggleMuteAudio` to gain-based mute**

`client/src/services/groupCall.ts:375-380` currently:

```ts
  toggleMuteAudio(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled; // true = muted
  }
```

Change to:

```ts
  toggleMuteAudio(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    if (!t || !this.localStream) return false;
    this.micMuted = !this.micMuted;
    const handledByChain = noiseCancellationService.setMicMuted(this.localStream.id, this.micMuted);
    if (!handledByChain) {
      // No NC chain for this stream (e.g. Web Audio unsupported) — fall back
      // to muting the track itself, the same mechanism used before this
      // feature existed.
      t.enabled = !this.micMuted;
    }
    return this.micMuted;
  }
```

- [ ] **Step 3: Verify types after Steps 1-2**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Capture desktop audio in `startScreenShare`**

`client/src/services/groupCall.ts:395-439` currently:

```ts
  async startScreenShare(sourceId?: string, quality: ScreenQuality = '1080p'): Promise<void> {
    if (!this.pc || !this.inCall) throw new Error('Not in a call');
    if (this._isScreenSharing) await this.stopScreenShare();

    const preset = SCREEN_QUALITY_PRESETS[quality];
    let stream: MediaStream;

    if (sourceId) {
      // Electron: getUserMedia with chromeMediaSource mandatory constraints.
      // max* caps the resolution; min* sets a floor so the call doesn't fail if the source
      // is smaller than requested (e.g. a small window at 2K preset).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: preset.width,
            maxHeight: preset.height,
            maxFrameRate: preset.frameRate,
            minWidth: 640,
            minHeight: 360,
          },
        },
      } as unknown as MediaStreamConstraints);
    } else {
      // Browser fallback: native OS picker with ideal constraints.
      // ideal lets the browser pick the closest resolution; max prevents upscaling.
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: Record<string, unknown>): Promise<MediaStream>;
      }).getDisplayMedia({
        audio: false,
        video: {
          width:     { ideal: preset.width,     max: preset.width },
          height:    { ideal: preset.height,    max: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
      });
    }

    const screenTrack = stream.getVideoTracks()[0];
    if (!screenTrack) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Screen stream has no video track');
    }
```

Change to:

```ts
  async startScreenShare(sourceId?: string, quality: ScreenQuality = '1080p'): Promise<void> {
    if (!this.pc || !this.inCall) throw new Error('Not in a call');
    if (this._isScreenSharing) await this.stopScreenShare();

    const preset = SCREEN_QUALITY_PRESETS[quality];
    let stream: MediaStream;

    if (sourceId) {
      // Electron: getUserMedia with chromeMediaSource mandatory constraints.
      // max* caps the resolution; min* sets a floor so the call doesn't fail if the source
      // is smaller than requested (e.g. a small window at 2K preset).
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: preset.width,
          maxHeight: preset.height,
          maxFrameRate: preset.frameRate,
          minWidth: 640,
          minHeight: 360,
        },
      };
      try {
        // Also request desktop audio loopback (default output device). Only
        // reliably available on Windows/macOS 13+, and typically only when
        // sharing a whole screen rather than a single window. The mandatory
        // constraint throws for the WHOLE getUserMedia call — including the
        // video half — on unsupported combinations, so a failure here must
        // fall back to video-only rather than aborting the share entirely.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
          video: videoConstraints,
        } as unknown as MediaStreamConstraints);
      } catch (err) {
        gcLog(this.currentUserId, 'screen capture with audio failed, retrying video-only', { error: String(err) });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        } as unknown as MediaStreamConstraints);
      }
    } else {
      // Browser fallback: native OS picker with ideal constraints.
      // ideal lets the browser pick the closest resolution; max prevents upscaling.
      // audio: true surfaces the OS picker's "share audio" checkbox where the
      // browser supports it (e.g. Windows/ChromeOS Chrome); on platforms
      // without support the returned stream just has no audio track — no
      // exception is thrown per spec, so no fallback is needed here.
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: Record<string, unknown>): Promise<MediaStream>;
      }).getDisplayMedia({
        audio: true,
        video: {
          width:     { ideal: preset.width,     max: preset.width },
          height:    { ideal: preset.height,    max: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
      });
    }

    const screenTrack = stream.getVideoTracks()[0];
    if (!screenTrack) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Screen stream has no video track');
    }
```

- [ ] **Step 5: Mix the captured audio track (if any) into the outgoing audio track**

`client/src/services/groupCall.ts:484-498` (end of `startScreenShare`) currently:

```ts
    this.screenStream = stream;
    this.screenSender = videoTransceiver.sender;
    this._isScreenSharing = true;

    // replaceTrack doesn't renegotiate, so the SFU has no other signal that the
    // video content just changed. Explicitly ask it to force a keyframe — without
    // this, recovery depends entirely on a viewer's decoder noticing a bad frame
    // and requesting its own PLI, which is unreliable right at the switch and was
    // the cause of intermittent black screens for viewers when sharing started.
    // Retry because OnTrack on the SFU side may not have fired yet (first RTP
    // packet hasn't arrived); retries at 200ms and 800ms cover that window.
    this.requestKeyframeWithRetry();

    gcLog(this.currentUserId, 'screen share started', { sourceId: sourceId?.slice(0, 16) ?? 'getDisplayMedia', quality });
  }
```

Change to:

```ts
    this.screenStream = stream;
    this.screenSender = videoTransceiver.sender;
    this._isScreenSharing = true;

    // Mix captured system/desktop audio (if any) into the existing outgoing
    // audio track via Web Audio — no SFU/protocol changes needed. Silently
    // skipped if the platform gave no audio track, or if there's no NC chain
    // to mix into (e.g. this participant joined without a microphone).
    const systemAudioTrack = stream.getAudioTracks()[0];
    if (systemAudioTrack && this.localStream) {
      this.screenAudioDetach = noiseCancellationService.attachExtraAudio(
        this.localStream.id,
        new MediaStream([systemAudioTrack]),
      );
      gcLog(this.currentUserId, 'screen share audio', { captured: true, mixed: this.screenAudioDetach !== null });
    } else {
      gcLog(this.currentUserId, 'screen share audio', { captured: false });
    }

    // replaceTrack doesn't renegotiate, so the SFU has no other signal that the
    // video content just changed. Explicitly ask it to force a keyframe — without
    // this, recovery depends entirely on a viewer's decoder noticing a bad frame
    // and requesting its own PLI, which is unreliable right at the switch and was
    // the cause of intermittent black screens for viewers when sharing started.
    // Retry because OnTrack on the SFU side may not have fired yet (first RTP
    // packet hasn't arrived); retries at 200ms and 800ms cover that window.
    this.requestKeyframeWithRetry();

    gcLog(this.currentUserId, 'screen share started', { sourceId: sourceId?.slice(0, 16) ?? 'getDisplayMedia', quality });
  }
```

- [ ] **Step 6: Detach the mixed audio in `stopScreenShare`**

`client/src/services/groupCall.ts:552-578` currently:

```ts
  async stopScreenShare(): Promise<void> {
    if (!this._isScreenSharing) return;

    this._isScreenSharing = false;

    // Restore the camera track. If the camera was unavailable at join time,
    // cameraTrack will be null and the sender will stop sending video — correct.
    const cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    if (this.screenSender) {
      await this.screenSender.replaceTrack(cameraTrack).catch((err) => {
        gcLog(this.currentUserId, 'stopScreenShare replaceTrack error', { error: String(err) });
      });
      // Lift the screen-share bitrate cap and degradation preference off the
      // sender — the camera (or dummy) track should run on browser defaults.
      await this.applyScreenShareEncoding(this.screenSender, null);
    }

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;

    // Same reasoning as in startScreenShare: switching back to the camera track
    // is another replaceTrack with no renegotiation, so push a keyframe explicitly.
    this.requestKeyframeWithRetry();

    gcLog(this.currentUserId, 'screen share stopped');
  }
```

Change to:

```ts
  async stopScreenShare(): Promise<void> {
    if (!this._isScreenSharing) return;

    this._isScreenSharing = false;

    // Restore the camera track. If the camera was unavailable at join time,
    // cameraTrack will be null and the sender will stop sending video — correct.
    const cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    if (this.screenSender) {
      await this.screenSender.replaceTrack(cameraTrack).catch((err) => {
        gcLog(this.currentUserId, 'stopScreenShare replaceTrack error', { error: String(err) });
      });
      // Lift the screen-share bitrate cap and degradation preference off the
      // sender — the camera (or dummy) track should run on browser defaults.
      await this.applyScreenShareEncoding(this.screenSender, null);
    }

    this.screenAudioDetach?.();
    this.screenAudioDetach = null;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;

    // Same reasoning as in startScreenShare: switching back to the camera track
    // is another replaceTrack with no renegotiation, so push a keyframe explicitly.
    this.requestKeyframeWithRetry();

    gcLog(this.currentUserId, 'screen share stopped');
  }
```

- [ ] **Step 7: Detach the mixed audio in `teardown` (covers leaving the call mid-share)**

`client/src/services/groupCall.ts:1329-1350` currently (start of `teardown`):

```ts
  private teardown(): void {
    gcLog(this.currentUserId, '[METRIC] call-summary', {
      callDurationMs: this.joinedAt ? Date.now() - this.joinedAt : -1,
      firstAudioFrames: Object.fromEntries(
        [...this.firstAudioFrameAt.entries()].map(([sid, ts]) => [
          sid.slice(0, 8),
          { elapsedFromJoinMs: this.joinedAt ? ts - this.joinedAt : -1 },
        ])
      ),
    });
    gcLog(this.currentUserId, 'teardown', {
      remoteStreams: this.remoteStreams.size,
      pcState: this.pc?.connectionState ?? 'null',
    });
    this.pc?.close();
    this.pc = null;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;
    this._isScreenSharing = false;
```

Change to:

```ts
  private teardown(): void {
    gcLog(this.currentUserId, '[METRIC] call-summary', {
      callDurationMs: this.joinedAt ? Date.now() - this.joinedAt : -1,
      firstAudioFrames: Object.fromEntries(
        [...this.firstAudioFrameAt.entries()].map(([sid, ts]) => [
          sid.slice(0, 8),
          { elapsedFromJoinMs: this.joinedAt ? ts - this.joinedAt : -1 },
        ])
      ),
    });
    gcLog(this.currentUserId, 'teardown', {
      remoteStreams: this.remoteStreams.size,
      pcState: this.pc?.connectionState ?? 'null',
    });
    this.pc?.close();
    this.pc = null;

    this.screenAudioDetach?.();
    this.screenAudioDetach = null;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;
    this._isScreenSharing = false;
```

`client/src/services/groupCall.ts:1370-1375` (further down in the same `teardown`) currently:

```ts
    this.currentRoomId = '';
    this._microphoneAvailable = false;
    this.joinedAt = 0;
```

Change to:

```ts
    this.currentRoomId = '';
    this._microphoneAvailable = false;
    this.micMuted = false;
    this.joinedAt = 0;
```

- [ ] **Step 8: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manual smoke check — video-only fallback must survive an audio-capture failure**

This is the most important regression check per spec: audio capture must never break existing video sharing.

Run: `npm run dev` (from `client/`, starts the Electron app) on the Linux dev machine, where desktop audio loopback capture is expected to be unsupported for at least some source types.

Expected:
- Join a group call, start screen sharing (pick a window, not the whole screen, to maximize the chance of hitting the audio-unsupported path).
- Screen share starts normally and video is visible to another participant, exactly as before this change.
- In the console/log output, look for either `screen share audio { captured: true, ... }` or `screen capture with audio failed, retrying video-only` followed by `screen share audio { captured: false }` — either is fine, but video must work in both cases.
- Stop and restart the share a few times — no errors, no leaked state.

- [ ] **Step 10: Manual smoke check — mixed audio and mute independence (best-effort, needs a platform where capture works)**

If a Windows or macOS 13+ machine is available (otherwise skip and note as not verified on this platform):

- Start screen sharing something with sound (e.g. a video playing).
- From a second participant, confirm they hear the shared computer's audio.
- Mute your own microphone — confirm the second participant still hears the shared audio, and stops hearing your voice.
- Unmute — confirm your voice returns and shared audio is unaffected throughout.
- Stop sharing — confirm the shared audio stops for listeners, mic audio (if unmuted) continues normally.

- [ ] **Step 11: Regression — existing screen-share e2e test**

Run: `cd client && npm run test:e2e`
Expected: PASS (the no-camera screenshare scenario doesn't touch audio, but confirms the video capture/negotiation path in `groupCall.ts` wasn't broken by these edits).

- [ ] **Step 12: Commit**

```bash
git add client/src/services/groupCall.ts
git commit -m "feat(group-call): capture and mix desktop audio into screen share"
```

---

## Self-Review

**Spec coverage:**
- No SFU/protocol changes → confirmed, both tasks touch only `client/src/services/*.ts`
- Audio capture always automatic, no UI toggle → confirmed, `GroupCallUI.tsx` not in File Structure
- Silent video-only fallback on unsupported platforms → Task 2 Step 4 (try/catch around the Electron mandatory-constraint call), Step 5 (`if (systemAudioTrack && this.localStream)` guard, no error path)
- No mixing when no mic chain exists (join without microphone) → Task 2 Step 5 (`this.localStream` check) + `attachExtraAudio`'s own `chains.get` guard in Task 1 Step 4
- Mic mute doesn't silence screen-share audio → Task 1 Steps 1-4 (`micGain` isolates the mic branch; `attachExtraAudio` connects straight to `destination`), Task 2 Step 2 (`toggleMuteAudio` uses `setMicMuted`)
- Fallback mute mechanism when no NC chain → Task 2 Step 2 (`handledByChain` check, falls back to `t.enabled`)
- Reconnect survives without extra code (chain/track persist across `partialTeardown`) → no `partialTeardown`/`restoreScreenShare`/`applyScreenRestore` changes in this plan, matching the spec's stated reasoning
- Cleanup on stop and on mid-share leave → Task 2 Steps 6-7 (`stopScreenShare` and `teardown` both detach)
- Testing: `tsc --noEmit`, manual QA, existing e2e regression → Task 1 Step 5, Task 2 Steps 8-11

**Placeholder scan:** no TBD/TODO; every step shows exact before/after code.

**Type consistency:** `setMicMuted(streamId: string, muted: boolean): boolean` (Task 1 Step 4) matches its call site `noiseCancellationService.setMicMuted(this.localStream.id, this.micMuted)` (Task 2 Step 2) — both a `string` id and `boolean` muted flag, return value used as `handledByChain: boolean`. `attachExtraAudio(streamId: string, stream: MediaStream): (() => void) | null` (Task 1 Step 4) matches `noiseCancellationService.attachExtraAudio(this.localStream.id, new MediaStream([systemAudioTrack]))` (Task 2 Step 5), assigned to `screenAudioDetach: (() => void) | null` (Task 2 Step 1) and invoked as `this.screenAudioDetach?.()` (Task 2 Steps 6-7).
