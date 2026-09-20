import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { useCallStore, initCallBridge } from '@/stores/callStore';
import { useFriendStore, initFriendBridge } from '@/stores/friendStore';
import { useCallRing, type CallNotif } from './useCallRing';
import { useVoiceParticipants } from './useVoiceParticipants';
import type { Server, Channel, Message, MemberWithUser, User } from '@/types';

export type AppNavEvent =
  | { type: 'serverOpened'; serverId: string }
  | { type: 'callJoined'; serverId: string | null; channelId: string };

export interface AppControllerOptions {
  autoOpenChannel: boolean; // десктоп: true
}

export interface AppController {
  user: User | null;
  servers: Server[]; currentServer: Server | null;
  channels: Channel[]; currentChannel: Channel | null;
  members: MemberWithUser[];
  pendingCount: number;
  voiceParticipants: Map<string, string[]>;
  callNotif: CallNotif | null;
  selectServer(server: Server): Promise<void>;
  selectChannel(channel: Channel): Promise<void>;
  selectHome(): void;
  joinVoice(channel: Channel): void;
  goToCall(serverId: string | null, channelId: string): void;
  serverRemoved(id: string): void;
  channelRemoved(id: string): void;
  joinServer(server: Server): Promise<void>;
  serverJoined(server: Server): void;
  createServer(name: string, isPrivate: boolean): Promise<void>; // бросает ApiError
  joinCallNotif(): void;
  dismissCallNotif(): void;
  logout(): void;
  subscribe(listener: (e: AppNavEvent) => void): () => void;
  ui: {
    findServerOpen: boolean; setFindServerOpen(v: boolean): void;
    settingsOpen: boolean; setSettingsOpen(v: boolean): void;
    createChannelOpen: boolean; setCreateChannelOpen(v: boolean): void;
    createServerOpen: boolean; setCreateServerOpen(v: boolean): void;
  };
}

export function useAppController(opts: AppControllerOptions): AppController {
  const { user, accessToken, logout } = useAuthStore();
  const { servers, setServers, setServersLoaded, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel, setMembers, members, setPermissions } = useServerStore();
  const { setMessages } = useMessageStore();
  const pendingCount = useFriendStore((s) => s.incoming.length);
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [findServerOpen, setFindServerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);

  const ring = useCallRing(currentServer?.id ?? null, user?.id ?? null);
  const voiceParticipants = useVoiceParticipants();

  const handledRemovalsRef = useRef<Set<string>>(new Set());

  const listenersRef = useRef(new Set<(e: AppNavEvent) => void>());
  const emit = (e: AppNavEvent) => listenersRef.current.forEach((l) => l(e));
  const subscribe = (l: (e: AppNavEvent) => void) => {
    listenersRef.current.add(l);
    return () => { listenersRef.current.delete(l); };
  };

  // Reconnect WebSocket on mount if already authenticated (page reload).
  // Токен мог протухнуть, пока приложение было закрыто — getFreshAccessToken()
  // обновит его перед подключением вместо того, чтобы предъявить SFU/hub
  // мёртвый JWT.
  useEffect(() => {
    if (!wsService.connected) {
      apiService.getFreshAccessToken().then((freshToken) => {
        if (freshToken) {
          wsService.connect(freshToken).catch((err) => {
            logger.error('Failed to reconnect WebSocket:', err, { module: 'app' });
          });
        }
      });
    }
  }, [accessToken]);

  useEffect(() => {
    // Load servers
    loadServers();
  }, []);

  // Подписка на groupCallService живёт в модуле стора, а не в компоненте сцены
  // звонка: сцена размонтируется при уходе в другой канал, а обработка входящих
  // стримов, реконнекта и метрик обязана это пережить. initCallBridge()
  // идемпотентна — повторные вызовы (StrictMode, ремаунт) ничего не делают.
  useEffect(() => {
    initCallBridge();
  }, []);

  // initFriendBridge живёт всё время сессии, а не только пока открыт "Дом" —
  // иначе WS-события друзей (новая заявка, бейдж) пропадают, пока пользователь
  // смотрит любой сервер. Тот же приём, что уже применён к initCallBridge выше.
  useEffect(() => initFriendBridge(), []);

  useEffect(() => {
    void useFriendStore.getState().load();
  }, []);

  useEffect(() => {
    // Listen for incoming messages via WebSocket
    const unsubscribe = wsService.on('chat_message', (payload) => {
      const msg = payload as Message;
      if (currentChannel && msg.channel_id === currentChannel.id) {
        // Own messages are added optimistically via HTTP response in ChatArea — skip to avoid duplicates.
        // Call placards are the exception: the client never adds them optimistically
        // (there's no client-initiated send for a call start), even when user_id is
        // the current user because they're the one who started the call — so this
        // guard must not swallow them, or the starter never sees their own call
        // placard live (and the later message_update on call-end has nothing to
        // update, since the row was never added).
        if (user && msg.user_id === user.id && msg.kind !== 'call') return;
        // Spread, don't re-pick fields: the broadcast carries the same
        // domain.Message the REST read does — attachments (already signed
        // server-side) and sticker included. Rebuilding the object by hand
        // dropped them, so an incoming image or sticker stayed invisible
        // until a reload refetched the message over HTTP.
        useMessageStore.getState().addMessage({
          ...msg,
          updated_at: msg.updated_at || msg.created_at,
        });
      }
    });

    return () => unsubscribe();
  }, [currentChannel, user]);

  useEffect(() => {
    const unsubscribe = wsService.on('user_updated', (payload) => {
      const p = payload as { id: string; avatar_url: string | null };
      if (p.id === useAuthStore.getState().user?.id) {
        useAuthStore.getState().updateUser({ avatar_url: p.avatar_url ?? undefined });
      }
      useServerStore.getState().patchMemberAvatar(p.id, p.avatar_url);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubServerUpdate = wsService.on('server_update', (payload) => {
      const p = payload as Server;
      useServerStore.getState().patchServer(p.id, { name: p.name, icon_url: p.icon_url, is_private: p.is_private });
    });
    const unsubChannelUpdate = wsService.on('channel_update', (payload) => {
      const p = payload as Channel;
      useServerStore.getState().patchChannel(p.id, { name: p.name });
    });
    const unsubChannelCreate = wsService.on('channel_create', (payload) => {
      const p = payload as Channel;
      // channel_create для публичного канала рассылается всем подключённым
      // клиентам, поэтому фильтруем по текущему серверу: иначе канал чужого
      // сервера всплывает в открытом сайдбаре до перехода туда-обратно.
      if (p.server_id !== useServerStore.getState().currentServer?.id) return;
      useServerStore.getState().addChannel(p);
    });
    const unsubServerDelete = wsService.on('server_delete', (payload) => {
      const { id } = payload as { id: string };
      useServerStore.getState().removeServer(id);
      handleServerRemoved(id);
    });
    const unsubChannelDelete = wsService.on('channel_delete', (payload) => {
      const { id } = payload as { id: string; server_id: string };
      useServerStore.getState().removeChannel(id);
      handleChannelRemoved(id);
    });
    return () => {
      unsubServerUpdate();
      unsubChannelUpdate();
      unsubChannelCreate();
      unsubServerDelete();
      unsubChannelDelete();
    };
  }, [currentServer, currentChannel, channels]);

  const loadServerMembers = (serverId: string) => {
    apiService.getServerMembers(serverId)
      .then((members) => setMembers(members as MemberWithUser[]))
      .catch((err) => logger.error('Failed to load server members:', err, { module: 'app' }));
  };

  const loadServerPermissions = (serverId: string) => {
    apiService
      .getMyPermissions(serverId)
      .then((res) =>
        setPermissions(serverId, {
          isOwner: res.is_owner,
          bits: BigInt(res.permissions),
          highestPosition: res.highest_position,
        })
      )
      .catch((err) => console.error('Failed to load server permissions:', err));
  };

  const callLeaveGroupCall = () => useCallStore.getState().leave();

  const handleJoinVoice = (channel: Channel) => {
    if (!user) return;
    const server = useServerStore.getState().currentServer;
    void useCallStore.getState().join({
      channelId: channel.id,
      channelName: channel.name,
      serverId: server?.id ?? null,
      serverName: server?.name ?? null,
      userId: user.id,
      userName: user.username,
    });
  };

  const handleServerRemoved = (removedServerId: string) => {
    if (handledRemovalsRef.current.has(removedServerId)) return;
    handledRemovalsRef.current.add(removedServerId);

    // Звонок больше не привязан к навигации: сервер со звонком может быть
    // удалён, пока мы смотрим другой сервер. Сервер шлёт один server_delete
    // без каскадных channel_delete, поэтому звонок нужно проверить и
    // завершить здесь — ДО раннего выхода по «смотрю другой сервер» — иначе
    // он повиснет без канала, к которому уже нет доступа. callServerId из
    // useCallStore — источник правды о том, в каком сервере идёт звонок,
    // независимо от того, какой сервер сейчас открыт в UI.
    if (useCallStore.getState().callServerId === removedServerId) {
      callLeaveGroupCall();
    }

    if (currentServer?.id !== removedServerId) return;

    const remaining = useServerStore.getState().servers;
    if (remaining.length > 0) {
      handleSelectServer(remaining[0]);
    } else {
      setCurrentServer(null);
      setChannels([]);
      setCurrentChannel(null);
      setMembers([]);
      setMessages([]);
    }
  };

  const handleChannelRemoved = (removedChannelId: string) => {
    if (handledRemovalsRef.current.has(removedChannelId)) return;
    handledRemovalsRef.current.add(removedChannelId);

    // Звонок и открытый канал независимы: удаление может задеть один, оба или ни одного.
    if (useCallStore.getState().callChannelId === removedChannelId) {
      callLeaveGroupCall();
    }

    if (currentChannel?.id !== removedChannelId) return;

    const remaining = useServerStore.getState().channels;
    const nextChannel = remaining[0];
    if (nextChannel) {
      handleSelectChannel(nextChannel);
    } else {
      setCurrentChannel(null);
      setMessages([]);
    }
  };

  const loadServers = async () => {
    try {
      type UserWithLastVisited = { last_server_id?: string; last_channel_id?: string };
      const [data, me] = await Promise.all([
        apiService.getServers() as Promise<Server[]>,
        apiService.getMe() as Promise<UserWithLastVisited>,
      ]);

      setServers(data);
      if (data.length === 0) return;

      // Загружаем права для всех серверов сразу, чтобы контекстное меню
      // («Пригласить», редактирование) работало без предварительного входа
      // в сервер после обновления страницы.
      data.forEach((s) => loadServerPermissions(s.id));

      const lastServerId = me?.last_server_id;
      const lastChannelId = me?.last_channel_id;

      if (lastServerId) {
        const server = data.find((s) => s.id === lastServerId);
        if (server) {
          setCurrentServer(server);
          setMembers([]);
          const channelsData = await apiService.getChannels(server.id) as Channel[];
          setChannels(channelsData);
          loadServerMembers(server.id);
          loadServerPermissions(server.id);

          if (lastChannelId) {
            const channel = channelsData.find((c) => c.id === lastChannelId);
            if (channel) {
              setCurrentChannel(channel);
              wsService.joinChannel(channel.id);
              useMessageStore.getState().setLoading(true);
              try {
                const messages = await apiService.getMessages(channel.id);
                // Same stale-response guard as handleSelectChannel (fix 2):
                // this restore path is slow (two awaits before it starts), so
                // the user can easily have clicked another channel already.
                if (useServerStore.getState().currentChannel?.id !== channel.id) return;
                setMessages(messages as Message[]);
              } finally {
                if (useServerStore.getState().currentChannel?.id === channel.id) {
                  useMessageStore.getState().setLoading(false);
                }
              }
              return;
            }
          }

          const nextChannel = channelsData[0];
          if (nextChannel) {
            handleSelectChannel(nextChannel);
          } else {
            setCurrentChannel(null);
            setMessages([]);
          }
          return;
        }
      }

      // No restore data — select first server
      handleSelectServer(data[0]);
    } catch (err) {
      logger.error('Failed to load servers:', err, { module: 'app' });
    } finally {
      // Lands true on failure too, so a failed fetch doesn't leave ChatArea's
      // no-servers gate hanging open forever (board 2a follow-up fix).
      setServersLoaded(true);
    }
  };

  const handleJoinServer = async (server: Server) => {
    try {
      await apiService.joinServer(server.id);
    } catch (err: unknown) {
      // Ignore "already a member" or "owner" errors — proceed to select the server
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('already') && !msg.includes('owner')) {
        logger.error('Failed to join server:', err, { module: 'app' });
        return;
      }
    }
    handleServerJoined(server);
  };

  // handleServerJoined добавляет сервер в сайдбар и открывает его, не вызывая
  // apiService.joinServer — используется после вступления по инвайт-коду
  // (ManageInvitesModal/ServerList join-by-code), где вступление уже
  // произошло на бэкенде. Повторный joinServer для приватного сервера
  // получил бы 404 (прямое вступление запрещено — см. дизайн-спеку).
  const handleServerJoined = (server: Server) => {
    const current = useServerStore.getState().servers;
    if (!current.find((s) => s.id === server.id)) {
      setServers([...current, server]);
    }
    handleSelectServer(server);
    emit({ type: 'serverOpened', serverId: server.id });
  };

  const handleSelectHome = () => {
    setCurrentServer(null);
    setCurrentChannel(null);
  };

  const handleSelectServer = async (server: Server) => {
    setCurrentServer(server);
    setMembers([]);
    // Мобайл: тап по серверу открывает список каналов, а не чат. Канал чужого
    // сервера сбрасываем, чтобы лента не показывала контекст другого сервера.
    if (!opts.autoOpenChannel) {
      const cur = useServerStore.getState().currentChannel;
      if (cur && cur.server_id !== server.id) { setCurrentChannel(null); setMessages([]); }
    }
    try {
      const data = await apiService.getChannels(server.id) as Channel[];
      setChannels(data);
      loadServerMembers(server.id);
      loadServerPermissions(server.id);
      if (!opts.autoOpenChannel) return;
      // Если в этом сервере идёт звонок — открыть именно его канал, а не первый
      // попавшийся, чтобы переход из CallDock (или обратно на сервер со звонком)
      // приземлял ровно на канал звонка.
      const callChannelId = useCallStore.getState().callChannelId;
      const callChannel = callChannelId ? data.find((c) => c.id === callChannelId) : undefined;
      const nextChannel = callChannel ?? data[0];
      if (nextChannel) {
        handleSelectChannel(nextChannel);
      } else {
        setCurrentChannel(null);
        setMessages([]);
      }
    } catch (err) {
      logger.error('Failed to load channels:', err, { module: 'app' });
    }
  };

  const handleSelectChannel = async (channel: Channel) => {
    setCurrentChannel(channel);

    // Notify server which channel we're viewing for targeted message routing
    wsService.joinChannel(channel.id);

    // Persist to DB (fire-and-forget)
    const currentSrv = useServerStore.getState().currentServer;
    apiService.updateLastVisited(currentSrv?.id ?? null, channel.id).catch(() => {});

    useMessageStore.getState().setLoading(true);
    try {
      const data = await apiService.getMessages(channel.id);
      // Stale-response guard (final-review fix 2). On a fast A→B→C switch an
      // earlier fetch can resolve after the user has moved on; without this it
      // paints the wrong channel's list. `setCurrentChannel` above is a
      // synchronous zustand write that immediately precedes `setLoading(true)`,
      // so this id comparison is exact, not a heuristic.
      if (useServerStore.getState().currentChannel?.id !== channel.id) return;
      setMessages(data as Message[]);
    } catch (err) {
      logger.error('Failed to load messages:', err, { module: 'app' });
    } finally {
      // Guarding only `setMessages` is half a fix: a stale `finally` flipping
      // `loading` false while `messages` still belongs to the previous channel
      // is exactly what lets ChatArea latch its unread anchor off the wrong
      // list. Whoever owns the current channel clears its own flag — see the
      // no-strand argument in task-13-fixwave-report.md.
      if (useServerStore.getState().currentChannel?.id === channel.id) {
        useMessageStore.getState().setLoading(false);
      }
    }
  };

  const handleGoToCall = (serverId: string | null, channelId: string) => {
    const targetServer = servers.find((s) => s.id === serverId);
    if (targetServer && targetServer.id !== currentServer?.id) {
      handleSelectServer(targetServer);
    }
    const channel = useServerStore.getState().channels.find((c) => c.id === channelId);
    if (channel) handleSelectChannel(channel);
  };

  const handleLogout = () => {
    void apiService.logout();
    useFriendStore.getState().reset();
    logout();
  };

  const createServer = async (name: string, isPrivate: boolean) => {
    const server = await apiService.createServer(name, isPrivate) as Server;
    setServers([...useServerStore.getState().servers, server]);
    setCreateServerOpen(false);
    handleSelectServer(server);
    emit({ type: 'serverOpened', serverId: server.id });
  };

  const joinCallNotif = () => {
    const notif = ring.callNotif;
    ring.dismiss();
    if (!notif) return;
    const ch = channels.find((c) => c.id === notif.channelId);
    if (ch) {
      handleSelectChannel(ch);
      handleJoinVoice(ch);
      emit({ type: 'callJoined', serverId: ch.server_id, channelId: ch.id });
    }
  };

  return {
    user,
    servers, currentServer,
    channels, currentChannel,
    members,
    pendingCount,
    voiceParticipants,
    callNotif: ring.callNotif,
    selectServer: handleSelectServer,
    selectChannel: handleSelectChannel,
    selectHome: handleSelectHome,
    joinVoice: handleJoinVoice,
    goToCall: handleGoToCall,
    serverRemoved: handleServerRemoved,
    channelRemoved: handleChannelRemoved,
    joinServer: handleJoinServer,
    serverJoined: handleServerJoined,
    createServer,
    joinCallNotif,
    dismissCallNotif: ring.dismiss,
    logout: handleLogout,
    subscribe,
    ui: {
      findServerOpen, setFindServerOpen,
      settingsOpen, setSettingsOpen,
      createChannelOpen, setCreateChannelOpen,
      createServerOpen, setCreateServerOpen,
    },
  };
}
