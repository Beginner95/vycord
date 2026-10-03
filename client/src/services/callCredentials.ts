import { apiService } from './api';
import { getIceServers as accountIceServers } from './iceConfig';

/**
 * Откуда звонок берёт доступ к SFU. У участника с аккаунтом это обычный API,
 * у гостя — гостевые эндпоинты с непрозрачным сессионным токеном. Шов нужен
 * затем, чтобы `groupCall` не знал, кто именно звонит:
 * docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 4.
 */
export interface CallCredentials {
  getVoiceToken(roomId: string): Promise<{ token: string }>;
  getIceServers(): Promise<RTCIceServer[]>;
}

/**
 * Комната текущего звонка 1:1 (room_id = call_id, VYC-103). groupCall просит
 * токен по roomId и не знает, канал это или звонок, — различает здесь.
 * Ставит callStore.join({kind: 'direct'}), снимает выход из звонка.
 */
let directRoomId: string | null = null;

export function markDirectCallRoom(roomId: string | null): void {
  directRoomId = roomId;
}

export const accountCallCredentials: CallCredentials = {
  getVoiceToken: (roomId) =>
    roomId === directRoomId ? apiService.getCallVoiceToken(roomId) : apiService.getVoiceToken(roomId),
  getIceServers: () => accountIceServers(),
};

let current: CallCredentials = accountCallCredentials;

/** Ставится страницей гостя на монтировании и снимается на размонтировании. */
export function setCallCredentials(credentials: CallCredentials): void {
  current = credentials;
}

export function getCallCredentials(): CallCredentials {
  return current;
}

/**
 * Домен веб-приложения для гостевых ссылок. В Electron `location.origin` —
 * это `file://`, поэтому ссылку всегда строим по переменной сборки.
 */
export function publicWebUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_WEB_URL;
  const origin = configured && configured.length > 0 ? configured : window.location.origin;
  return origin.replace(/\/+$/, '');
}
