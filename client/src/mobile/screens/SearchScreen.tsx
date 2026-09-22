import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Hash, Moon, Plus, Search, Settings as SettingsIcon, Sun, Volume2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { usePaletteSearch } from '@/hooks/usePaletteSearch';
import { usePaletteStore } from '@/stores/paletteStore';
import { useThemeStore } from '@/stores/themeStore';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
import {
  buildPalette, shouldShowEmptyState, PALETTE_MAX_QUERY,
  type PaletteActionDef, type PaletteRow,
} from '@/utils/paletteFilter';
import { useT, useDateFormat } from '@/i18n';
import type { ScreenCtx } from './types';
import './SearchScreen.css';

const GROUP_LABEL = { channels: 'palette.groupChannels', messages: 'palette.groupMessages', actions: 'palette.groupActions' } as const;

/** Экран `search` (спека §5.10, D8): CommandPalette без хоткеев и оверлея. Сообщения
 *  и «искать в канале» — только если под экраном лежит чат (`channelId`). */
export function SearchScreen({ ctx, channelId }: { ctx: ScreenCtx; channelId: string | null }) {
  const { c, nav } = ctx;
  const t = useT();
  const fmt = useDateFormat();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const channel = useMemo(() => c.channels.find((ch) => ch.id === channelId) ?? null, [c.channels, channelId]);
  const trimmed = query.trim();
  const found = usePaletteSearch(true, channel, trimmed);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const perms = useServerStore((s) => (c.currentServer ? s.permissions.get(c.currentServer.id) : undefined));
  const canManageChannels = can(perms, PERMISSIONS.MANAGE_CHANNELS);

  const goBackWith = (cmd: () => void) => { cmd(); nav.back(); };

  const actions: PaletteActionDef[] = useMemo(() => {
    const defs: PaletteActionDef[] = [];
    if (c.currentServer && canManageChannels) {
      defs.push({ id: 'create-channel', label: t('palette.createChannel'), run: () => c.ui.setCreateChannelOpen(true) });
    }
    if (channel && callChannelId !== channel.id) {
      defs.push({ id: 'join-voice', label: t('palette.joinVoice', { channel: channel.name }), run: () => ctx.joinVoice(channel) });
    }
    defs.push({ id: 'open-settings', label: t('palette.openSettings'), run: () => c.ui.setSettingsOpen(true) });
    defs.push({
      id: 'theme',
      label: theme === 'dark' ? t('palette.themeLight') : t('palette.themeDark'),
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    defs.push({ id: 'create-server', label: t('palette.createServer'), run: () => nav.push({ kind: 'createServer' }) });
    defs.push({ id: 'find-server', label: t('palette.findServer'), run: () => nav.push({ kind: 'findServer' }) });
    if (channel) {
      defs.push({
        id: 'search-in-channel',
        label: t('palette.searchInChannel', { channel: channel.name }),
        run: () => goBackWith(() => usePaletteStore.getState().searchInChannel(channel.id, '')),
      });
    }
    return defs;
  }, [t, c, nav, ctx, channel, callChannelId, canManageChannels, theme, setTheme]);

  const model = useMemo(() => buildPalette({
    query, channels: c.channels, actions,
    messages: found.messages, messagesTotal: found.total, hasChannel: !!channel,
    messagesLoading: found.loading, messagesError: found.error,
  }), [query, c.channels, actions, found, channel]);

  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') {
      nav.pushMany([{ kind: 'channels', serverId: row.channel.server_id }, { kind: 'chat', channelId: row.channel.id }]);
    } else if (row.kind === 'action') {
      row.action.run();
    } else if (row.kind === 'message' && channel) {
      goBackWith(() => usePaletteStore.getState().jumpToMessage(channel.id, row.message.id));
    } else if (row.kind === 'show-all' && channel) {
      goBackWith(() => usePaletteStore.getState().searchInChannel(channel.id, trimmed));
    }
  };

  const actionIcon = (id: string): ReactNode => {
    const p = { size: 20, strokeWidth: 1.8 } as const;
    switch (id) {
      case 'create-channel': case 'create-server': return <Plus {...p} />;
      case 'join-voice': return <Volume2 {...p} />;
      case 'open-settings': return <SettingsIcon {...p} />;
      case 'theme': return theme === 'dark' ? <Sun {...p} /> : <Moon {...p} />;
      default: return <Search {...p} />;
    }
  };

  const renderRow = (row: PaletteRow): ReactNode => {
    switch (row.kind) {
      case 'status':
        return <div className="search-status" key={row.id}>{row.id === 'messages-loading' ? t('palette.searching') : row.text}</div>;
      case 'channel':
        return <MobileListRow key={row.id} avatar={<span className="search-icon"><Hash size={20} strokeWidth={1.8} /></span>} title={row.channel.name} onClick={() => activate(row)} />;
      case 'action':
        return <MobileListRow key={row.id} avatar={<span className="search-icon">{actionIcon(row.action.id)}</span>} title={row.action.label} onClick={() => activate(row)} />;
      case 'show-all':
        return <MobileListRow key={row.id} avatar={<span className="search-icon"><Search size={20} strokeWidth={1.8} /></span>} title={t('palette.showAll')} onClick={() => activate(row)} />;
      case 'message':
        return (
          <MobileListRow
            key={row.id}
            avatar={<Avatar username={row.message.username} className="search-avatar" />}
            title={row.message.username}
            subtitle={splitMatches(snippetAround(row.message.content, trimmed), trimmed).map((part, i) =>
              part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}
            meta={<span className="activity-time">{fmt.formatDayMonth(new Date(row.message.created_at))}</span>}
            onClick={() => activate(row)}
          />
        );
    }
  };

  return (
    <div className="search-screen">
      <header className="screen-header search-header">
        <button type="button" className="screen-header-btn" aria-label={t('common.back')} onClick={nav.back}>
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
        <input
          ref={inputRef}
          className="search-input"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('palette.placeholder')}
          maxLength={PALETTE_MAX_QUERY}
        />
      </header>
      <div className="search-list">
        {model.groups.map((g) => (
          <section key={g.key} aria-label={t(GROUP_LABEL[g.key])}>
            <h2 className="search-group">{t(GROUP_LABEL[g.key])}</h2>
            {g.rows.map(renderRow)}
          </section>
        ))}
        {shouldShowEmptyState(model, query) && <div className="search-status">{t('palette.empty', { query: trimmed })}</div>}
      </div>
    </div>
  );
}
