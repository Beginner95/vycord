// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoiseCancellationService } from '@/services/noiseCancellation';

// VYC-96: AudioContext цепочки звонка должен оживать событийно (statechange,
// visibilitychange, pageshow, …), а не только по троттлящемуся в фоне таймеру.

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext extends EventTarget {
  static last: FakeAudioContext | null = null;
  state: string = 'running';
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  constructor() {
    super();
    FakeAudioContext.last = this;
  }
  createMediaStreamSource() { return new FakeNode(); }
  createMediaStreamDestination() {
    const node = new FakeNode() as FakeNode & { stream: FakeMediaStream };
    node.stream = new FakeMediaStream([{ kind: 'audio', stop: vi.fn() }]);
    return node;
  }
  createGain() { return Object.assign(new FakeNode(), { gain: { value: 1 } }); }
  /** Имитация браузера: контекст ушёл в state и сообщил об этом. */
  goTo(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

interface FakeTrack { kind: string; stop: () => void }

let streamSeq = 0;
class FakeMediaStream {
  id = `stream-${++streamSeq}`;
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = [...tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t: FakeTrack) { this.tracks.push(t); }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function makeChain() {
  localStorage.setItem('vycord_nc_settings', JSON.stringify({ enabled: false }));
  const svc = new NoiseCancellationService();
  const raw = new FakeMediaStream([{ kind: 'audio', stop: vi.fn() }]);
  const out = await svc.createChain(raw as unknown as MediaStream);
  const ctx = FakeAudioContext.last!;
  ctx.resume.mockClear();
  return { svc, out, ctx };
}

describe('NoiseCancellationService — AudioContext lifecycle (VYC-96)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', class {});
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('MediaStream', FakeMediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('resumes immediately when the context reports suspended', async () => {
    const { ctx } = await makeChain();
    ctx.goTo('suspended');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes on iOS "interrupted" too', async () => {
    const { ctx } = await makeChain();
    ctx.goTo('interrupted');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the context is running', async () => {
    const { ctx } = await makeChain();
    ctx.goTo('running');
    setVisibility('hidden');
    window.dispatchEvent(new Event('pageshow'));
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('resumes on visibilitychange (hidden and visible) and on pageshow', async () => {
    const { ctx } = await makeChain();
    ctx.state = 'suspended'; // без statechange — например, событие потерялось в фоне
    setVisibility('hidden');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pageshow'));
    expect(ctx.resume).toHaveBeenCalledTimes(3);
  });

  it('retries with backoff when resume is rejected, without a tight loop', async () => {
    const { ctx } = await makeChain();
    ctx.resume.mockImplementation(() => Promise.reject(new Error('not allowed')));
    ctx.goTo('suspended');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    // Первая пауза — 250 мс, не раньше.
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    // Дальше паузы растут: за 10 с — единицы попыток, не сотни.
    await vi.advanceTimersByTimeAsync(10_000);
    // (keepAlive-поллинг раз в 2 с добавляет свои попытки — он был и раньше.)
    expect(ctx.resume.mock.calls.length).toBeLessThan(15);
  });

  it('caps immediate statechange-driven resumes (browser re-suspending at once)', async () => {
    const { ctx } = await makeChain();
    for (let i = 0; i < 20; i++) ctx.goTo('suspended');
    expect(ctx.resume.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('a user gesture resets the backoff and retries immediately', async () => {
    const { ctx } = await makeChain();
    ctx.resume.mockImplementation(() => Promise.reject(new Error('not allowed')));
    ctx.goTo('suspended');
    await vi.advanceTimersByTimeAsync(5_000);
    const before = ctx.resume.mock.calls.length;
    window.dispatchEvent(new Event('pointerdown'));
    expect(ctx.resume.mock.calls.length).toBe(before + 1);
  });

  it('removes every listener and the retry timer in releaseChain', async () => {
    const { svc, out, ctx } = await makeChain();
    ctx.resume.mockImplementation(() => Promise.reject(new Error('not allowed')));
    ctx.goTo('suspended');
    await vi.advanceTimersByTimeAsync(0);
    svc.releaseChain(out.id);
    ctx.resume.mockClear();
    ctx.state = 'suspended';
    ctx.dispatchEvent(new Event('statechange'));
    setVisibility('hidden');
    setVisibility('visible');
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
