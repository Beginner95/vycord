import type { Screen, Stack, TabId } from './types';

export const TAB_ROOT: Record<TabId, Screen> = {
  servers: { kind: 'servers' },
  friends: { kind: 'friends' },
  profile: { kind: 'profile' },
};

const ROOT_KINDS = new Set(['servers', 'friends', 'profile', 'guestCall']);

/** Обязательные строковые поля каждого вида экрана. */
const FIELDS: Record<Screen['kind'], readonly string[]> = {
  servers: [],
  friends: [],
  profile: [],
  channels: ['serverId'],
  chat: ['channelId'],
  channelInfo: ['channelId'],
  call: [],
  serverSettings: ['serverId'],
  invites: ['serverId'],
  stickers: ['serverId'],
  createServer: [],
  findServer: [],
  search: [],
  settings: ['section'],
  friendAdd: [],
  guestCall: [],
  guestChat: [],
  guestParticipants: [],
  sheet: ['id'],
};

function isScreen(v: unknown): v is Screen {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(FIELDS, kind)) return false;
  return FIELDS[kind as Screen['kind']].every((f) => typeof (v as Record<string, unknown>)[f] === 'string');
}

export function isStack(v: unknown): v is Stack {
  return Array.isArray(v) && v.length > 0 && v.every(isScreen) && ROOT_KINDS.has((v[0] as Screen).kind);
}

export function tabOf(stack: Stack): TabId {
  const k = stack[0].kind;
  return k === 'friends' || k === 'profile' ? k : 'servers';
}

export const isRoot = (stack: Stack): boolean => stack.length === 1;

export function push(stack: Stack, s: Screen): Stack {
  const top = stack[stack.length - 1];
  // Запись sheet'а транзитна: переход ИЗ sheet'а занимает её место, иначе
  // «назад» с нового экрана вернул бы пользователя в уже закрытый sheet.
  return top.kind === 'sheet' && stack.length > 1 ? [...stack.slice(0, -1), s] : [...stack, s];
}

export const pop = (stack: Stack): Stack => (stack.length > 1 ? stack.slice(0, -1) : stack);

export const stripSheets = (stack: Stack): Stack => stack.filter((s) => s.kind !== 'sheet');
