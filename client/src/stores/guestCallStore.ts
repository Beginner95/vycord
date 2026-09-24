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
import { callBus, setCallTransport } from '@/services/callBus';
import { announceLocalCallState, initCallBridge, useCallStore, type CallDirectoryEntry } from '@/stores/callStore';
import { logger } from '@/utils/logger';

/**
 * Жизненный цикл гостя: от предпросмотра ссылки до конца звонка. Сам звонок —
 * медиа, участники, демонстрация, качество — живёт в общем callStore, как у
 * участника с аккаунтом; гость отличается только транспортом (callBus →
 * гостевой шлюз), кредами SFU и тем, откуда берутся имена
 * (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 4,
 * «Швы в существующем коде звонка»).
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
  /** Выбор в предпросмотре: применяется к звонку при входе и после перезагрузки. */
  wantMuted: boolean;
  wantVideoOff: boolean;

  messages: GuestChatMessage[];
  chatUnread: number;

  loadPreview: (secret: string) => Promise<void>;
  /** Возвращает гостя в звонок после перезагрузки вкладки. false — сессии нет. */
  resume: () => boolean;
  join: (secret: string, displayName: string, opts: { muted: boolean; videoOff: boolean }) => Promise<void>;
  cancelLobby: () => Promise<void>;
  leave: () => Promise<void>;
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
  wantMuted: false,
  wantVideoOff: false,
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
      wantMuted: session.isMuted,
      wantVideoOff: session.isVideoOff,
      preview: session.preview,
    });

    guestApi.setSessionToken(session.token);
    connectGateway(session.token, set, get);
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
      wantMuted: opts.muted,
      wantVideoOff: opts.videoOff,
    });
    saveSession({
      token: joined.session_token,
      guestId: joined.guest_id,
      displayName: joined.display_name,
      isMuted: opts.muted,
      isVideoOff: opts.videoOff,
      preview: get().preview,
    });

    connectGateway(joined.session_token, set, get);
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
    // Фаза — первой: подписка на callStore ниже не должна принять
    // собственный выход за обрыв.
    set({ phase: 'ended', endReason: 'left' });
    clearSession();
    try {
      await guestApi.leave();
    } catch (err) {
      logger.report('[guest] leave request failed', {}, { error: String(err) });
    }
    useCallStore.getState().leave();
    teardown();
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

type Setter = (partial: Partial<GuestCallState> | ((s: GuestCallState) => Partial<GuestCallState>)) => void;
type Getter = () => GuestCallState;

function connectGateway(token: string, set: Setter, get: Getter): void {
  installCallWatch(set, get);
  // Гость ходит в SFU по своим кредам и шлёт события звонка в свой шлюз —
  // оба шва ставятся здесь, callStore и groupCall о госте ничего не знают.
  setCallCredentials(guestApi.credentials());
  setCallTransport('guest');
  initCallBridge();
  // Дальше всё решает шлюз: admitted → в звонок, lobby_waiting → в лобби,
  // session_invalid → сессия уже мертва.
  guestGateway.connect(token, (event) => handleEvent(event, set, get));
}

function teardown(): void {
  guestGateway.disconnect();
  guestApi.setSessionToken(null);
  setCallCredentials(accountCallCredentials);
  setCallTransport('account');
}

let callWatchInstalled = false;

/**
 * Звонок может кончиться и без шлюза: SFU выгнал, реконнект исчерпан, ошибка
 * медиа — тогда мост сбрасывает callStore. Гостю это «связь потеряна», а
 * мик и камеру, которые он переключает прямо в сцене, помним для перезагрузки.
 */
function installCallWatch(set: Setter, get: Getter): void {
  if (callWatchInstalled) return;
  callWatchInstalled = true;

  useCallStore.subscribe((call, prev) => {
    const phase = get().phase;
    if (phase !== 'in_call') return;
    if (prev.callChannelId !== null && call.callChannelId === null) {
      set({ phase: 'ended', endReason: 'disconnected' });
      teardown();
      return;
    }
    if (call.isMuted !== prev.isMuted || call.isVideoOff !== prev.isVideoOff) {
      set({ wantMuted: call.isMuted, wantVideoOff: call.isVideoOff });
      patchSession({ isMuted: call.isMuted, isVideoOff: call.isVideoOff });
    }
  });
}

function directoryFrom(participants: GuestCallState['participants']): Record<string, CallDirectoryEntry> {
  const out: Record<string, CallDirectoryEntry> = {};
  participants.users.forEach((user) => {
    out[user.user_id] = { username: user.username ?? user.user_id.slice(0, 8), avatar_url: user.avatar_url, isGuest: false };
  });
  participants.guests.forEach((guest) => {
    out[guest.id] = { username: guest.display_name, isGuest: true };
  });
  return out;
}

function handleEvent(event: GuestGatewayEvent, set: Setter, get: Getter): void {
  switch (event.type) {
    case 'lobby_waiting':
      if (get().phase === 'joining' || get().phase === 'resuming') set({ phase: 'lobby' });
      return;

    case 'admitted':
      // Шлюз присылает admitted на каждое подключение. Уже в звонке — значит,
      // шлюз переподключился: кадры mic/camera, отправленные в закрытый сокет,
      // потеряны, объявляем текущее состояние заново (один раз на подключение).
      if (get().phase === 'in_call') {
        announceLocalCallState();
        return;
      }
      void enterCall(event.room_id, set, get);
      return;

    case 'participants': {
      const participants = { users: event.users, guests: event.guests };
      set({ participants });
      useCallStore.setState({ directory: directoryFrom(participants) });
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

    case 'peer_signal':
      // mic/демонстрация/качество участников обрабатывает мост callStore:
      // он слушает те же кадры шлюза через callBus.
      return;

    case 'closed':
      // Обрыв — не выход: шлюз переподключается сам, гость остаётся в звонке.
      return;
  }
}

async function enterCall(roomId: string, set: Setter, get: Getter): Promise<void> {
  const phase = get().phase;
  if (phase === 'in_call' || phase === 'connecting' || phase === 'ended') return;
  const guestId = get().guestId;
  if (!guestId) return;

  set({ phase: 'connecting', roomId });
  const selfId = `guest:${guestId}`;
  const { preview, displayName } = get();
  useCallStore.setState({
    guestSelf: { id: selfId, username: displayName },
    directory: directoryFrom(get().participants),
  });

  try {
    await useCallStore.getState().join({
      channelId: roomId,
      channelName: preview?.channel_name ?? '',
      serverId: null,
      serverName: preview?.server_name ?? null,
      userId: selfId,
      userName: displayName,
    });
  } catch (err) {
    logger.report('[guest] failed to join the call', {}, { error: String(err) });
    endCall('disconnected', set, get);
    return;
  }
  if (get().phase !== 'connecting') return; // пока входили, гостя выгнали

  // callStore.join отдаёт звонок с живым микрофоном и погашенной камерой.
  // Гость же выбрал устройства в предпросмотре (или до перезагрузки) —
  // приводим дорожки к этому выбору и сообщаем участникам про мик.
  const call = useCallStore.getState();
  if (get().wantMuted && call.isMicAvailable && !call.isMuted) {
    const muted = groupCallService.toggleMuteAudio();
    useCallStore.setState({ isMuted: muted });
    callBus.send(muted ? 'mic_muted' : 'mic_unmuted');
  }
  const hasCamera = (groupCallService.localStreamState?.getVideoTracks().length ?? 0) > 0;
  if (!get().wantVideoOff && hasCamera && useCallStore.getState().isVideoOff) {
    useCallStore.setState({ isVideoOff: groupCallService.toggleMuteVideo() });
  }

  set({ phase: 'in_call' });

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
  set({ phase: 'ended', endReason: reason });
  clearSession();
  groupCallService.leaveGroupCall();
  useCallStore.getState().reset();
  teardown();
}
