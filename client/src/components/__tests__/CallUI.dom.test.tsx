// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { CallUI } from '../CallUI';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { wsService } from '@/services/websocket';
import { stubBrowser } from './callHarness';

vi.mock('@/services/call', () => ({
  callService: {
    init: vi.fn(),
    localStreamState: null,
    isMicrophoneAvailable: true,
    remoteUserIdState: 'u2',
    acceptCall: vi.fn(async () => {}),
    rejectCall: vi.fn(),
    endCall: vi.fn(),
    toggleMuteAudio: vi.fn(() => false),
    toggleMuteVideo: vi.fn(() => true),
  },
}));
vi.mock('@/services/audio', () => ({
  audioService: {
    startRingtone: vi.fn(),
    stopRingtone: vi.fn(),
    playCallAccepted: vi.fn(),
    playCallEnded: vi.fn(),
    playBusy: vi.fn(),
    playUserJoined: vi.fn(),
    playUserLeft: vi.fn(),
  },
}));
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

// Реальный тип колбэков (WebRTCCallbacks) не экспортирован из services/call —
// достаточно знать сигнатуру onRemoteStream, единственную, что зовёт тест.
const cs = callService as unknown as {
  init: ReturnType<typeof vi.fn>;
};
const ws = wsService as unknown as {
  on: ReturnType<typeof vi.fn>;
};

beforeAll(stubBrowser);
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u1', username: 'anna' } as never });
});
afterEach(() => { cleanup(); });

const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/CallUI.${name}.html`);

// useMicLevel bails out before touching AudioContext (не реализован в jsdom),
// когда у стрима нет аудиодорожек — этого достаточно, чтобы remoteStream был
// «есть» для рендера, не завязываясь на настоящий WebRTC.
const fakeStream = { getAudioTracks: () => [] } as unknown as MediaStream;

describe('CallUI DOM (desktop parity, снято до VYC-95 этапа 4)', () => {
  it('incoming call', async () => {
    render(<CallUI />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('discrod:incoming_call', { detail: { call_id: 'call1', caller_id: 'u2' } }));
    });
    await snap('incoming');
  });

  it('active call with remote stream', async () => {
    render(<CallUI />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('discrod:call_started', { detail: { call_id: 'call1' } }));
    });
    const lastInit = cs.init.mock.calls[cs.init.mock.calls.length - 1];
    const onRemoteStream = lastInit?.[0]?.onRemoteStream as ((s: MediaStream) => void) | undefined;
    await act(async () => {
      onRemoteStream?.(fakeStream);
    });
    await snap('active');
  });

  it('active call, remote muted', async () => {
    render(<CallUI />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('discrod:call_started', { detail: { call_id: 'call1' } }));
    });
    const lastInit = cs.init.mock.calls[cs.init.mock.calls.length - 1];
    const onRemoteStream = lastInit?.[0]?.onRemoteStream as ((s: MediaStream) => void) | undefined;
    await act(async () => {
      onRemoteStream?.(fakeStream);
    });
    const mutedCall = ws.on.mock.calls.find((call: unknown[]) => call[0] === 'mic_muted');
    const mutedHandler = mutedCall?.[1] as ((payload: unknown) => void) | undefined;
    await act(async () => {
      mutedHandler?.({ user_id: 'u2' });
    });
    await snap('remote-muted');
  });
});
