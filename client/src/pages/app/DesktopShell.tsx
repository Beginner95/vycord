import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ServerList } from '@/components/ServerList';
import { HomeView } from '@/components/HomeView';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { UserList } from '@/components/UserList';
import { TitleBar } from '@/components/TitleBar';
import { CallUI } from '@/components/CallUI';
import { CallDock } from '@/components/CallDock';
import { UserPanel } from '@/components/UserPanel';
import { CallStage } from '@/components/CallStage';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';
import type { AppController } from './useAppController';
import { AppOverlays } from './AppOverlays';
import '../AppPage.css';

interface DesktopShellProps {
  c: AppController;
}

export function DesktopShell({ c }: DesktopShellProps) {
  const t = useT();
  const { servers, currentServer, channels, currentChannel, members, user, pendingCount, voiceParticipants } = c;

  // M6 T8 (spec §5, decision 22): in the 900–1199 band the member list leaves
  // the flow and this flag is what brings it back. It is read by exactly one
  // CSS rule, inside that band's media query — see AppPage.css.
  const [membersOpen, setMembersOpen] = useState(false);
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

  // M6 T8 (decision 22): in the 900–1199 band the member list leaves the flow
  // and `membersOpen` is what brings it back — read by exactly one CSS rule,
  // inside that band's own media query in AppPage.css. Below 900, DesktopShell
  // does not render at all (Task 10 — AppPage's split routes there to
  // MobileShell), so there is no second band to coordinate with here anymore.
  const handleToggleMembers = () => {
    setMembersOpen((v) => !v);
  };

  return (
    <div className="app-page">
      <TitleBar />
      <div
        className="app-layout"
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
          onSelectServer={c.selectServer}
          onCreateServer={() => c.ui.setCreateServerOpen(true)}
          onOpenFindServer={() => c.ui.setFindServerOpen(true)}
          onServerDeleted={c.serverRemoved}
          onSelectHome={c.selectHome}
          pendingCount={pendingCount}
        />

        {currentServer ? (
          <>
            <ChannelSidebar
              server={currentServer}
              channels={channels}
              currentChannel={currentChannel}
              onSelectChannel={c.selectChannel}
              onJoinVoice={c.joinVoice}
              user={user}
              voiceParticipants={voiceParticipants}
              members={members}
              onChannelDeleted={c.channelRemoved}
              onServerDeleted={c.serverRemoved}
              onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
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
                onShowMembers={handleToggleMembers}
                onJoinVoice={c.joinVoice}
                onCreateServer={() => c.ui.setCreateServerOpen(true)}
                onFindServer={() => c.ui.setFindServerOpen(true)}
                voiceParticipants={voiceParticipants}
              />
            </div>
          </>
        ) : (
          <HomeView />
        )}

        {/* Список участников виден на любом сервере, включая звонок: чат и
            сцена делят колонку, и прятать соседнюю панель больше не за чем.
            Но вне сервера («Дом») ему показывать нечего — members в сторе
            остаются от последнего открытого сервера, и без этой проверки
            здесь висел бы чужой контекст рядом с HomeView. */}
        {currentServer && (
          <UserList voiceParticipants={voiceParticipants} />
        )}
      </div>

      <AppOverlays
        c={c}
        onPaletteSelectChannel={c.selectChannel}
        onPaletteJoinVoice={c.joinVoice}
        onPaletteShowChat={() => {}}
      />

      {/* Final-review fix I-B/I-C: CallDock and UserPanel (Settings/Logout)
          used to render only from inside ChannelSidebar, which itself only
          renders while a server is selected — so both became unreachable
          while "Дом" (currentServer === null) showed HomeView instead. Hoisted
          here, unconditionally, the same way CallUI already sits outside the
          currentServer ternary for call-related UI that must survive across
          top-level views. */}
      <div className="app-account-dock">
        <CallDock onGoToCall={c.goToCall} />
        <UserPanel user={user} onLogout={c.logout} onOpenSettings={() => c.ui.setSettingsOpen(true)} />
      </div>

      <CallUI />
    </div>
  );
}
