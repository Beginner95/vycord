import { Hash, Settings as SettingsIcon, Smile, Trash2, UserPlus } from 'lucide-react';
import type { Server, User } from '@/types';
import type { ContextMenuItem } from '@/components/ContextMenu';
import { useServerStore } from '@/stores/serverStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';

export interface ServerMenuActions {
  onCreateChannel?: () => void;
  onSettings?: () => void;
  onInvites?: () => void;
  onStickers?: () => void;
  onDelete?: () => void;
}

/** Пункты меню сервера для ActionSheet (спека §4.3, §5.3). Пункт появляется,
 *  только если есть И право, И обработчик: на корне «Серверы» обработчика
 *  «создать канал» нет — этот пункт принадлежит экрану каналов. */
export function useServerMenuItems(server: Server, user: User | null, a: ServerMenuActions): ContextMenuItem[] {
  const t = useT();
  const perms = useServerStore((s) => s.permissions.get(server.id));
  const isOwner = server.owner_id === user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || isOwner;
  const canManageChannels = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);

  const items: ContextMenuItem[] = [];
  if (canManageChannels && a.onCreateChannel) {
    items.push({ label: t('channel.createChannelMenu'), icon: <Hash size={20} strokeWidth={1.8} />, onClick: a.onCreateChannel });
  }
  if (canInvite && a.onInvites) {
    items.push({ label: t('mobile.inviteFriends'), icon: <UserPlus size={20} strokeWidth={1.8} />, onClick: a.onInvites });
  }
  if (canManage && a.onSettings) {
    items.push({ label: t('server.editMenu'), icon: <SettingsIcon size={20} strokeWidth={1.8} />, onClick: a.onSettings });
  }
  if (canManage && a.onStickers) {
    items.push({ label: t('chat.manageStickersTitle'), icon: <Smile size={20} strokeWidth={1.8} />, onClick: a.onStickers });
  }
  // Удаление сервера — привилегия владения и на бэкенде (DeleteServer проверяет
  // только owner_id), роль с MANAGE_SERVER снести сервер не может.
  if (isOwner && a.onDelete) {
    items.push({ label: t('server.deleteMenu'), icon: <Trash2 size={20} strokeWidth={1.8} />, danger: true, onClick: a.onDelete });
  }
  return items;
}
