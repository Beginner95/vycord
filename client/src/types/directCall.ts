/**
 * Протокол звонков 1:1 (VYC-103): docs/superpowers/specs/2026-10-03-direct-calls-design.md.
 * Сервер шлёт события обоим участникам; peer — всегда «другой» участник.
 */
export interface CallPeer {
  id: string;
  username: string;
  avatar_url?: string | null;
}

export interface CallSnapshot {
  call_id: string;
  status: 'ringing' | 'active';
  caller: CallPeer;
  receiver: CallPeer;
}

export type CallEndReason = 'ended' | 'missed' | 'timeout' | 'rejected' | 'failed';

export type CallErrorCode = 'forbidden' | 'offline' | 'busy' | 'not_found' | 'invalid_state' | 'internal' | 'rate_limited';
