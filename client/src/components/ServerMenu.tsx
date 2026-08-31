import { useEffect, useRef, useState } from 'react';
import { UserPlus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { Server, User } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ContextMenu } from '@/components/ContextMenu';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EditServerModal } from '@/components/EditServerModal';
import { ManageInvitesModal } from '@/components/ManageInvitesModal';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';

interface ServerMenuProps {
  server: Server;
  user: User | null;
  anchor: { x: number; y: number };
  onClose: () => void;
  onDeleted: (serverId: string) => void;
}

export function ServerMenu({ server, user, anchor, onClose, onDeleted }: ServerMenuProps) {
  const t = useT();
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Защита от двойного сабмита: ConfirmModal остаётся на экране на всё время
  // запроса (нативный confirm() закрывался синхронно), поэтому второй клик по
  // «Удалить» успевал бы отправить второй DELETE. Ref, а не state: он
  // обновляется синхронно и не зависит от батчинга React.
  const deletingRef = useRef(false);
  const perms = useServerStore.getState().permissions.get(server.id);
  const isOwner = server.owner_id === user?.id;
  const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || isOwner;
  const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);

  // ContextMenu вызывает свой onClose и после выбора пункта, и при dismiss.
  // Родительский onClose размонтирует ServerMenu целиком — звать его можно
  // только когда поток действительно закончен, иначе под-модалка не откроется.
  const flowOpen = editing || inviting || confirmingDelete || error !== null;
  useEffect(() => {
    if (menuDismissed && !flowOpen) onClose();
  }, [menuDismissed, flowOpen, onClose]);

  const handleDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onDeleted(server.id);
      setConfirmingDelete(false);
      onClose();
    } catch (err) {
      setConfirmingDelete(false);
      setError(apiErrorText(err, t));
      setTimeout(() => setError(null), 5000); // error !== null держит компонент смонтированным до dismiss тоста
    } finally {
      deletingRef.current = false;
    }
  };

  return (
    <>
      {!menuDismissed && (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          label={server.name}
          onClose={() => setMenuDismissed(true)}
          items={[
            ...(canInvite ? [{ label: t('server.inviteMenu'), icon: <UserPlus size={16} strokeWidth={1.8} />, onClick: () => setInviting(true) }] : []),
            ...(canManage ? [{ label: t('server.editMenu'), icon: <SettingsIcon size={16} strokeWidth={1.8} />, onClick: () => setEditing(true) }] : []),
            // Удаление сервера — привилегия владения и на бэкенде (DeleteServer
            // проверяет только owner_id), роль с MANAGE_SERVER снести сервер не может.
            ...(isOwner ? [{ label: t('server.deleteMenu'), icon: <Trash2 size={16} strokeWidth={1.8} />, danger: true, onClick: () => setConfirmingDelete(true) }] : []),
          ]}
        />
      )}
      {editing && <EditServerModal server={server} onClose={() => { setEditing(false); onClose(); }} />}
      {inviting && <ManageInvitesModal serverId={server.id} onClose={() => { setInviting(false); onClose(); }} />}
      <ConfirmModal
        open={confirmingDelete}
        title={t('server.deleteTitle', { name: server.name })}
        body={t('server.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        onCancel={() => { setConfirmingDelete(false); onClose(); }}
      />
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
