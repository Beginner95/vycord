import { useState } from 'react';
import { Hash, Headphones, Search, UserPlus, Settings2 } from 'lucide-react';
import type { MemberWithUser } from '@/types';
import { Avatar } from '@/components/Avatar';
import { useMemberList } from '@/components/useMemberList';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useCallStore } from '@/stores/callStore';
import { callService } from '@/services/call';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
import type { ScreenCtx } from './types';
import './ChannelInfoScreen.css';

/** Экран `channelInfo` (спека §5.5). «Пригласить гостя» и «Гости» — этап 4 (D7). */
export function ChannelInfoScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const list = useMemberList(c.voiceParticipants);
  const [callTarget, setCallTarget] = useState<MemberWithUser | null>(null);
  const [manage, setManage] = useState(false);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const perms = useServerStore((s) => (c.currentServer ? s.permissions.get(c.currentServer.id) : undefined));

  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel || !c.currentServer) return <div className="mobile-screen-loading" />;
  const server = c.currentServer;
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE) || server.owner_id === c.user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const inThisCall = callChannelId === channelId;

  const toCall = () => {
    if (!inThisCall) c.joinVoice(channel);
    // channelInfo ЗАМЕНЯЕМ экраном звонка: назад из звонка — в чат, а не в «о канале».
    nav.replaceStack([...nav.stack.slice(0, -1), { kind: 'call' }]);
  };
  const toSearch = () => {
    // Команду ставим ДО возврата: чат под нами не «активен» (D9) и подхватит её,
    // когда станет верхним экраном.
    usePaletteStore.getState().searchInChannel(channelId, '');
    nav.back();
  };

  const row = (m: MemberWithUser, online: boolean) => {
    const sub = list.voiceNameFor(m, online) ? t('server.inVoice', { channel: list.voiceNameFor(m, online)! }) : list.lastSeenFor(m, online);
    const callable = online && !!c.user && m.user_id !== c.user.id;
    return (
      <MobileListRow
        key={m.user_id}
        className={online ? undefined : 'is-offline'}
        avatar={<Avatar url={m.avatar_url} username={m.username} className="channel-info-avatar" />}
        title={m.username}
        subtitle={sub ?? undefined}
        onClick={callable ? () => setCallTarget(m) : undefined}
      />
    );
  };

  return (
    <div className="channel-info">
      <ScreenHeader title={t('mobile.channelInfo')} onBack={nav.back} />
      <div className="channel-info-scroll">
        <div className="channel-info-hero">
          <span className="channel-info-icon"><Hash size={32} strokeWidth={1.8} /></span>
          <h2 className="channel-info-name">{channel.name}</h2>
          <p className="channel-info-server">{server.name}</p>
        </div>
        <div className="channel-info-actions">
          <button type="button" className="channel-info-action" onClick={toCall}>
            <Headphones size={22} strokeWidth={1.8} /><span>{t('mobile.infoCall')}</span>
          </button>
          <button type="button" className="channel-info-action" onClick={toSearch}>
            <Search size={22} strokeWidth={1.8} /><span>{t('mobile.infoSearch')}</span>
          </button>
        </div>

        <h3 className="channel-info-section">{t('chat.members')}</h3>
        {canInvite && (
          <MobileListRow
            avatar={<span className="channel-info-icon is-small"><UserPlus size={20} strokeWidth={1.8} /></span>}
            title={t('mobile.inviteFriends')}
            onClick={() => nav.push({ kind: 'invites', serverId: server.id })}
          />
        )}
        <div className="channel-info-category">{t('server.online')} — {list.onlineMembers.length}</div>
        {list.onlineMembers.map((m) => row(m, true))}
        <div className="channel-info-category">{t('server.offline')} — {list.offlineMembers.length}</div>
        {list.offlineMembers.map((m) => row(m, false))}

        {canManage && (
          <>
            <h3 className="channel-info-section">{t('mobile.channelSection')}</h3>
            <MobileListRow
              avatar={<span className="channel-info-icon is-small"><Settings2 size={20} strokeWidth={1.8} /></span>}
              title={t('mobile.manageChannel')}
              onClick={() => setManage(true)}
            />
          </>
        )}
      </div>

      <ActionSheet
        open={callTarget !== null}
        onClose={() => setCallTarget(null)}
        title={callTarget?.username}
        items={callTarget ? [{
          label: t('server.callUser', { name: callTarget.username }),
          icon: <Headphones size={20} strokeWidth={1.8} />,
          onClick: () => { void callService.startCall(callTarget.user_id); },
        }] : []}
      />
      <ChannelMenuSheet
        channel={manage ? channel : null}
        serverId={server.id}
        channelCount={c.channels.filter((ch) => ch.server_id === server.id).length}
        open={manage}
        onClose={() => setManage(false)}
        onDeleted={(id) => c.channelRemoved(id)}
      />
    </div>
  );
}
