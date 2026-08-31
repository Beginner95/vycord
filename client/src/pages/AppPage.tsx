import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { wsService } from '@/services/websocket';
import { apiService, apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { FindServerModal } from '@/components/FindServerModal';
import { CommandPalette } from '@/components/CommandPalette';
import { Settings } from '@/components/Settings';
import { CreateChannelModal } from '@/components/CreateChannelModal';
import { UserList } from '@/components/UserList';
import { TitleBar } from '@/components/TitleBar';
import { CallUI } from '@/components/CallUI';
import { CallStage } from '@/components/CallStage';
import { CallNotifBanner } from '@/components/CallNotifBanner';
import { groupCallService } from '@/services/groupCall';
import { useCallStore, initCallBridge } from '@/stores/callStore';
import { usePaletteHotkey } from '@/hooks/usePaletteHotkey';
import { useT } from '@/i18n';
import type { Server, Channel, Message, MemberWithUser } from '@/types';
import './AppPage.css';

type MobilePanel = 'servers' | 'channels' | 'chat' | 'call' | 'members';

interface CallNotif {
  channelId: string;
  channelName: string;
  callerId: string;
  callerName: string;
}

// Создаём контекст сразу — он будет suspended, но Chrome разрешит resume
// после первого жеста пользователя (логин, клик по каналу и т.д.)
const _audioCtx = new AudioContext();

const _resumeAudio = () => { _audioCtx.resume().catch(() => {}); };
document.addEventListener('click',    _resumeAudio, { capture: true, passive: true });
document.addEventListener('keydown',  _resumeAudio, { capture: true, passive: true });
document.addEventListener('touchend', _resumeAudio, { capture: true, passive: true });

async function playRingOnce(): Promise<void> {
  try {
    if (_audioCtx.state !== 'running') {
      await _audioCtx.resume();
    }
    const state: string = _audioCtx.state;
    if (state !== 'running') return; // жест ещё не был — пропускаем
    const gain = _audioCtx.createGain();
    gain.connect(_audioCtx.destination);
    const t = _audioCtx.currentTime;

    const playTone = (freq: number, offset: number) => {
      const osc = _audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.25, t + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.35);
      osc.start(t + offset);
      osc.stop(t + offset + 0.36);
    };

    playTone(880,  0);
    playTone(1174, 0.18);
  } catch {
    // ignore
  }
}

function startCallRingtone(): () => void {
  void playRingOnce();
  const interval = window.setInterval(() => { void playRingOnce(); }, 2000);
  return () => window.clearInterval(interval);
}

export function AppPage() {
  const t = useT();
  usePaletteHotkey();
  const { user, accessToken, logout } = useAuthStore();
  const { servers, setServers, setServersLoaded, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel, setMembers, members, setPermissions } = useServerStore();
  const { setMessages } = useMessageStore();
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [findServerOpen, setFindServerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerIsPrivate, setNewServerIsPrivate] = useState(false);
  const [createServerError, setCreateServerError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('servers');
  // M6 T8 (spec §5, decision 22): in the 900–1199 band the member list leaves
  // the flow and this flag is what brings it back. It is read by exactly one
  // CSS rule, inside that band's media query — see AppPage.css.
  const [membersOpen, setMembersOpen] = useState(false);
  const [callNotif, setCallNotif] = useState<CallNotif | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());
  const [leftSidebarHidden, setLeftSidebarHidden] = useState<boolean>(
    () => window.localStorage.getItem('vycord.leftSidebarHidden') === '1'
  );

  const toggleLeftSidebar = () => {
    setLeftSidebarHidden((v) => {
      const next = !v;
      window.localStorage.setItem('vycord.leftSidebarHidden', next ? '1' : '0');
      return next;
    });
  };
  const callChannelId = useCallStore((s) => s.callChannelId);

  // Мобильная панель «Звонок» существует только пока CallStage реально
  // смонтирована (см. рендер ниже). Если звонок завершается — сам, по
  // кику, по обрыву связи — или открытый канал меняется, пока эта панель
  // активна, CallStage размонтируется, а панель «Звонок» осталась бы
  // пустой: чат для неё скрыт CSS-правилами мобильного режима, а сцены
  // больше нет. Откатываемся на чат, как только эта комбинация перестаёт
  // выполняться.
  useEffect(() => {
    if (mobilePanel === 'call' && !(callChannelId && callChannelId === currentChannel?.id)) {
      setMobilePanel('chat');
    }
  }, [mobilePanel, callChannelId, currentChannel]);

  // Высота сцены звонка в сплите «звонок сверху, чат снизу». Проценты, а не
  // пиксели: окно можно менять в размерах, а доля экрана под звонок — это то,
  // что пользователь на самом деле выбирает.
  const [stageHeight, setStageHeight] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem('vycord.callStageHeight'));
    return Number.isFinite(saved) && saved >= 20 && saved <= 80 ? saved : 55;
  });

  const handleSplitDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = e.currentTarget.parentElement;
    if (!container) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = container.getBoundingClientRect();

    const onMove = (ev: PointerEvent) => {
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.min(80, Math.max(20, pct));
      setStageHeight(clamped);
    };
    // Одна функция очистки на pointerup И pointercancel: на мобильном браузер
    // может увести вертикальный свайп в скролл — тогда pointerup не придёт
    // вовсе, и слушатели остались бы на window навсегда, стакаясь с каждым
    // следующим перетаскиванием.
    const stopDrag = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      setStageHeight((h) => {
        window.localStorage.setItem('vycord.callStageHeight', String(Math.round(h)));
        return h;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const callNotifRef = useRef<CallNotif | null>(null);
  const handledRemovalsRef = useRef<Set<string>>(new Set());
  useEffect(() => { callNotifRef.current = callNotif; }, [callNotif]);

  useEffect(() => {
    return () => { stopRingtoneRef.current?.(); };
  }, []);

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

  useEffect(() => {
    // Listen for incoming messages via WebSocket
    const unsubscribe = wsService.on('chat_message', (payload) => {
      const msg = payload as Message;
      if (currentChannel && msg.channel_id === currentChannel.id) {
        // Own messages are added optimistically via HTTP response in ChatArea — skip to avoid duplicates
        if (user && msg.user_id === user.id) return;
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
    const unsubscribe = wsService.on('voice_call_ring', (payload) => {
      const p = payload as Record<string, unknown>;
      const alreadyInThatCall =
        groupCallService.isInGroupCallState &&
        groupCallService.currentRoomIdState === p.channel_id;
      if (
        p.server_id === currentServer?.id &&
        p.caller_id !== user?.id &&
        !alreadyInThatCall
      ) {
        stopRingtoneRef.current?.();
        setCallNotif({
          channelId: p.channel_id as string,
          channelName: p.channel_name as string,
          callerId: p.caller_id as string,
          callerName: p.caller_name as string,
        });
        stopRingtoneRef.current = startCallRingtone();
      }
    });
    return () => unsubscribe();
  }, [currentServer, user]);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_cancel', (payload) => {
      const p = payload as Record<string, unknown>;
      if (callNotifRef.current?.channelId === p.channel_id) {
        stopRingtoneRef.current?.();
        stopRingtoneRef.current = null;
        setCallNotif(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubState = wsService.on('voice_state', (payload) => {
      const p = payload as { channels: Record<string, string[]> };
      setVoiceParticipants(new Map(Object.entries(p.channels ?? {})));
    });
    const unsubParticipants = wsService.on('voice_participants', (payload) => {
      const p = payload as { channel_id: string; user_ids: string[] };
      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (p.user_ids.length === 0) {
          next.delete(p.channel_id);
        } else {
          next.set(p.channel_id, p.user_ids);
        }
        return next;
      });
    });
    return () => { unsubState(); unsubParticipants(); };
  }, []);

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
  };

  // M6 T8 — one button, two bands. Below 900px the single-panel model owns the
  // member list (decision 23) and `mobilePanel` is what moves; in 900–1199 the
  // list is a column out of the flow (decision 22) and `membersOpen` is what
  // moves. Both are set unconditionally rather than branching on a
  // `matchMedia('(width < 900px)')`: each half has no RENDERED effect in the
  // other's band, because the CSS rule that reads it lives inside that band's
  // own media query, and a second copy of the 900px boundary in TypeScript
  // could drift out of step with AppPage.css, which is the only place it
  // belongs.
  //
  // Accepted, and stated precisely rather than as "inert": below 900 this also
  // flips `membersOpen`, which nothing in that band reads, so its value on
  // leaving the band is click-parity dependent and decides whether the list is
  // open on a widen into 900–1199. Never observable below 900, recoverable in
  // both directions, and cheaper than duplicating the breakpoint here.
  const handleToggleMembers = () => {
    setMobilePanel('members');
    setMembersOpen((v) => !v);
  };

  const handleSelectServer = async (server: Server) => {
    setCurrentServer(server);
    setMembers([]);
    setMobilePanel('channels');
    try {
      const data = await apiService.getChannels(server.id) as Channel[];
      setChannels(data);
      loadServerMembers(server.id);
      loadServerPermissions(server.id);
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
    setMobilePanel('chat');

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
    logout();
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;
    setCreateServerError('');

    try {
      const server = await apiService.createServer(newServerName.trim(), newServerIsPrivate) as Server;
      setServers([...servers, server]);
      setNewServerName('');
      setNewServerIsPrivate(false);
      setShowCreateServer(false);
      handleSelectServer(server);
    } catch (err) {
logger.error('Failed to create server:', err, { module: 'app' });
      setCreateServerError(apiErrorText(err, t));
    }
  };

  return (
    <div className="app-page">
      <TitleBar />
      <div
        className="app-layout"
        data-mobile-panel={mobilePanel}
        data-members-open={membersOpen ? '1' : '0'}
        data-left-sidebar={leftSidebarHidden ? 'hidden' : 'shown'}
      >
        <button
          className="sidebar-gutter"
          onClick={toggleLeftSidebar}
          aria-label={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
          title={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
          aria-pressed={leftSidebarHidden}
        >
          {/* M6 T12, decision 25: was `▶`/`◀` — the last emoji-as-icon in the
              tree, excluded by M1's own plan. The glyph size below is the
              gutter's own constraint before it is a style choice: it must fit
              inside `.sidebar-gutter` (AppPage.css — anchored by selector, not
              line: this comment has outlived two renumberings), so ServerList's
              18/20/21 cannot fit at any gutter width we would accept.

              M6 T15: 14 → 16, with the gutter 16px → 22px in the same change.
              They were sized together and must move together — 14 was the most
              a 16px gutter could hold, and manual QA read it as a hairline. 16
              still sits inside the 10–15… band's spirit at its top edge and
              matches ChannelSidebar's small tier region to the right of this
              gutter; shrink one and you must shrink the other.

              Written as bare numerals and not the prop form on purpose:
              icon-census greps for the size-prop literal cannot tell a comment
              from a tag, and this comment inflated such a count by one until it
              was reworded. */}
          {leftSidebarHidden
            ? <ChevronRight size={16} strokeWidth={1.8} />
            : <ChevronLeft size={16} strokeWidth={1.8} />}
        </button>
        <ServerList
          servers={servers}
          currentServer={currentServer}
          user={user}
          onSelectServer={handleSelectServer}
          onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
          onOpenFindServer={() => setFindServerOpen(true)}
          onServerDeleted={handleServerRemoved}
        />

        <ChannelSidebar
          server={currentServer}
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          onJoinVoice={handleJoinVoice}
          user={user}
          onLogout={handleLogout}
          onMobileBack={() => setMobilePanel('servers')}
          voiceParticipants={voiceParticipants}
          members={members}
          onChannelDeleted={handleChannelRemoved}
          onGoToCall={handleGoToCall}
          onServerDeleted={handleServerRemoved}
          onOpenSettings={() => setSettingsOpen(true)}
          onCreateChannel={() => setCreateChannelOpen(true)}
        />

        {/* Сцена звонка показывается только в том канале, где идёт звонок:
            уход в другой канал размонтирует её, а сам звонок продолжается —
            его состояние и подписки живут в сторе. */}
        <div className="channel-body" style={{ '--call-stage-height': `${stageHeight}%` } as React.CSSProperties}>
          {callChannelId && callChannelId === currentChannel?.id && (
            <>
              <CallStage onMobileBackToChat={() => setMobilePanel('chat')} />
              <div
                className="call-split-handle"
                onPointerDown={handleSplitDragStart}
                role="separator"
                aria-label={t('call.resizeSplit')}
              />
            </>
          )}
          <ChatArea
            channel={currentChannel}
            user={user}
            onMobileBack={() => setMobilePanel('channels')}
            onShowMembers={handleToggleMembers}
            onJoinVoice={handleJoinVoice}
            onShowCall={
              callChannelId && callChannelId === currentChannel?.id
                ? () => setMobilePanel('call')
                : undefined
            }
            onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
            onFindServer={() => setFindServerOpen(true)}
            voiceParticipants={voiceParticipants}
          />
        </div>

        {/* Список участников виден всегда, включая звонок: чат и сцена теперь
            делят колонку, и прятать соседнюю панель больше не за чем. */}
        <UserList onMobileBack={() => setMobilePanel('chat')} voiceParticipants={voiceParticipants} />
      </div>

      <FindServerModal
        open={findServerOpen}
        onClose={() => setFindServerOpen(false)}
        onJoinServer={handleJoinServer}
        onServerJoined={handleServerJoined}
        onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
      />

      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onLogout={handleLogout} />

      {createChannelOpen && currentServer && (
        <CreateChannelModal serverId={currentServer.id} onClose={() => setCreateChannelOpen(false)} />
      )}

      {showCreateServer && (
        <div className="modal-overlay" onClick={() => { setShowCreateServer(false); setCreateServerError(''); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('server.create')}</h2>
            <form onSubmit={handleCreateServer}>
              <div className="form-group">
                <label htmlFor="server-name">{t('server.nameLabel')}</label>
                <input
                  id="server-name"
                  type="text"
                  value={newServerName}
                  onChange={(e) => { setNewServerName(e.target.value); setCreateServerError(''); }}
                  placeholder={t('server.namePlaceholder')}
                  maxLength={100}
                  autoFocus
                  required
                />
              </div>
              <div className="form-group form-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={newServerIsPrivate}
                    onChange={(e) => setNewServerIsPrivate(e.target.checked)}
                  />
                  {t('server.privateLabel')}
                </label>
              </div>
              {createServerError && <p className="modal-error">{createServerError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateServer(false); setCreateServerError(''); }}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary">
                  {t('server.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {callNotif && (
        <CallNotifBanner
          callerName={callNotif.callerName}
          channelName={callNotif.channelName}
          onJoin={() => {
            stopRingtoneRef.current?.();
            stopRingtoneRef.current = null;
            const ch = channels.find((c) => c.id === callNotif.channelId);
            if (ch) { handleSelectChannel(ch); handleJoinVoice(ch); }
            setCallNotif(null);
          }}
          onDismiss={() => {
            stopRingtoneRef.current?.();
            stopRingtoneRef.current = null;
            setCallNotif(null);
          }}
        />
      )}
      <CommandPalette
        onSelectChannel={handleSelectChannel}
        onOpenSettings={() => setSettingsOpen(true)}
        onCreateChannel={() => setCreateChannelOpen(true)}
        onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
        onFindServer={() => setFindServerOpen(true)}
        onJoinVoice={handleJoinVoice}
        onShowChat={() => setMobilePanel('chat')}
      />
      <CallUI />
    </div>
  );
}
