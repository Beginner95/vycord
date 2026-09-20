import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { CallUI } from '@/components/CallUI';
import { CallDock } from '@/components/CallDock';
import type { Channel } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import { AppOverlays } from '@/pages/app/AppOverlays';
import { useMobileNav } from './nav/useMobileNav';
import { isRoot, stripSheets } from './nav/navReducer';
import { reconcile } from './nav/reconcile';
import type { Screen } from './nav/types';
import { useEdgeSwipeBack } from './gestures/useEdgeSwipeBack';
import { TabBar } from './components/TabBar';
import { renderScreen, type ScreenCtx } from './screens/renderScreen';
import './MobileShell.css';

const keyOf = (s: Screen, i: number) => `${i}:${JSON.stringify(s)}`;

export function MobileShell({ c }: { c: AppController }) {
  const nav = useMobileNav();
  const callStatus = useCallStore((s) => s.status);
  const serversLoaded = useServerStore((s) => s.serversLoaded);
  const stageRef = useRef<HTMLDivElement>(null);
  const [swipeDx, setSwipeDx] = useState<number | null>(null);

  // Нормализация записи: нет стека → корень; sheet'ы после reload не живы.
  useEffect(() => {
    if (!nav.valid) { nav.replaceStack([{ kind: 'servers' }]); return; }
    const clean = stripSheets(nav.stack);
    if (clean.length !== nav.stack.length) nav.replaceStack(clean);
  }, []); // только при монтировании (ESLint в репо нет — disable-комментарий не нужен)

  // Стек × сторы (спека §3.3). Sheet-записи reconcile не трогает — ими
  // владеет useBackDismiss.
  useEffect(() => {
    const r = reconcile(nav.stack, {
      serversLoaded,
      serverIds: new Set(c.servers.map((s) => s.id)),
      currentServerId: c.currentServer?.id ?? null,
      channels: c.channels,
      currentChannelId: c.currentChannel?.id ?? null,
      callActive: callStatus !== 'idle',
    });
    if (r.stack !== nav.stack) { nav.replaceStack(r.stack); return; }
    const action = r.action;
    if (action?.type === 'selectServer') {
      const s = c.servers.find((x) => x.id === action.serverId);
      if (s) void c.selectServer(s);
    } else if (action?.type === 'selectChannel') {
      const ch = c.channels.find((x) => x.id === action.channelId);
      if (ch) void c.selectChannel(ch);
    }
  }, [nav, serversLoaded, c, callStatus]);

  // События контроллера, требующие навигации.
  useEffect(() => c.subscribe((e) => {
    if (e.type === 'serverOpened') {
      nav.switchTab('servers');
      nav.push({ kind: 'channels', serverId: e.serverId });
    } else if (e.type === 'callJoined' && e.serverId) {
      nav.switchTab('servers');
      nav.pushMany([
        { kind: 'channels', serverId: e.serverId },
        { kind: 'chat', channelId: e.channelId },
        { kind: 'call' },
      ]);
    }
  }), [c, nav]);

  const joinVoice = (channel: Channel) => {
    c.joinVoice(channel);
    const onChat = nav.top.kind === 'chat' && nav.top.channelId === channel.id;
    nav.pushMany(onChat ? [{ kind: 'call' }] : [{ kind: 'chat', channelId: channel.id }, { kind: 'call' }]);
  };
  const openChannelDeep = (serverId: string, channelId: string, withCall: boolean) => {
    nav.switchTab('servers');
    nav.pushMany([
      { kind: 'channels', serverId },
      { kind: 'chat', channelId },
      ...(withCall ? [{ kind: 'call' } as Screen] : []),
    ]);
  };

  const root = isRoot(nav.stack);
  useEdgeSwipeBack(stageRef, {
    enabled: !root && nav.top.kind !== 'call',
    onBack: nav.back,
    onProgress: setSwipeDx,
  });

  const ctx: ScreenCtx = { c, nav, joinVoice };
  // Смонтированы верхний и предыдущий экраны (предыдущий — под свайпом).
  const visible = nav.stack.map((s, i) => ({ s, i })).slice(-2).filter(({ s }) => s.kind !== 'sheet');

  return (
    <div className="mobile-shell">
      <div className="mobile-stage" ref={stageRef}>
        {visible.map(({ s, i }, idx) => {
          const isTop = idx === visible.length - 1;
          return (
            <section
              key={keyOf(s, i)}
              className={`mobile-screen${isTop ? ' is-top' : ' is-under'}`}
              aria-hidden={!isTop}
              style={isTop && swipeDx !== null ? { transform: `translateX(${swipeDx}px)` } : undefined}
            >
              {renderScreen(s, ctx)}
            </section>
          );
        })}
      </div>
      {root && callStatus !== 'idle' && (
        <div className="mobile-call-dock">
          <CallDock onGoToCall={(serverId, channelId) => serverId && openChannelDeep(serverId, channelId, true)} />
        </div>
      )}
      {root && <TabBar active={nav.tab} onSelect={nav.switchTab} friendsBadge={c.pendingCount} />}
      <AppOverlays
        c={c}
        onPaletteSelectChannel={(ch) => openChannelDeep(ch.server_id, ch.id, false)}
        onPaletteJoinVoice={(ch) => { c.joinVoice(ch); openChannelDeep(ch.server_id, ch.id, true); }}
        onPaletteShowChat={() => {}}
      />
      <CallUI />
    </div>
  );
}
