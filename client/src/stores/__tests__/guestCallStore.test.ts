// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayHandlers: { onEvent?: (e: unknown) => void } = {};

vi.mock('@/services/guestApi', () => ({
  guestApi: {
    setSessionToken: vi.fn(),
    sessionToken: vi.fn(() => 'sess'),
    preview: vi.fn(),
    join: vi.fn(),
    voiceToken: vi.fn(),
    iceServers: vi.fn(),
    messages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    credentials: vi.fn(() => ({ getVoiceToken: vi.fn(), getIceServers: vi.fn() })),
  },
}));

vi.mock('@/services/guestGateway', () => ({
  guestGateway: {
    connect: vi.fn((_token: string, onEvent: (e: unknown) => void) => {
      gatewayHandlers.onEvent = onEvent;
    }),
    disconnect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock('@/services/callBus', () => ({
  callBus: { send: vi.fn(), on: vi.fn(() => () => {}) },
  setCallTransport: vi.fn(),
}));

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    init: vi.fn(),
    joinGroupCall: vi.fn(async () => true),
    leaveGroupCall: vi.fn(),
    toggleMuteAudio: vi.fn(() => true),
    toggleMuteVideo: vi.fn(() => true),
    get isMicrophoneAvailable() {
      return true;
    },
    get localStreamState() {
      return null;
    },
  },
}));

vi.mock('@/services/callCredentials', () => ({
  setCallCredentials: vi.fn(),
  accountCallCredentials: {},
}));

import { guestApi } from '@/services/guestApi';
import { guestGateway } from '@/services/guestGateway';
import { groupCallService } from '@/services/groupCall';
import { callBus, setCallTransport } from '@/services/callBus';
import { useCallStore } from '../callStore';
import { useGuestCallStore } from '../guestCallStore';

const emit = (event: unknown) => gatewayHandlers.onEvent?.(event);

beforeEach(() => {
  sessionStorage.clear();
  useGuestCallStore.getState().reset();
  useCallStore.getState().reset();
  vi.clearAllMocks();
});

afterEach(() => {
  useGuestCallStore.getState().reset();
});

describe('guestCallStore', () => {
  it('loads a preview', async () => {
    vi.mocked(guestApi.preview).mockResolvedValue({
      server_name: 'Вебваха', channel_name: 'общий', participant_count: 2,
    });

    await useGuestCallStore.getState().loadPreview('secret');

    expect(useGuestCallStore.getState().preview?.server_name).toBe('Вебваха');
    expect(useGuestCallStore.getState().previewError).toBeNull();
  });

  it('keeps the error code when the link is dead', async () => {
    vi.mocked(guestApi.preview).mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'ApiError', code: 'guest_link_revoked' }),
    );

    await useGuestCallStore.getState().loadPreview('secret');

    expect(useGuestCallStore.getState().previewError?.code).toBe('guest_link_revoked');
  });

  it('goes to the lobby after joining and into the call once admitted', async () => {
    vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });

    await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: true });
    expect(useGuestCallStore.getState().phase).toBe('lobby');
    expect(useGuestCallStore.getState().displayName).toBe('Вася');

    emit({ type: 'admitted', room_id: 'room-1' });
    await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));
    expect(groupCallService.joinGroupCall).toHaveBeenCalledWith('room-1', 'guest:g1');
  });

  it('ends with the reason the gateway gave', async () => {
    vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
    await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: false });

    emit({ type: 'kicked', reason: 'link_revoked' });

    expect(useGuestCallStore.getState().phase).toBe('ended');
    expect(useGuestCallStore.getState().endReason).toBe('link_revoked');
    expect(groupCallService.leaveGroupCall).toHaveBeenCalled();
  });

  it('tracks participants and chat', async () => {
    vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
    await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: false });

    emit({ type: 'participants', users: [{ user_id: 'u1', username: 'аня' }], guests: [{ id: 'guest:g1', display_name: 'Вася' }] });
    expect(useGuestCallStore.getState().participants.users).toHaveLength(1);
    expect(useGuestCallStore.getState().participants.guests).toHaveLength(1);
    // Имена для сцены звонка: /users/{id} гостю недоступен.
    expect(useCallStore.getState().directory['u1']).toMatchObject({ username: 'аня', isGuest: false });
    expect(useCallStore.getState().directory['guest:g1']).toMatchObject({ username: 'Вася', isGuest: true });

    emit({
      type: 'chat_message',
      message: { id: 'm1', content: 'привет', created_at: '2026-09-17T00:00:00Z', author: { kind: 'user', username: 'аня' } },
    });
    expect(useGuestCallStore.getState().messages).toHaveLength(1);
    expect(useGuestCallStore.getState().chatUnread).toBe(1);

    emit({ type: 'message_delete', id: 'm1' });
    expect(useGuestCallStore.getState().messages).toHaveLength(0);
  });

  it('leaving tells the server and tears the call down', async () => {
    vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
    await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: false });

    await useGuestCallStore.getState().leave();

    expect(guestApi.leave).toHaveBeenCalled();
    expect(groupCallService.leaveGroupCall).toHaveBeenCalled();
    expect(useGuestCallStore.getState().phase).toBe('ended');
    expect(useGuestCallStore.getState().endReason).toBe('left');
  });

  describe('surviving a page reload', () => {
    const joinAs = async () => {
      vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
      await useGuestCallStore.getState().join('secret', 'Вася', { muted: true, videoOff: true });
    };

    it('has nothing to resume before a join', () => {
      expect(useGuestCallStore.getState().resume()).toBe(false);
      expect(guestGateway.connect).not.toHaveBeenCalled();
    });

    it('reconnects with the stored session and returns to the call', async () => {
      await joinAs();
      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));

      // Перезагрузка: модульное состояние теряется, sessionStorage — нет.
      useGuestCallStore.getState().reset();
      vi.clearAllMocks();

      expect(useGuestCallStore.getState().resume()).toBe(true);
      expect(useGuestCallStore.getState().phase).toBe('resuming');
      expect(guestApi.setSessionToken).toHaveBeenCalledWith('tok');
      expect(guestGateway.connect).toHaveBeenCalledWith('tok', expect.any(Function));
      expect(useGuestCallStore.getState().displayName).toBe('Вася');

      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));
      expect(groupCallService.joinGroupCall).toHaveBeenCalledWith('room-1', 'guest:g1');
    });

    it('goes back to the lobby when the guest was still waiting', async () => {
      await joinAs();
      useGuestCallStore.getState().reset();

      useGuestCallStore.getState().resume();
      emit({ type: 'lobby_waiting' });

      expect(useGuestCallStore.getState().phase).toBe('lobby');
    });

    it('forgets the session once the guest has left', async () => {
      await joinAs();
      await useGuestCallStore.getState().leave();
      useGuestCallStore.getState().reset();

      expect(useGuestCallStore.getState().resume()).toBe(false);
    });

    it('forgets the session when the call is over for the guest', async () => {
      await joinAs();
      emit({ type: 'kicked', reason: 'kicked' });
      useGuestCallStore.getState().reset();

      expect(useGuestCallStore.getState().resume()).toBe(false);
    });

    it('ends and forgets a session the server no longer accepts', async () => {
      await joinAs();
      useGuestCallStore.getState().reset();
      useGuestCallStore.getState().resume();

      emit({ type: 'session_invalid' });

      expect(useGuestCallStore.getState().phase).toBe('ended');
      expect(useGuestCallStore.getState().endReason).toBe('session_expired');
      useGuestCallStore.getState().reset();
      expect(useGuestCallStore.getState().resume()).toBe(false);
    });
  });

  describe('the call itself runs on the shared callStore', () => {
    it('enters through callStore as guest:<id>, over the guest transport', async () => {
      vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
      await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: true });
      expect(setCallTransport).toHaveBeenCalledWith('guest');

      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));

      const call = useCallStore.getState();
      expect(call.callChannelId).toBe('room-1');
      expect(call.guestSelf).toEqual({ id: 'guest:g1', username: 'Вася' });
      expect(groupCallService.joinGroupCall).toHaveBeenCalledWith('room-1', 'guest:g1');
    });

    it('applies the mic choice from the preview and tells the others', async () => {
      vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
      await useGuestCallStore.getState().join('secret', 'Вася', { muted: true, videoOff: true });

      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));

      expect(groupCallService.toggleMuteAudio).toHaveBeenCalled();
      expect(useCallStore.getState().isMuted).toBe(true);
      expect(callBus.send).toHaveBeenCalledWith('mic_muted');
    });

    // VYC-96: кадры, отправленные в закрытый сокет шлюза, потеряны — после
    // переподключения (сервер снова шлёт admitted) гость объявляет мик и камеру.
    it('re-announces mic and camera after the gateway reconnects mid-call', async () => {
      vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
      await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: true });
      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));
      vi.mocked(callBus.send).mockClear();

      emit({ type: 'closed' });
      emit({ type: 'admitted', room_id: 'room-1' });

      const types = vi.mocked(callBus.send).mock.calls.map(([type]) => type);
      expect(types).toEqual(['mic_unmuted', 'camera_off']);
      expect(groupCallService.joinGroupCall).toHaveBeenCalledTimes(1);
    });

    it('treats a call dropped under it as a lost connection', async () => {
      vi.mocked(guestApi.join).mockResolvedValue({ guest_id: 'g1', session_token: 'tok', display_name: 'Вася' });
      await useGuestCallStore.getState().join('secret', 'Вася', { muted: false, videoOff: true });
      emit({ type: 'admitted', room_id: 'room-1' });
      await vi.waitFor(() => expect(useGuestCallStore.getState().phase).toBe('in_call'));

      useCallStore.getState().reset(); // так мост сбрасывает звонок на onCallEnded/onError

      expect(useGuestCallStore.getState().phase).toBe('ended');
      expect(useGuestCallStore.getState().endReason).toBe('disconnected');
      expect(setCallTransport).toHaveBeenLastCalledWith('account');
    });
  });
});
