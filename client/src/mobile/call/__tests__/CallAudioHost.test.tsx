// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const fakeService = vi.hoisted(() => ({
  localStreamState: null as unknown,
  screenStreamState: null as unknown,
  toggleMuteAudio: vi.fn(() => true),
  toggleMuteVideo: vi.fn(),
  stopScreenShare: vi.fn(),
  startScreenShare: vi.fn(),
  watchShare: vi.fn(),
  unwatchShare: vi.fn(),
  leaveGroupCall: vi.fn(),
  isScreenSharing: false,
  currentRoomIdState: null as string | null,
}));
vi.mock('@/services/groupCall', () => ({ groupCallService: fakeService }));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, getUserById: vi.fn(async () => ({ id: 'x', username: 'x' })) } };
});
vi.mock('@/mobile/hooks/useAudioOutput', () => ({
  useAudioOutput: () => ({ supported: false, cycle: () => {}, currentLabel: '' }),
}));

import { CallAudioHost } from '@/mobile/call/CallAudioHost';
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import { useCallStageModel } from '@/components/useCallStageModel';
import { useCallStore } from '@/stores/callStore';
import { useAuthStore } from '@/stores/authStore';
import { callBus } from '@/services/callBus';
import { stubBrowser } from '@/components/__tests__/callHarness';

function fakeStream(id: string): MediaStream {
  return {
    id,
    getAudioTracks: () => [],
    getVideoTracks: () => [],
    getTracks: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStream;
}

const audios = () => [...document.querySelectorAll<HTMLAudioElement>('.call-audio-host audio')];
const flush = () => act(async () => {});

beforeAll(() => {
  stubBrowser();
  HTMLMediaElement.prototype.pause = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1', username: 'anna' } as never });
});
afterEach(() => { cleanup(); useCallStore.getState().reset(); });

describe('CallAudioHost: playback', () => {
  it('binds each participant stream to an <audio>, plays muted then unmutes, applies volume', async () => {
    const s2 = fakeStream('s2');
    const s3 = fakeStream('s3');
    useCallStore.setState({
      status: 'connected', callChannelId: 'c1',
      participants: [{ userId: 'u2', stream: s2 }, { userId: 'u3', stream: s3 }, { userId: 'u4', stream: null }],
      participantVolumes: { u3: 40 },
    });
    render(<CallAudioHost />);
    await flush();
    const els = audios();
    expect(els.length).toBe(2);
    expect(els[0].srcObject).toBe(s2);
    expect(els[1].srcObject).toBe(s3);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(els[0].muted).toBe(false);
    expect(els[0].volume).toBe(1);
    expect(els[1].volume).toBeCloseTo(0.4);

    act(() => { useCallStore.setState({ participantVolumes: { u3: 80 } }); });
    expect(audios()[1].volume).toBeCloseTo(0.8);
  });

  it('drops the element (and its srcObject) when a participant leaves', async () => {
    const s2 = fakeStream('s2');
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', participants: [{ userId: 'u2', stream: s2 }] });
    render(<CallAudioHost />);
    await flush();
    const el = audios()[0];
    expect(el.srcObject).toBe(s2);
    act(() => { useCallStore.setState({ participants: [] }); });
    expect(audios().length).toBe(0);
    expect(el.srcObject).toBeNull();
    expect(s2.removeEventListener).toHaveBeenCalledWith('addtrack', expect.any(Function));
  });

  it('rebinds when a participant stream is replaced', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', participants: [{ userId: 'u2', stream: fakeStream('a') }] });
    render(<CallAudioHost />);
    await flush();
    const next = fakeStream('b');
    act(() => { useCallStore.setState({ participants: [{ userId: 'u2', stream: next }] }); });
    await flush();
    expect(audios()[0].srcObject).toBe(next);
  });

  it('does not play screen-share streams (they sound from the focused main video)', async () => {
    useCallStore.setState({
      status: 'connected', callChannelId: 'c1',
      participants: [{ userId: 'u2', stream: fakeStream('cam') }],
      remoteScreenStreams: new Map([['u2', fakeStream('screen')]]),
    });
    render(<CallAudioHost />);
    await flush();
    expect(audios().map((a) => (a.srcObject as MediaStream).id)).toEqual(['cam']);
  });

  it('host elements receive setSinkId from the call-screen model applySinkId', async () => {
    const setSinkId = vi.fn(async () => {});
    (HTMLMediaElement.prototype as unknown as { setSinkId: typeof setSinkId }).setSinkId = setSinkId;
    try {
      useCallStore.setState({ status: 'connected', callChannelId: 'c1', participants: [{ userId: 'u2', stream: fakeStream('s') }] });
      let apply: ((id: string) => void) | null = null;
      function Probe() { apply = useCallStageModel({ externalAudio: true }).applySinkId; return null; }
      render(<><CallAudioHost /><Probe /></>);
      await flush();
      act(() => apply!('dev-2'));
      expect(setSinkId).toHaveBeenCalledWith('dev-2');
      expect(setSinkId.mock.contexts).toContain(audios()[0]);
    } finally {
      delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
    }
  });
});

describe('Call tiles with / without the audio host (double audio regression)', () => {
  function Screen({ externalAudio }: { externalAudio?: boolean }) {
    const model = useCallStageModel(externalAudio === undefined ? undefined : { externalAudio });
    return <MobileCallScreen model={model} onOpenChat={() => {}} onOpenOverflow={() => {}} onOpenQuality={() => {}} />;
  }
  const tileVideo = () => document.querySelector<HTMLVideoElement>('.mcs-grid-cell:not(.is-self) video')!;

  it('externalAudio: remote tile <video> stays muted after the stream is attached', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', participants: [{ userId: 'u2', stream: fakeStream('s2') }] });
    render(<Screen externalAudio />);
    await flush();
    const v = tileVideo();
    expect(v).toBeTruthy();
    expect(v.srcObject).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(v.muted).toBe(true);
  });

  it('default (desktop / guest shell, no host): the tile unmutes after play, as before', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', participants: [{ userId: 'u2', stream: fakeStream('s2') }] });
    render(<Screen />);
    await flush();
    const v = tileVideo();
    expect(v.srcObject).toBeTruthy();
    expect(v.muted).toBe(false);
  });
});

describe('CallAudioHost: MediaSession', () => {
  type Handler = (() => void) | null;
  let handlers: Map<string, Handler>;
  let session: {
    metadata: unknown; playbackState: string;
    setActionHandler: (a: string, h: Handler) => void; setMicrophoneActive: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers = new Map();
    session = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: (a, h) => { if (h) handlers.set(a, h); else handlers.delete(a); },
      setMicrophoneActive: vi.fn(async () => {}),
    };
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
    (globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata = class { constructor(init: object) { Object.assign(this, init); } };
  });
  afterEach(() => {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
    delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
  });

  it('sets metadata/playbackState/handlers during the call and clears them on unmount', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', callChannelName: 'general', participants: [] });
    const { unmount } = render(<CallAudioHost />);
    await flush();
    const meta = session.metadata as { title: string; artist: string; artwork: { src: string }[] };
    expect(meta.title).toBe('general');
    expect(meta.artist).toBe('VYCORD');
    expect(meta.artwork.map((a) => a.src)).toEqual(['/icons/icon-192.png', '/icons/icon-512.png']);
    expect(session.playbackState).toBe('playing');
    expect(handlers.has('hangup')).toBe(true);
    expect(handlers.has('togglemicrophone')).toBe(true);
    expect(session.setMicrophoneActive).toHaveBeenCalledWith(true);

    unmount();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(handlers.size).toBe(0);
  });

  it('falls back to the translated title without a channel name', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', callChannelName: null });
    render(<CallAudioHost />);
    await flush();
    expect((session.metadata as { title: string }).title).toBeTruthy();
    expect((session.metadata as { title: string }).title).not.toBe('general');
  });

  it('togglemicrophone toggles mute; hangup leaves the call', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', isMuted: false });
    render(<CallAudioHost />);
    await flush();
    act(() => handlers.get('togglemicrophone')!());
    expect(fakeService.toggleMuteAudio).toHaveBeenCalled();
    expect(useCallStore.getState().isMuted).toBe(true);
    expect(callBus.send).toHaveBeenCalledWith('mic_muted', {});

    act(() => handlers.get('hangup')!());
    expect(fakeService.leaveGroupCall).toHaveBeenCalled();
    expect(useCallStore.getState().status).toBe('idle');
  });

  it('togglemicrophone does nothing without a microphone (like the disabled mic button)', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', isMuted: false, isMicAvailable: false });
    render(<CallAudioHost />);
    await flush();
    act(() => handlers.get('togglemicrophone')!());
    expect(fakeService.toggleMuteAudio).not.toHaveBeenCalled();
    expect(useCallStore.getState().isMuted).toBe(false);
    expect(callBus.send).not.toHaveBeenCalled();
  });

  it('resets setMicrophoneActive on unmount', async () => {
    useCallStore.setState({ status: 'connected', callChannelId: 'c1', isMuted: false });
    const { unmount } = render(<CallAudioHost />);
    await flush();
    session.setMicrophoneActive.mockClear();
    unmount();
    expect(session.setMicrophoneActive).toHaveBeenCalledWith(false);
  });

  it('survives a browser without the hangup/togglemicrophone actions', async () => {
    session.setActionHandler = (a) => { if (a === 'hangup' || a === 'togglemicrophone') throw new TypeError('unsupported'); };
    useCallStore.setState({ status: 'connected', callChannelId: 'c1' });
    const { unmount } = render(<CallAudioHost />);
    await flush();
    expect(session.playbackState).toBe('playing');
    expect(() => unmount()).not.toThrow();
  });
});
