import type { Message, PermissionSet } from '@/types';
import { can, PERMISSIONS } from '@/utils/permissions';

/**
 * VYC-104: кому показывать «Кто прочитал». Зеркало проверки на сервере
 * (ReadStateUseCase.Readers): пользовательское сообщение участника — его
 * автору, владельцу сервера и PermAdministrator (can() покрывает обоих).
 * Это только UI-гейт: сервер на чужой запрос ответит 403.
 */
export function canViewReaders(msg: Message, userId: string | undefined, perms: PermissionSet | undefined): boolean {
  if (msg.kind !== 'user' || !msg.user_id) return false;
  return msg.user_id === userId || can(perms, PERMISSIONS.ADMINISTRATOR);
}
