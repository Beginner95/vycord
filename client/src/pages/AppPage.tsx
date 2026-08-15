import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { wsService } from '@/services/websocket';
import { apiService, apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { UserList } from '@/components/UserList';
import { TitleBar } from '@/components/TitleBar';
import { CallUI } from '@/components/CallUI';
import { CallStage } from '@/components/CallStage';
import { groupCallService } from '@/services/groupCall';
import { useCallStore, initCallBridge } from '@/stores/callStore';
import { useT } from '@/i18n';
import type { Server, Channel, Message, MemberWithUser } from '@/types';
import './AppPage.css';

type MobilePanel = 'servers' | 'channels' | 'chat' | 'members';

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
  const { user, accessToken, logout } = useAuthStore();
  const { servers, setServers, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel, setMembers, members, setPermissions } = useServerStore();
  const { setMessages } = useMessageStore();
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerIsPrivate, setNewServerIsPrivate] = useState(false);
  const [createServerError, setCreateServerError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('servers');
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
  const inGroupCall = useCallStore((s) => s.status !== 'idle');
  const callChannelId = useCallStore((s) => s.callChannelId);
  const [showCallMembers, setShowCallMembers] = useState(false);
  // Переключатель списка участников уехал из шапки звонка вместе с ней; его
  // новое место — CallDock (Task 10, VYC-77). До тех пор сеттер без вызывающего,
  // и ссылка нужна только чтобы noUnusedLocals не уронил сборку.
  void setShowCallMembers;

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
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setStageHeight((h) => {
        window.localStorage.setItem('vycord.callStageHeight', String(Math.round(h)));
        return h;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
      const msg = payload as Record<string, unknown>;
      if (currentChannel && msg.channel_id === currentChannel.id) {
        // Own messages are added optimistically via HTTP response in ChatArea — skip to avoid duplicates
        if (user && msg.user_id === user.id) return;
        const fullMsg: Message = {
          id: msg.id as string,
          channel_id: msg.channel_id as string,
          user_id: msg.user_id as string,
          content: msg.content as string,
          created_at: msg.created_at as string,
          updated_at: (msg.updated_at as string) || (msg.created_at as string),
        };
        useMessageStore.getState().addMessage(fullMsg);
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

    if (currentServer?.id !== removedServerId) return;

    if (
      groupCallService.isInGroupCallState &&
      channels.some((c) => c.id === groupCallService.currentRoomIdState)
    ) {
      callLeaveGroupCall();
    }

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

    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === removedChannelId) {
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
              wsService.send('join_channel', { channel_id: channel.id });
              const messages = await apiService.getMessages(channel.id);
              setMessages(messages as Message[]);
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

  const handleSelectServer = async (server: Server) => {
    setCurrentServer(server);
    setMembers([]);
    setMobilePanel('channels');
    try {
      const data = await apiService.getChannels(server.id) as Channel[];
      setChannels(data);
      loadServerMembers(server.id);
      loadServerPermissions(server.id);
      const nextChannel = data[0];
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
    wsService.send('join_channel', { channel_id: channel.id });

    // Persist to DB (fire-and-forget)
    const currentSrv = useServerStore.getState().currentServer;
    apiService.updateLastVisited(currentSrv?.id ?? null, channel.id).catch(() => {});

    try {
      const data = await apiService.getMessages(channel.id);
      setMessages(data as Message[]);
    } catch (err) {
      logger.error('Failed to load messages:', err, { module: 'app' });
    }
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
      <div className="app-layout" data-mobile-panel={mobilePanel} data-in-call={inGroupCall ? 'true' : 'false'} data-left-sidebar={leftSidebarHidden ? 'hidden' : 'shown'}>
        <button
          className="sidebar-gutter"
          onClick={toggleLeftSidebar}
          aria-label={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
          title={leftSidebarHidden ? t('sidebar.show') : t('sidebar.hide')}
          aria-pressed={leftSidebarHidden}
        >
          {leftSidebarHidden ? '▶' : '◀'}
        </button>
        <ServerList
          servers={servers}
          currentServer={currentServer}
          user={user}
          onSelectServer={handleSelectServer}
          onCreateServer={() => { setShowCreateServer(true); setCreateServerError(''); }}
          onJoinServer={handleJoinServer}
          onServerJoined={handleServerJoined}
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
        />

        {/* Сцена звонка показывается только в том канале, где идёт звонок:
            уход в другой канал размонтирует её, а сам звонок продолжается —
            его состояние и подписки живут в сторе. */}
        <div className="channel-body" style={{ '--call-stage-height': `${stageHeight}%` } as React.CSSProperties}>
          {callChannelId && callChannelId === currentChannel?.id && (
            <>
              <CallStage />
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
            onShowMembers={() => setMobilePanel('members')}
            onJoinVoice={handleJoinVoice}
          />
        </div>

        {(!inGroupCall || showCallMembers) && (
          <UserList onMobileBack={() => setMobilePanel('chat')} />
        )}
      </div>

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
                <button type="button" onClick={() => { setShowCreateServer(false); setCreateServerError(''); }}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="primary">
                  {t('server.createSubmit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {callNotif && (
        <div className="call-notif-banner">
          <span className="call-notif-icon">🔔</span>
          <span className="call-notif-text">
            <strong>{callNotif.callerName}</strong> {t('call.invitesTo')}{' '}
            <strong>#{callNotif.channelName}</strong>
          </span>
          <button
            className="call-notif-join"
            onClick={() => {
              stopRingtoneRef.current?.();
              stopRingtoneRef.current = null;
              const ch = channels.find((c) => c.id === callNotif.channelId);
              if (ch) { handleSelectChannel(ch); handleJoinVoice(ch); }
              setCallNotif(null);
            }}
          >
            {t('call.joinCall')}
          </button>
          <button
            className="call-notif-dismiss"
            onClick={() => {
              stopRingtoneRef.current?.();
              stopRingtoneRef.current = null;
              setCallNotif(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
      <CallUI />
    </div>
  );
}
