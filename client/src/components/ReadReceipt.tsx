import { Check, CheckCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { useUnreadStore } from '@/stores/unreadStore';
import { comparePos, msgPos } from '@/utils/readCursor';
import type { Message } from '@/types';

/**
 * VYC-104: квитанция под своим сообщением. Серая одинарная — никто ещё не
 * прочитал, цветная двойная — прочитал хотя бы один (кто именно — в списке
 * «Кто прочитал»). Состояние — по самому дальнему курсору других участников.
 */
export function ReadReceipt({ msg, onOpen }: { msg: Message; onOpen?: () => void }) {
  const t = useT();
  const read = useUnreadStore((s) => {
    const others = s.othersRead[msg.channel_id];
    return !!others && comparePos(msgPos(msg), others) <= 0;
  });
  const label = read ? t('chat.receiptRead') : t('chat.receiptSent');
  const Icon = read ? CheckCheck : Check;
  const className = `msg-receipt${read ? ' is-read' : ''}`;
  if (!onOpen) {
    return (
      <span className={className} role="img" aria-label={label} title={label}>
        <Icon size={14} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <button type="button" className={`${className} is-action`} aria-label={label} title={label} onClick={onOpen}>
      <Icon size={14} strokeWidth={1.8} />
    </button>
  );
}
