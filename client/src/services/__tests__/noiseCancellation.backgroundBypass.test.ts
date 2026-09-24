// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoiseCancellationService } from '@/services/noiseCancellation';

// VYC-96: пока мобильное приложение свёрнуто, микрофон идёт мимо worklet'а;
// stage не уничтожается, пользовательское намерение NC не трогается.

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext extends EventTarget {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  createMediaStreamSource() { return new FakeNode(); }
  createMediaStreamDestination() {
    return Object.assign(new FakeNode(), { stream: new FakeMediaStream([{ kind: 'audio' }]) });
  }
  createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
}

let seq = 0;
class FakeMediaStream {
  id = `s-${++seq}`;
  private tracks: { kind: string; stop?: () => void }[];
  constructor(tracks: { kind: string; stop?: () => void }[] = []) { this.tracks = [...tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t: { kind: string }) { this.tracks.push(t); }
}

type Stage = { node: FakeNode; worker: { terminate: ReturnType<typeof vi.fn> }; modelId: string };

function makeService(ncEnabled: boolean) {
  localStorage.setItem('vycord_nc_settings', JSON.stringify({ enabled: ncEnabled }));
  const svc = new NoiseCancellationService();
  const stages: Stage[] = [];
  const buildStage = vi
    .spyOn(svc as unknown as { buildStage: () => Promise<Stage> }, 'buildStage')
    .mockImplementation(async () => {
      const stage = { node: new FakeNode(), worker: { terminate: vi.fn() }, modelId: svc.getState().modelId };
      stages.push(stage);
      return stage;
    });
  const newRaw = () => new FakeMediaStream([{ kind: 'audio', stop: vi.fn() }]) as unknown as MediaStream;
  return { svc, stages, buildStage, newRaw };
}

const diag = (svc: NoiseCancellationService, id: string) => svc.getChainDiagnostics(id)!;

describe('NoiseCancellationService.setBackgroundBypass (VYC-96)', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('MediaStream', FakeMediaStream);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hidden: worklet out of the chain, stage kept; visible: back without rebuilding', async () => {
    const { svc, stages, buildStage, newRaw } = makeService(true);
    const out = await svc.createChain(newRaw());
    expect(diag(svc, out.id).ncActive).toBe(true);

    await svc.setBackgroundBypass(true);
    expect(diag(svc, out.id)).toMatchObject({ ncActive: false, ncBypassed: true });
    expect(stages[0].worker.terminate).not.toHaveBeenCalled();
    expect(stages[0].node.disconnect).toHaveBeenCalled();
    // UI не мигает, намерение пользователя не тронуто.
    expect(svc.getState()).toMatchObject({ isEnabled: true, isActive: true });
    expect(JSON.parse(localStorage.getItem('vycord_nc_settings')!).enabled).toBe(true);

    await svc.setBackgroundBypass(false);
    expect(diag(svc, out.id)).toMatchObject({ ncActive: true, ncBypassed: false });
    expect(buildStage).toHaveBeenCalledTimes(1);
    expect(svc.getState().isActive).toBe(true);
  });

  it('visible does not bring the worklet back when the user has NC off', async () => {
    const { svc, buildStage, newRaw } = makeService(false);
    const out = await svc.createChain(newRaw());
    await svc.setBackgroundBypass(true);
    await svc.setBackgroundBypass(false);
    expect(diag(svc, out.id).ncActive).toBe(false);
    expect(buildStage).not.toHaveBeenCalled();
    expect(svc.getState().isActive).toBe(false);
  });

  it('user turns NC off in the background → stays off on return', async () => {
    const { svc, newRaw } = makeService(true);
    const out = await svc.createChain(newRaw());
    await svc.setBackgroundBypass(true);
    await svc.setEnabled(false);
    expect(svc.getState()).toMatchObject({ isEnabled: false, isActive: false });
    await svc.setBackgroundBypass(false);
    expect(diag(svc, out.id).ncActive).toBe(false);
  });

  it('user turns NC on in the background → worklet only after return', async () => {
    const { svc, buildStage, newRaw } = makeService(false);
    const out = await svc.createChain(newRaw());
    await svc.setBackgroundBypass(true);
    await svc.setEnabled(true);
    expect(diag(svc, out.id).ncActive).toBe(false);
    expect(buildStage).not.toHaveBeenCalled();
    await svc.setBackgroundBypass(false);
    expect(diag(svc, out.id).ncActive).toBe(true);
    expect(buildStage).toHaveBeenCalledTimes(1);
  });

  it('createChain while hidden starts in bypass; worklet attaches on return', async () => {
    const { svc, buildStage, newRaw } = makeService(true);
    await svc.setBackgroundBypass(true);
    const out = await svc.createChain(newRaw());
    expect(diag(svc, out.id)).toMatchObject({ ncActive: false, ncBypassed: true });
    expect(buildStage).not.toHaveBeenCalled();
    await svc.setBackgroundBypass(false);
    expect(diag(svc, out.id).ncActive).toBe(true);
  });

  it('is idempotent and serialised (rapid hidden/visible)', async () => {
    const { svc, buildStage, newRaw } = makeService(true);
    const out = await svc.createChain(newRaw());
    await Promise.all([
      svc.setBackgroundBypass(true),
      svc.setBackgroundBypass(true),
      svc.setBackgroundBypass(false),
      svc.setBackgroundBypass(true),
      svc.setBackgroundBypass(false),
      svc.setBackgroundBypass(false),
    ]);
    expect(diag(svc, out.id)).toMatchObject({ ncActive: true, ncBypassed: false });
    expect(buildStage).toHaveBeenCalledTimes(1);
  });
});
