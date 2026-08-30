import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Moon, Plus, Search, Settings as SettingsIcon, Sun, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Channel, MessageSearchResponse } from '@/types';
import { useT, useDateFormat } from '@/i18n';
import { useServerStore } from '@/stores/serverStore';
import { usePaletteStore } from '@/stores/paletteStore';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore } from '@/stores/themeStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { can, PERMISSIONS } from '@/utils/permissions';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
import {
  buildPalette, moveSelection, PALETTE_MAX_QUERY, PALETTE_DEBOUNCE_MS, PALETTE_MIN_QUERY, CAP_MESSAGES,
  type PaletteActionDef, type PaletteRow, type PaletteMessage,
} from '@/utils/paletteFilter';
import './CommandPalette.css';

interface CommandPaletteProps {
  onSelectChannel: (channel: Channel) => void;
  onOpenSettings: () => void;
  onCreateChannel: () => void;
  onCreateServer: () => void;
  onFindServer: () => void;
  onJoinVoice: (channel: Channel) => void;
  onShowChat: () => void;
}

export function CommandPalette({
  onSelectChannel, onOpenSettings, onCreateChannel, onCreateServer, onFindServer, onJoinVoice, onShowChat,
}: CommandPaletteProps) {
  const t = useT();
  const fmt = useDateFormat();
  const isOpen = usePaletteStore((s) => s.isOpen);
  const close = usePaletteStore((s) => s.close);
  const channels = useServerStore((s) => s.channels);
  const [query, setQuery] = useState('');
  // Выделение хранится по id строки, а не по плоскому индексу: сообщения
  // сплайсятся МЕЖДУ группами channels и actions, когда debounced-поиск
  // резолвится при неизменном query — сохранённый индекс в этот момент
  // указывал бы уже на другую строку. id переживает сплайс; плоский индекс
  // вычисляется из него заново при каждом рендере (см. selectedIndex ниже).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useModalFocus(isOpen, dialogRef, close);

  // Каждое открытие — чистая палитра.
  useEffect(() => {
    if (isOpen) { setQuery(''); setSelectedId(null); }
  }, [isOpen]);

  const currentServer = useServerStore((s) => s.currentServer);
  const currentChannel = useServerStore((s) => s.currentChannel);
  const permissions = useServerStore((s) => (s.currentServer ? s.permissions.get(s.currentServer.id) : undefined));
  const callChannelId = useCallStore((s) => s.callChannelId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [messages, setMessages] = useState<PaletteMessage[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const trimmed = query.trim();
  useEffect(() => {
    if (!isOpen || !currentChannel || trimmed.length < PALETTE_MIN_QUERY) {
      setMessages([]); setMessagesTotal(0); setMessagesError(null); setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    let cancelled = false;
    // 120ms — board 2c. Панель MessageSearch намеренно осталась на 300ms:
    // она листает подтверждённый запрос, палитра показывает превью.
    const timer = setTimeout(async () => {
      try {
        const data = (await apiService.searchMessages(
          currentChannel.id, trimmed, CAP_MESSAGES, 0,
        )) as MessageSearchResponse;
        if (cancelled) return;
        setMessages(data.results);
        setMessagesTotal(data.total);
        setMessagesError(null);
      } catch (err) {
        if (!cancelled) setMessagesError(apiErrorText(err, t));
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }, PALETTE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, currentChannel, trimmed, t]);

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
    'search-in-channel': <Search size={17} strokeWidth={1.8} className="palette-row-icon" />,
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
    if (currentChannel) {
      defs.push({
        id: 'search-in-channel',
        label: t('palette.searchInChannel', { channel: currentChannel.name }),
        run: () => {
          onShowChat();
          usePaletteStore.getState().searchInChannel(currentChannel.id, '');
        },
      });
    }
    return defs;
  }, [t, currentServer, canManageChannels, currentChannel, callChannelId, theme,
      onCreateChannel, onJoinVoice, onOpenSettings, setTheme, onCreateServer, onFindServer, onShowChat]);

  const model = useMemo(
    () => buildPalette({
      query,
      channels,
      actions,
      messages,
      messagesTotal,
      hasChannel: !!currentChannel,
      messagesLoading,
      messagesError,
    }),
    [query, channels, actions, messages, messagesTotal, currentChannel, messagesLoading, messagesError],
  );

  // Запрос поменялся — выделение возвращается на первую строку. Именно
  // query, а НЕ model.rows.length: async-результат сообщений сплайсится при
  // неизменном query (debounce резолвится позже, уже после того как
  // пользователь подвинул стрелки) — в этот момент выделение должно
  // остаться на той же строке, а не прыгать на первую, иначе Enter
  // активирует не ту строку, которую выбрал пользователь.
  useEffect(() => { setSelectedId(null); }, [query]);

  // selectedId переживает сплайс строк; если строка с этим id пропала
  // совсем (по-настоящему новый результат), откат на первую строку.
  const selectedIndex = selectedId !== null
    ? Math.max(model.rows.findIndex((row) => row.id === selectedId), 0)
    : 0;

  useEffect(() => {
    listRef.current
      ?.querySelector(`#palette-row-${selectedIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const activate = (row: PaletteRow) => {
    if (row.kind === 'channel') { close(); onSelectChannel(row.channel); }
    else if (row.kind === 'action') { close(); row.action.run(); }
    else if (row.kind === 'message' && currentChannel) {
      close(); onShowChat();
      usePaletteStore.getState().jumpToMessage(currentChannel.id, row.message.id);
    } else if (row.kind === 'show-all' && currentChannel) {
      close(); onShowChat();
      usePaletteStore.getState().searchInChannel(currentChannel.id, trimmed);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = moveSelection(selectedIndex, 1, model.rows.length);
      setSelectedId(model.rows[next]?.id ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = moveSelection(selectedIndex, -1, model.rows.length);
      setSelectedId(model.rows[next]?.id ?? null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = model.rows[selectedIndex];
      if (row) activate(row);
    }
    // Escape обрабатывает useModalFocus (стек модалок), здесь не дублируем.
  };

  const groupLabel = { channels: 'palette.groupChannels', messages: 'palette.groupMessages', actions: 'palette.groupActions' } as const;

  // aria-expanded describes whether the popup shows anything, so it is computed
  // from the RENDERED rows, not from `model.rows`. buildPalette keeps status
  // rows out of `model.rows` (paletteFilter.ts:126) while still emitting them
  // inside a group, so a query that matches no channel and no action but does
  // trigger a message search renders a visible «Ищем…» row with
  // `model.rows.length === 0` — a combobox reporting collapsed while its popup
  // has content. `aria-activedescendant` stays bound to `model.rows`: a status
  // row is not selectable and carries no id to point at.
  const renderedRowCount = model.groups.reduce((n, g) => n + g.rows.length, 0);

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
            aria-expanded={renderedRowCount > 0}
            aria-controls="palette-list"
            aria-activedescendant={model.rows.length ? `palette-row-${selectedIndex}` : undefined}
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
            // listbox → group → option is the valid nesting; role="option" sat
            // inside an unroled <div> until M6 T5.
            <div
              className="palette-group"
              key={group.key}
              role="group"
              aria-labelledby={`palette-group-label-${group.key}`}
            >
              <div className="palette-group-label" id={`palette-group-label-${group.key}`}>
                {t(groupLabel[group.key])}
              </div>
              {group.rows.map((row, i) => {
                if (row.kind === 'status') {
                  return (
                    <div className="palette-status" key={row.id}>
                      {row.id === 'messages-loading' ? t('palette.searching') : row.text}
                    </div>
                  );
                }
                const index = group.from + i;
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={row.id}
                    id={`palette-row-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`palette-row${isSelected ? ' is-selected' : ''}`}
                    onMouseEnter={() => setSelectedId(row.id)}
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
                    {row.kind === 'message' && (
                      <>
                        <Avatar username={row.message.username} className="palette-avatar" />
                        <span className="palette-snippet">
                          {splitMatches(snippetAround(row.message.content, trimmed), trimmed).map((part, i) =>
                            part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
                          )}
                        </span>
                        <span className="palette-date">{fmt.formatDayMonth(new Date(row.message.created_at))}</span>
                      </>
                    )}
                    {row.kind === 'show-all' && (
                      <>
                        <Search size={17} strokeWidth={1.8} className="palette-row-icon" />
                        <span className="palette-row-name palette-row-action">{t('palette.showAll')}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {model.groups.length === 0 && query.trim() && (
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
