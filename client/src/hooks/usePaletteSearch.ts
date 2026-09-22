import { useEffect, useState } from 'react';
import type { Channel, MessageSearchResponse } from '@/types';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import {
  PALETTE_DEBOUNCE_MS, PALETTE_MIN_QUERY, CAP_MESSAGES,
  type PaletteMessage,
} from '@/utils/paletteFilter';

/** Debounce-поиск сообщений текущего канала для палитры (десктопная
 *  CommandPalette и мобильный SearchScreen). Вынесено из CommandPalette без
 *  изменения поведения: `active` — прежний `isOpen`, `channel` — `currentChannel`. */
export function usePaletteSearch(active: boolean, channel: Channel | null, trimmed: string): {
  messages: PaletteMessage[]; total: number; loading: boolean; error: string | null;
} {
  const t = useT();
  const [messages, setMessages] = useState<PaletteMessage[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !channel || trimmed.length < PALETTE_MIN_QUERY) {
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
          channel.id, trimmed, CAP_MESSAGES, 0,
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
  }, [active, channel, trimmed, t]);

  return { messages, total: messagesTotal, loading: messagesLoading, error: messagesError };
}
