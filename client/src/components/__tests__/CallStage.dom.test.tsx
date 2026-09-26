// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { CallStage } from '../CallStage';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { stubBrowser, participant } from './callHarness';

vi.mock('@/services/groupCall', () => ({
  groupCallService: { localStreamState: null, screenStreamState: null, toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(), stopScreenShare: vi.fn(), startScreenShare: vi.fn(), watchShare: vi.fn(), unwatchShare: vi.fn(), setCameraOutput: vi.fn(async () => {}) },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, getUserById: vi.fn(async () => ({ id: 'u2', username: 'boris' })) } };
});

beforeAll(stubBrowser);
beforeEach(() => {
  useAuthStore.setState({ user: { id: 'u1', username: 'anna' } as never });
  useServerStore.setState({ servers: [{ id: 's1', guest_links_enabled: true } as never] });
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [participant('u2'), participant('u3')], directory: {}, guestSelf: null,
  });
});
afterEach(() => { cleanup(); useCallStore.getState().reset(); });

const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/CallStage.${name}.html`);

describe('CallStage DOM (desktop parity, снято до VYC-95 этапа 4)', () => {
  it('grid, 2 remote participants', async () => { render(<CallStage />); await act(async () => {}); await snap('grid'); });
  it('reconnecting', async () => { useCallStore.setState({ status: 'reconnecting' }); render(<CallStage />); await snap('reconnecting'); });
  it('focused participant', async () => { useCallStore.setState({ focusedUserId: 'u2' }); render(<CallStage />); await snap('focused'); });
  it('screen sharing self', async () => { useCallStore.setState({ isScreenSharing: true }); render(<CallStage />); await snap('sharing'); });
  it('solo (no remote participants)', async () => { useCallStore.setState({ participants: [] }); render(<CallStage />); await snap('solo'); });
});
