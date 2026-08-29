import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Moon, Plus, Search, Settings as SettingsIcon, Sun, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Channel } from '@/types';
import { useT } from '@/i18n';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore } from '@/stores/themeStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { can, PERMISSIONS } from '@/utils/permissions';
import {
  buildPalette, moveSelection, PALETTE_MAX_QUERY,
  type PaletteActionDef, type PaletteRow,
} from '@/utils/paletteFilter';
import './CommandPalette.css';

interface CommandPaletteProps {
  onSelectChannel: (channel: Channel) => void;
  onOpenSettings: () => void;
  onCreateChannel: () => void;
  onCreateServer: () => void;
  onFindServer: () => void;
  onJoinVoice: (channel: Channel) => void;
}

export function CommandPalette({
  onSelectChannel, onOpenSettings, onCreateChannel, onCreateServer, onFindServer, onJoinVoice,
}: CommandPaletteProps) {
  const t = useT();
  const isOpen = usePaletteStore((s) => s.isOpen);
  const close = usePaletteStore((s) => s.close);
  const channels = useServerStore((s) => s.channels);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useModalFocus(isOpen, dialogRef, close);

  // Каждое открытие — чистая палитра.
  useEffect(() => {
    if (isOpen) { setQuery(''); setSelected(0); }
  }, [isOpen]);

  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannel = useServerStore((s) => s.currentChannel);
  const permissions = useServerStore((s) => (s.currentServer ? s.permissions.get(s.currentServer.id) : undefined));
  const callChannelId = useCallStore((s) => s.callChannelId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // Иконки живут рядом с реестром: paletteFilter — чистый модуль и ничего не
  // знает про React (решение 12).
  const actionIcons: Record<string, ReactNode> = {
    'create-channel': <Plus size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'join-voice': <Volume2 size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'open-settings': <SettingsIcon size={17} strokeWidth={1.8} className="palette-row-icon" />,
    theme: theme === 'dark'
      ? <Sun size={17} strokeWidth={1.8} className="palette-row-icon" />
      : <Moon size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'create-server': <Plus size={17} strokeWidth={1.8} className="palette-row-icon" />,
    'find-server': <Search size={17} strokeWidth={1.8} className="palette-row-icon" />,
  };

  const canManageChannels = can(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const actions: PaletteActionDef[] = useMemo(() => {
    const defs: PaletteActionDef[] = [];
    if (currentServer && canManageChannels) {
      defs.push({ id: 'create-channel', label: t('palette.createChannel'), run: onCreateChannel });
    }
    if (currentChannel && callChannelId !== currentChannel.id) {
      defs.push({
        id: 'join-voice',
        label: t('palette.joinVoice', { channel: currentChannel.name }),
        run: () => onJoinVoice(currentChannel),
      });
    }
    defs.push({ id: 'open-settings', label: t('palette.openSettings'), run: onOpenSettings });
    defs.push({
      id: 'theme',
      label: theme === 'dark' ? t('palette.themeLight') : t('palette.themeDark'),
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    defs.push({ id: 'create-server', label: t('palette.createServer'), run: onCreateServer });
    defs.push({ id: 'find-server', label: t('palette.findServer'), run: onFindServer });
    return defs;
  }, [t, currentServer, canManageChannels, currentChannel, callChannelId, theme,
      onCreateChannel, onJoinVoice, onOpenSettings, setTheme, onCreateServer, onFindServer]);

  const model = useMemo(
    () => buildPalette({
      query,
      channels,
      actions,
      messages: [],
      messagesTotal: 0,
      hasChannel: false,
      messagesLoading: false,
      messagesError: null,
    }),
    [query, channels, actions],
  );

  // Список поменялся — выделение всегда возвращается на первую строку.
  useEffect(() => { setSelected(0); }, [model.rows.length, query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`#palette-row-${selected}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!isOpen) return null;

  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') { close(); onSelectChannel(row.channel); }
    else if (row.kind === 'action') { close(); row.action.run(); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => moveSelection(i, 1, model.rows.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => moveSelection(i, -1, model.rows.length)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const row = model.rows[selected];
      if (row) activate(row);
    }
    // Escape обрабатывает useModalFocus (стек модалок), здесь не дублируем.
  };

  const groupLabel = { channels: 'palette.groupChannels', messages: 'palette.groupMessages', actions: 'palette.groupActions' } as const;

  return (
    <div className="modal-overlay palette-overlay" onClick={close}>
      <div
        ref={dialogRef}
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-search">
          <Search size={19} strokeWidth={1.8} className="palette-search-icon" />
          <input
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded={model.rows.length > 0}
            aria-controls="palette-list"
            aria-activedescendant={model.rows.length ? `palette-row-${selected}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            maxLength={PALETTE_MAX_QUERY}
            data-autofocus
          />
          <span className="kbd palette-esc">{t('palette.esc')}</span>
        </div>

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {model.groups.map((group) => (
            <div className="palette-group" key={group.key}>
              <div className="palette-group-label">{t(groupLabel[group.key])}</div>
              {group.rows.map((row, i) => {
                if (row.kind === 'status') {
                  return <div className="palette-status" key={row.id}>{row.text}</div>;
                }
                const index = group.from + i;
                const isSelected = index === selected;
                return (
                  <div
                    key={row.id}
                    id={`palette-row-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`palette-row${isSelected ? ' is-selected' : ''}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => activate(row)}
                  >
                    {row.kind === 'channel' && (
                      <>
                        <Hash size={17} strokeWidth={1.8} className="palette-row-icon" />
                        <span className="palette-row-name">{row.channel.name}</span>
                        {isSelected && (
                          <span className="kbd palette-enter">↵ {t('palette.enterOpen')}</span>
                        )}
                      </>
                    )}
                    {row.kind === 'action' && (
                      <>
                        {actionIcons[row.action.id]}
                        <span className="palette-row-name palette-row-action">{row.action.label}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {model.rows.length === 0 && query.trim() && (
            <div className="palette-empty">{t('palette.empty', { query: query.trim() })}</div>
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-hint"><b className="palette-key">↑↓</b> {t('palette.navHint')}</span>
          <span className="palette-hint"><b className="palette-key">↵</b> {t('palette.selectHint')}</span>
          <span className="palette-hint palette-hint-end">
            {t('palette.globalHintBefore')} <b className="palette-key">⌘K</b> {t('palette.globalHintAfter')}
          </span>
        </div>
      </div>
    </div>
  );
}
