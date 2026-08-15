import { create } from 'zustand';
import { groupCallService } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';

export type CallStatus = 'idle' | 'joining' | 'connected' | 'reconnecting';

export interface JoinCallOptions {
  channelId: string;
  channelName: string;
  serverId: string | null;
  serverName: string | null;
  userId: string;
  userName: string;
}

interface CallState {
  callChannelId: string | null;
  callChannelName: string | null;
  callServerId: string | null;
  callServerName: string | null;
  status: CallStatus;
  isMuted: boolean;
  isVideoOff: boolean;
  isMicAvailable: boolean;
  isScreenSharing: boolean;

  join: (opts: JoinCallOptions) => Promise<void>;
  leave: () => void;
  /** Молчаливый сброс: обрыв связи, вытеснение сессии, исчерпанный реконнект. */
  reset: () => void;
  setStatus: (status: CallStatus) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

const IDLE = {
  callChannelId: null,
  callChannelName: null,
  callServerId: null,
  callServerName: null,
  status: 'idle' as CallStatus,
  isMuted: false,
  isVideoOff: true,
  isMicAvailable: true,
  isScreenSharing: false,
};

export const useCallStore = create<CallState>((set, get) => ({
  ...IDLE,

  join: async (opts) => {
    if (get().status === 'joining') return;
    // Уже активно в этой самой комнате (повторный клик по кнопке входа) — no-op.
    // Без этого гарда groupCallService.joinGroupCall упрётся в собственную
    // защиту «уже в звонке» и уронит ещё живой звонок через onError.
    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === opts.channelId) {
      return;
    }
    // Мид-реконнект: inCall кратковременно false, но currentRoomId уже указывает
    // на восстанавливаемую комнату — тогда повторный voice_joined слать не нужно.
    const alreadyInThisRoom = groupCallService.currentRoomIdState === opts.channelId;

    set({ status: 'joining' });

    let isFirst = false;
    try {
      isFirst = await groupCallService.joinGroupCall(opts.channelId, opts.userId);
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }

    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === opts.channelId) {
      wsService.send('voice_joined', { channel_id: opts.channelId });
      audioService.playUserJoined();
    }

    const micAvailable = groupCallService.isMicrophoneAvailable;
    set({
      status: 'connected',
      callChannelId: opts.channelId,
      callChannelName: opts.channelName,
      callServerId: opts.serverId,
      callServerName: opts.serverName,
      isMicAvailable: micAvailable,
      isMuted: !micAvailable,
    });
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});

    if (isFirst) {
      wsService.send('voice_call_ring', {
        channel_id: opts.channelId,
        server_id: opts.serverId,
        caller_id: opts.userId,
        caller_name: opts.userName,
        channel_name: opts.channelName,
      });
    }
  },

  leave: () => {
    const channelId = groupCallService.currentRoomIdState;
    if (groupCallService.isScreenSharing) {
      wsService.send('screen_share_stopped', {});
    }
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: get().callServerId,
      });
      wsService.send('voice_left', { channel_id: channelId });
      // Звучит только осознанный выход. Обрыв, session_replaced и исчерпанный
      // реконнект приходят в reset() и остаются молчаливыми.
      audioService.playUserLeft();
    }
    groupCallService.leaveGroupCall();
    set({ ...IDLE });
  },

  reset: () => set({ ...IDLE }),

  setStatus: (status) => set({ status }),

  toggleMute: () => set({ isMuted: groupCallService.toggleMuteAudio() }),

  toggleVideo: () => set({ isVideoOff: groupCallService.toggleMuteVideo() }),
}));
