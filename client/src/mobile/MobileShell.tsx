import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useDirectCallStore } from '@/stores/directCallStore';
import type { CallTarget } from '@/pages/app/useAppController';
import { usePaletteStore } from '@/stores/paletteStore';
import { IncomingCallCard } from '@/components/directCall/IncomingCallCard';
import { MissedCallToasts } from '@/components/directCall/MissedCallToasts';
import { CallErrorToast } from '@/components/directCall/CallErrorToast';
import { CallPill } from './components/CallPill';
import { CallAudioHost, CallAudioHostContext } from './call/CallAudioHost';
import { useBackgroundCamera } from './call/useBackgroundCamera';
import { useBackgroundAudioDiagnostics } from './call/backgroundAudioDiagnostics';
import { useBackgroundNcBypass } from './call/useBackgroundNcBypass';
import type { Channel } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import { AppOverlays } from '@/pages/app/AppOverlays';
import { useMobileNav } from './nav/useMobileNav';
import { isRoot, stripSheets } from './nav/navReducer';
import { reconcile } from './nav/reconcile';
import type { Screen } from './nav/types';
import { useEdgeSwipeBack } from './gestures/useEdgeSwipeBack';
import { useVisualViewportInset } from './keyboard';
import { TabBar } from './components/TabBar';
import { renderScreen, type ScreenCtx } from './screens/renderScreen';
import './MobileShell.css';

const keyOf = (s: Screen, i: number) => `${i}:${JSON.stringify(s)}`;

export function MobileShell({ c }: { c: AppController }) {
  const nav = useMobileNav();
  const callStatus = useCallStore((s) => s.status);
  const directPhase = useDirectCallStore((s) => s.phase);
  const callRoomId = useCallStore((s) => s.callRoomId);
  const directViewOpen = useDirectCallStore((s) => s.viewOpen);
  // Звонок идёт (канальный или 1:1, в том числе дозвон/исход без комнаты) —
  // экран `call` в стеке жив. Иначе reconcile срезал бы его на дозвоне, пока
  // callStore.status ещё idle.
  const anyCall = callStatus !== 'idle' || directPhase.kind !== 'idle';
  const serversLoaded = useServerStore((s) => s.serversLoaded);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [swipeDx, setSwipeDx] = useState<number | null>(null);
  useVisualViewportInset(shellRef);
  // Свёрнутое приложение: камера выключается и освобождается (браузер всё
  // равно останавливает захват), на возврате — включается снова (VYC-96).
  useBackgroundCamera(callStatus !== 'idle');
  // Только чтение: диагностика пропадания звука в фоне (VYC-96).
  useBackgroundAudioDiagnostics(callStatus !== 'idle');
  // Свёрнуто → микрофон мимо шумодава, возврат → шумодав по намерению (VYC-96).
  useBackgroundNcBypass(callStatus !== 'idle');

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
      callActive: anyCall,
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
  }, [nav, serversLoaded, c, anyCall]);

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

  // Мост аппаратного ⌘K (D8): хоткей открывает стор палитры, а оверлей на
  // мобильной оболочке отключён — вместо него открываем экран `search`.
  const paletteOpen = usePaletteStore((s) => s.isOpen);
  useEffect(() => {
    if (!paletteOpen) return;
    usePaletteStore.getState().close();
    if (nav.top.kind === 'sheet') return; // не подменяем открытую шторку — иначе она виснет поверх экрана поиска
    if (nav.top.kind !== 'search') nav.push({ kind: 'search' });
  }, [paletteOpen]); // nav — актуальный из рендера, эффект запускается сменой флага

  // Экран звонка 1:1 ↔ viewOpen. Открылся вид (звоним/приняли/тап по пилюле) —
  // кладём `call` в стек. Ушли с экрана жестом/кнопкой «назад», пока вид ещё
  // открыт, — закрываем вид (closeView): пилюля берёт управление на себя, а
  // эффект не пушит экран снова (иначе назад не работало бы вовсе). Обратный
  // ход — когда звонок кончился и фаза стала idle — делает reconcile выше
  // (срезает `call`, как для канального звонка).
  const hasCallScreen = nav.stack.some((s) => s.kind === 'call');
  const hadCallScreen = useRef(hasCallScreen);
  // Экран `call` положил звонок 1:1 (а не канальный звонок) — убираем его сами,
  // когда 1:1 кончился, а канальный звонок продолжается (reconcile такой экран
  // не срежет, а CallScreen без своего канала рисует пустоту).
  const pushedByDirect = useRef(false);
  useEffect(() => {
    const had = hadCallScreen.current;
    hadCallScreen.current = hasCallScreen;
    if (had && !hasCallScreen) pushedByDirect.current = false;
    if (!directViewOpen) return;
    if (had && !hasCallScreen) { useDirectCallStore.getState().closeView(); return; }
    if (!hasCallScreen && directPhase.kind !== 'idle') { pushedByDirect.current = true; nav.push({ kind: 'call' }); }
  }, [directViewOpen, hasCallScreen]);

  useEffect(() => {
    if (!hasCallScreen || directPhase.kind !== 'idle' || !pushedByDirect.current) return;
    pushedByDirect.current = false;
    // Без канального звонка экран срежет reconcile — второй pop был бы лишним.
    if (callStatus !== 'idle' && useCallStore.getState().callKind !== 'direct' && nav.top.kind === 'call') nav.back();
  }, [directPhase.kind, hasCallScreen]); // nav — актуальный из рендера, эффект запускается сменой флагов

  const goToCall = (target: CallTarget) => {
    if (target.kind === 'direct') {
      // Вид был закрыт — openView сам вызовет push в эффекте выше; открыт —
      // эффект не сработает, и экран надо положить здесь (иначе push дважды).
      const wasOpen = useDirectCallStore.getState().viewOpen;
      useDirectCallStore.getState().openView();
      if (wasOpen && nav.top.kind !== 'call') { pushedByDirect.current = true; nav.push({ kind: 'call' }); }
      return;
    }
    if (target.serverId) openChannelDeep(target.serverId, target.channelId, true);
  };

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
  // Пилюля рисуется не всегда (звонит входящий, исход при закрытом виде) —
  // обёртка только когда в ней есть содержимое, иначе пустая рамка с тенью.
  const pillHasContent = callStatus !== 'idle'
    || ((directPhase.kind === 'outgoing' || directPhase.kind === 'connecting') && callRoomId === null);
  const showPill = pillHasContent && nav.top.kind !== 'call';
  useEdgeSwipeBack(stageRef, {
    enabled: !root && nav.top.kind !== 'call',
    onBack: nav.back,
    onProgress: setSwipeDx,
  });

  const ctx: ScreenCtx = { c, nav, joinVoice };
  // Смонтированы верхний и предыдущий экраны (предыдущий — под свайпом).
  const visible = nav.stack.map((s, i) => ({ s, i })).slice(-2).filter(({ s }) => s.kind !== 'sheet');

  return (
    <CallAudioHostContext.Provider value={true}>
    <div className="mobile-shell" ref={shellRef}>
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
      {showPill && (
        <div className={root ? 'mobile-call-dock' : undefined}>
          <CallPill
            variant={root ? 'root' : 'stacked'}
            onGoToCall={goToCall}
          />
        </div>
      )}
      {root && <TabBar active={nav.tab} onSelect={nav.switchTab} friendsBadge={c.pendingCount} />}
      <IncomingCallCard />
      <MissedCallToasts />
      <CallErrorToast />
      <AppOverlays
        c={c}
        onOpenCreateServer={() => nav.push({ kind: 'createServer' })}
        onOpenFindServer={() => nav.push({ kind: 'findServer' })}
        onPaletteSelectChannel={(ch) => openChannelDeep(ch.server_id, ch.id, false)}
        onPaletteJoinVoice={(ch) => { c.joinVoice(ch); openChannelDeep(ch.server_id, ch.id, true); }}
        onPaletteShowChat={() => {}}
        showPalette={false}
      />
      {/* Звук звонка не зависит от стека: экран звонка может быть размонтирован. */}
      {callStatus !== 'idle' && <CallAudioHost />}
    </div>
    </CallAudioHostContext.Provider>
  );
}
