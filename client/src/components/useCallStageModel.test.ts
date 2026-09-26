// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useCallStageModel } from './useCallStageModel';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { stubBrowser } from './__tests__/callHarness';

// Хук тянет за собой groupCallService/callBus/apiService на верхнем уровне —
// это только чистые куски (форматирование, производные булевы, резолв имени),
// полный цикл эффектов уже покрыт T1's DOM-тестами через CallStage.
vi.mock('@/services/groupCall', () => ({
  groupCallService: { localStreamState: null, screenStreamState: null, toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(), stopScreenShare: vi.fn(), startScreenShare: vi.fn(), watchShare: vi.fn(), unwatchShare: vi.fn() },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, getUserById: vi.fn(async () => ({ id: 'never', username: 'never' })) } };
});

beforeAll(stubBrowser);
beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ user: { id: 'u1', username: 'anna' } as never });
  useCallStore.setState({ callChannelId: null, participants: [], directory: {}, guestSelf: null });
});
afterEach(() => { cleanup(); useCallStore.getState().reset(); useGuestManagementStore.getState().reset(); });

describe('useCallStageModel: applySinkId', () => {
  it('does not throw when no video elements are attached yet', () => {
    const { result } = renderHook(() => useCallStageModel());
    expect(() => result.current.applySinkId('device-1')).not.toThrow();
  });
});

describe('useCallStageModel: nameFor resolution order', () => {
  it('prefers the directory entry when present', () => {
    useCallStore.setState({ directory: { u2: { username: 'Directory Boris', avatar_url: null, isGuest: false } } });
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.nameFor('u2')).toBe('Directory Boris');
  });

  it('falls back to a guest id → channel guest display_name lookup', () => {
    useGuestManagementStore.setState({
      channelGuests: new Map([['c1', [{ id: 'guest:abcdef12', display_name: 'Guest Vera' }]]]),
    });
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.nameFor('guest:abcdef12')).toBe('Guest Vera');
  });

  it('unresolved guest id falls back to its short id', () => {
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.nameFor('guest:zzzzzzzzzzzz')).toBe('zzzzzzzz');
  });

  it('unresolved non-guest id falls back to its short id (userCache empty)', () => {
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.nameFor('u3-unresolved')).toBe('u3-unres');
  });
});

describe('useCallStageModel: derived booleans', () => {
  it('isInGroupCall reflects callChannelId', () => {
    useCallStore.setState({ callChannelId: null });
    const { result: notInCall } = renderHook(() => useCallStageModel());
    expect(notInCall.current.isInGroupCall).toBe(false);

    useCallStore.setState({ callChannelId: 'c1' });
    const { result: inCall } = renderHook(() => useCallStageModel());
    expect(inCall.current.isInGroupCall).toBe(true);
  });

  it('totalParticipants is participants.length + 1 (self)', () => {
    useCallStore.setState({
      participants: [
        { userId: 'u2', stream: null },
        { userId: 'u3', stream: null },
      ],
    });
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.totalParticipants).toBe(3);
  });

  it('isGuestMode is true only when guestSelf is set', () => {
    useCallStore.setState({ guestSelf: { id: 'g1', username: 'Guest', avatar_url: null } });
    const { result } = renderHook(() => useCallStageModel());
    expect(result.current.isGuestMode).toBe(true);
    expect(result.current.user?.username).toBe('Guest');
  });
});

describe('useCallStageModel: выбранный динамик из настроек', () => {
  it('применяет выбранный deviceId к зарегистрированным звуковым элементам на монтировании', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audiooutput', 'sink-1');
    const el = document.createElement('video') as HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    el.setSinkId = setSinkId;
    const { registerCallAudioElement } = await import('@/components/call/callAudioSinks');
    const unregister = registerCallAudioElement(el);
    const { result } = renderHook(() => useCallStageModel());
    expect(setSinkId).toHaveBeenCalledWith('sink-1');
    expect(() => result.current.applySinkId('device-1')).not.toThrow();
    unregister();
  });
});
