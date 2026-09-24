import { wsService } from './websocket';
import { guestGateway } from './guestGateway';

/**
 * Шов «куда звонок шлёт и откуда слушает свои события» (mic, демонстрация,
 * качество связи). У участника с аккаунтом это основной WS хаба, у гостя —
 * гостевой шлюз: docs/superpowers/specs/2026-09-17-guest-call-link-design.md,
 * «Швы в существующем коде звонка» (CallEventBus).
 *
 * Слушатели ставятся на оба транспорта сразу: мост звонка подписывается один
 * раз за жизнь вкладки, а в любой вкладке живёт только один из них — второй
 * никогда не подключается и ничего не присылает.
 */

export type CallTransport = 'account' | 'guest';

/** Всё, что гостевой шлюз принимает от гостя; остальное он молча выбросит. */
const GUEST_OUTBOUND = new Set([
  'mic_muted',
  'mic_unmuted',
  'camera_off',
  'camera_on',
  'screen_share_started',
  'screen_share_stopped',
  'connection_quality',
]);

let transport: CallTransport = 'account';

/** Ставит страница гостя при входе и снимает при выходе. */
export function setCallTransport(next: CallTransport): void {
  transport = next;
}

export function getCallTransport(): CallTransport {
  return transport;
}

export const callBus = {
  send(type: string, payload: Record<string, unknown> = {}): void {
    if (transport === 'guest') {
      // voice_joined, voice_call_ring и прочие события хаба гостю не положены:
      // шлюз их всё равно выбросит, так что не шлём их вовсе.
      if (GUEST_OUTBOUND.has(type)) guestGateway.send(type, payload);
      return;
    }
    wsService.send(type, payload);
  },

  on(type: string, listener: (payload: unknown) => void): () => void {
    const offAccount = wsService.on(type, listener);
    const offGuest = guestGateway.on(type, listener);
    return () => {
      offAccount();
      offGuest();
    };
  },
};
