import type { Channel, PermissionSet } from '@/types';

// Значения битов зафиксированы на бэкенде (server/internal/domain/permission.go)
// и записаны в БД числами — менять их нельзя.
export const PERMISSIONS = {
  ADMINISTRATOR: 1n << 0n,
  MANAGE_SERVER: 1n << 1n,
  MANAGE_ROLES: 1n << 2n,
  MANAGE_CHANNELS: 1n << 3n,
  VIEW_CHANNELS: 1n << 4n,
  SEND_MESSAGES: 1n << 5n,
  MENTION_EVERYONE: 1n << 6n,
} as const;

export const EMPTY_PERMISSIONS: PermissionSet = {
  isOwner: false,
  bits: 0n,
  highestPosition: -1,
};

/**
 * can — единственная точка проверки прав на клиенте.
 * Это только UI-гейт: источник истины — бэкенд, который проверяет то же самое
 * на каждом запросе.
 */
export function can(set: PermissionSet | undefined, perm: bigint): boolean {
  if (!set) return false;
  if (set.isOwner) return true;
  if ((set.bits & PERMISSIONS.ADMINISTRATOR) !== 0n) return true;
  return (set.bits & perm) !== 0n;
}

/**
 * canManageChannelPrivacy — может ли userId менять приватность канала и
 * управлять списком приглашённых. Отдельно от can(MANAGE_CHANNELS): та
 * пропускает любую роль с этим правом, а приватностью управляет только
 * владелец канала, владелец сервера или администратор.
 */
export function canManageChannelPrivacy(
  permissions: PermissionSet | undefined,
  channel: Channel,
  userId: string | undefined,
): boolean {
  if (!permissions || !userId) return false;
  if (permissions.isOwner) return true;
  if ((permissions.bits & PERMISSIONS.ADMINISTRATOR) !== 0n) return true;
  return channel.owner_id === userId;
}
