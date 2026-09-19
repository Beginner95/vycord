import { create } from 'zustand';
import { ApiError } from '@/services/api';
import { guestApi, type GuestChatMessage, type GuestPreview } from '@/services/guestApi';
import {
  guestGateway,
  type GuestGatewayEvent,
  type GuestParticipantGuest,
  type GuestParticipantUser,
} from '@/services/guestGateway';
import { groupCallService } from '@/services/groupCall';
import { accountCallCredentials, setCallCredentials } from '@/services/callCredentials';
import { logger } from '@/utils/logger';

/**
 * Состояние гостя: от предпросмотра ссылки до конца звонка. Стор намеренно не
 * знает ни про authStore, ни про wsService — у гостя нет аккаунта, и весь его
 * реальный тайм идёт через guestGateway
 * (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 4).
 */

export type GuestPhase = 'entry' | 'resuming' | 'joining' | 'lobby' | 'connecting' | 'in_call' | 'ended';

export type GuestEndReason =
  | 'left'
  | 'kicked'
  | 'link_revoked'
  | 'guests_disabled'
  | 'call_ended'
  | 'rejected'
  | 'lobby_timeout'
  | 'disconnected'
  | 'session_expired';

export interface GuestRemote {
  userId: string;
  stream: MediaStream | null;
}

export interface GuestErrorInfo {
  code?: string;
  message: string;
}

interface GuestCallState {
  phase: GuestPhase;
  preview: GuestPreview | null;
  previewError: GuestErrorInfo | null;
  joinError: GuestErrorInfo | null;
  displayName: string;
  guestId: string | null;
  roomId: string | null;
  endReason: GuestEndReason | null;

  participants: { users: GuestParticipantUser[]; guests: GuestParticipantGuest[] };
  remotes: GuestRemote[];
  mutedPeers: Set<string>;
  sharingPeers: Set<string>;

  localStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isSharing: boolean;
  isMicAvailable: boolean;

  messages: GuestChatMessage[];
  chatUnread: number;

  loadPreview: (secret: string) => Promise<void>;
  /** Возвращает гостя в звонок после перезагрузки вкладки. false — сессии нет. */
  resume: () => boolean;
  join: (secret: string, displayName: string, opts: { muted: boolean; videoOff: boolean }) => Promise<void>;
  cancelLobby: () => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  sendChat: (text: string) => Promise<void>;
  markChatRead: () => void;
  reset: () => void;
}

const idle = () => ({
  phase: 'entry' as GuestPhase,
  preview: null,
  previewError: null,
  joinError: null,
  displayName: '',
  guestId: null,
  roomId: null,
  endReason: null,
  participants: { users: [], guests: [] },
  remotes: [],
  mutedPeers: new Set<string>(),
  sharingPeers: new Set<string>(),
  localStream: null,
  isMuted: false,
  isVideoOff: false,
  isSharing: false,
  isMicAvailable: true,
  messages: [],
  chatUnread: 0,
});

function errorInfo(err: unknown): GuestErrorInfo {
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message };
  }
  const anyErr = err as { code?: string; message?: string } | undefined;
  return { code: anyErr?.code, message: anyErr?.message ?? 'unknown error' };
}

let callbacksInstalled = false;

/**
 * Сессия гостя в sessionStorage: переживает перезагрузку вкладки, но не её
 * закрытие (спека, «Сессия гостя»). Секрет ссылки сюда не попадает — только
 * сессионный токен, который сервер гасит при любом финальном статусе.
 */
const SESSION_KEY = 'vycord.guestSession';

interface StoredGuestSession {
  token: string;
  guestId: string;
  displayName: string;
  isMuted: boolean;
  isVideoOff: boolean;
  preview: GuestPreview | null;
}

function saveSession(session: StoredGuestSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Хранилище недоступно (приватный режим, запрет сайта): звонок работает,
    // просто не переживёт перезагрузку.
  }
}

function patchSession(patch: Partial<StoredGuestSession>): void {
  const current = loadSession();
  if (current) saveSession({ ...current, ...patch });
}

function loadSession(): StoredGuestSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGuestSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.guestId !== 'string') return null;
    return {
      token: parsed.token,
      guestId: parsed.guestId,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      isMuted: Boolean(parsed.isMuted),
      isVideoOff: Boolean(parsed.isVideoOff),
      preview: parsed.preview ?? null,
    };
  } catch {
    return null;
  }
}

/** Есть ли во вкладке сессия гостя, которую можно вернуть после перезагрузки. */
export function hasStoredGuestSession(): boolean {
  return loadSession() !== null;
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // см. saveSession
  }
}

export const useGuestCallStore = create<GuestCallState>((set, get) => ({
  ...idle(),

  loadPreview: async (secret) => {
    try {
      const preview = await guestApi.preview(secret);
      set({ preview, previewError: null });
    } catch (err) {
      set({ preview: null, previewError: errorInfo(err) });
    }
  },

  resume: () => {
    const session = loadSession();
    if (!session) return false;

    set({
      ...idle(),
      phase: 'resuming',
      guestId: session.guestId,
      displayName: session.displayName,
      isMuted: session.isMuted,
      isVideoOff: session.isVideoOff,
      preview: session.preview,
    });

    guestApi.setSessionToken(session.token);
    installCallbacks(set, get);
    setCallCredentials(guestApi.credentials());
    // Дальше всё решает шлюз: admitted → обратно в звонок, lobby_waiting →
    // в лобби, session_invalid → сессия уже мертва.
    guestGateway.connect(session.token, (event) => handleEvent(event, set, get));
    return true;
  },

  join: async (secret, displayName, opts) => {
    if (get().phase === 'joining' || get().phase === 'lobby') return;
    set({ phase: 'joining', joinError: null });

    let joined;
    try {
      joined = await guestApi.join(secret, displayName);
    } catch (err) {
      set({ phase: 'entry', joinError: errorInfo(err) });
      return;
    }

    set({
      phase: 'lobby',
      guestId: joined.guest_id,
      displayName: joined.display_name,
      isMuted: opts.muted,
      isVideoOff: opts.videoOff,
    });
    saveSession({
      token: joined.session_token,
      guestId: joined.guest_id,
      displayName: joined.display_name,
      isMuted: opts.muted,
      isVideoOff: opts.videoOff,
      preview: get().preview,
    });

    installCallbacks(set, get);
    // Гость ходит в SFU по своим кредам — их ставит шов, а groupCall о госте
    // ничего не знает.
    setCallCredentials(guestApi.credentials());
    guestGateway.connect(joined.session_token, (event) => handleEvent(event, set, get));
  },

  cancelLobby: async () => {
    try {
      await guestApi.leave();
    } catch (err) {
      logger.report('[guest] leave request failed', {}, { error: String(err) });
    }
    clearSession();
    teardown();
    set({ ...idle(), phase: 'entry' });
  },

  leave: async () => {
    try {
      await guestApi.leave();
    } catch (err) {
      logger.report('[guest] leave request failed', {}, { error: String(err) });
    }
    groupCallService.leaveGroupCall();
    clearSession();
    teardown();
    set({ phase: 'ended', endReason: 'left', remotes: [], localStream: null });
  },

  toggleMute: () => {
    const isMuted = groupCallService.toggleMuteAudio();
    set({ isMuted });
    patchSession({ isMuted });
  },

  toggleVideo: () => {
    const isVideoOff = groupCallService.toggleMuteVideo();
    set({ isVideoOff });
    patchSession({ isVideoOff });
  },

  sendChat: async (text) => {
    const content = text.trim();
    if (!content) return;
    await guestApi.sendMessage(content);
  },

  markChatRead: () => set({ chatUnread: 0 }),

  // Сессию из sessionStorage reset не трогает: он же срабатывает при
  // размонтировании страницы (и дважды в StrictMode), а перезагрузка должна
  // её найти.
  reset: () => {
    teardown();
    set(idle());
  },
}));

function teardown(): void {
  guestGateway.disconnect();
  guestApi.setSessionToken(null);
  setCallCredentials(accountCallCredentials);
}

type Setter = (partial: Partial<GuestCallState> | ((s: GuestCallState) => Partial<GuestCallState>)) => void;
type Getter = () => GuestCallState;

/** Колбэки звонка ставятся один раз: groupCallService — синглтон. */
function installCallbacks(set: Setter, get: Getter): void {
  if (callbacksInstalled) return;
  callbacksInstalled = true;

  groupCallService.init({
    onRemoteStream: (userId, stream) => {
      set((s) => {
        const known = s.remotes.find((r) => r.userId === userId);
        return known
          ? { remotes: s.remotes.map((r) => (r.userId === userId ? { ...r, stream } : r)) }
          : { remotes: [...s.remotes, { userId, stream }] };
      });
    },
    onRemoteScreenStream: () => {
      // Просмотр чужой демонстрации гостю в первой версии не нужен: он видит
      // её как обычное видео участника, отдельной подписки нет.
    },
    onPeerJoined: (userId) => {
      set((s) =>
        s.remotes.find((r) => r.userId === userId)
          ? {}
          : { remotes: [...s.remotes, { userId, stream: null }] },
      );
    },
    onPeerLeft: (userId) => {
      set((s) => ({ remotes: s.remotes.filter((r) => r.userId !== userId) }));
    },
    onPeerSnapshot: (userIds) => {
      set((s) => {
        const ids = new Set(userIds);
        const kept = s.remotes.filter((r) => ids.has(r.userId));
        const keptIds = new Set(kept.map((r) => r.userId));
        const added = userIds.filter((id) => !keptIds.has(id)).map((id) => ({ userId: id, stream: null }));
        return { remotes: [...kept, ...added] };
      });
    },
    onCallEnded: () => {
      if (get().phase === 'ended') return;
      set({ phase: 'ended', endReason: 'disconnected', remotes: [] });
    },
    onError: (error) => {
      logger.report('[guest] call error', {}, { error: String(error) });
    },
  });
}

function handleEvent(event: GuestGatewayEvent, set: Setter, get: Getter): void {
  switch (event.type) {
    case 'lobby_waiting':
      if (get().phase === 'joining' || get().phase === 'resuming') set({ phase: 'lobby' });
      return;

    case 'admitted':
      void enterCall(event.room_id, set, get);
      return;

    case 'participants':
      set({ participants: { users: event.users, guests: event.guests } });
      return;

    case 'peer_signal': {
      if (event.signal === 'mic_muted' || event.signal === 'mic_unmuted') {
        set((s) => {
          const next = new Set(s.mutedPeers);
          if (event.signal === 'mic_muted') next.add(event.userId);
          else next.delete(event.userId);
          return { mutedPeers: next };
        });
      }
      if (event.signal === 'screen_share_started' || event.signal === 'screen_share_stopped') {
        set((s) => {
          const next = new Set(s.sharingPeers);
          if (event.signal === 'screen_share_started') next.add(event.userId);
          else next.delete(event.userId);
          return { sharingPeers: next };
        });
      }
      return;
    }

    case 'chat_message':
      set((s) =>
        s.messages.some((m) => m.id === event.message.id)
          ? {}
          : { messages: [...s.messages, event.message], chatUnread: s.chatUnread + 1 },
      );
      return;

    case 'message_delete':
      set((s) => ({ messages: s.messages.filter((m) => m.id !== event.id) }));
      return;

    case 'rejected':
      endCall('rejected', set, get);
      return;
    case 'lobby_timeout':
      endCall('lobby_timeout', set, get);
      return;
    case 'call_ended':
      endCall('call_ended', set, get);
      return;
    case 'kicked':
      endCall(event.reason === 'link_revoked' ? 'link_revoked'
        : event.reason === 'guests_disabled' ? 'guests_disabled'
        : 'kicked', set, get);
      return;

    case 'session_invalid':
      endCall('session_expired', set, get);
      return;

    case 'closed':
      // Обрыв — не выход: шлюз переподключается сам, гость остаётся в звонке.
      return;
  }
}

async function enterCall(roomId: string, set: Setter, get: Getter): Promise<void> {
  if (get().phase === 'in_call' || get().phase === 'connecting') return;
  const guestId = get().guestId;
  if (!guestId) return;

  set({ phase: 'connecting', roomId });
  try {
    await groupCallService.joinGroupCall(roomId, `guest:${guestId}`);
  } catch (err) {
    logger.report('[guest] failed to join the call', {}, { error: String(err) });
    set({ phase: 'ended', endReason: 'disconnected' });
    return;
  }

  // groupCall отдаёт звонок с живым микрофоном и намеренно погашенной камерой
  // (см. doJoinGroupCall: «video starts disabled»). Гость же выбрал состояние
  // устройств в предпросмотре — приводим дорожки к этому выбору. Без сверки
  // выключенный в предпросмотре микрофон продолжал вещать, а кнопка камеры
  // показывала «включено» при выключённом треке.
  const local = groupCallService.localStreamState ?? null;
  const micAvailable = groupCallService.isMicrophoneAvailable;
  const wantMuted = !micAvailable || get().isMuted;
  const hasCamera = (local?.getVideoTracks().length ?? 0) > 0;

  const isMuted = wantMuted && micAvailable ? groupCallService.toggleMuteAudio() : wantMuted;
  const isVideoOff = get().isVideoOff || !hasCamera ? true : groupCallService.toggleMuteVideo();

  set({
    phase: 'in_call',
    isMicAvailable: micAvailable,
    isMuted,
    isVideoOff,
    localStream: local,
  });

  // История чата с момента впуска: события шлюза приносят только новые.
  try {
    const history = await guestApi.messages();
    set({ messages: history, chatUnread: 0 });
  } catch (err) {
    logger.report('[guest] failed to load the chat window', {}, { error: String(err) });
  }
}

function endCall(reason: GuestEndReason, set: Setter, get: Getter): void {
  if (get().phase === 'ended') return;
  clearSession();
  groupCallService.leaveGroupCall();
  teardown();
  set({ phase: 'ended', endReason: reason, remotes: [], localStream: null });
}
