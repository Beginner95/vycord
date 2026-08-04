import { useEffect, useState } from 'react';
import type { Channel, ChannelMember, MemberWithUser } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useT } from '@/i18n';

interface ManageChannelAccessModalProps {
  serverId: string;
  channel: Channel;
  serverMembers: MemberWithUser[];
  onClose: () => void;
}

export function ManageChannelAccessModal({ serverId, channel, serverMembers, onClose }: ManageChannelAccessModalProps) {
  const t = useT();
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiService
      .getChannelMembers(serverId, channel.id)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorText(err, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, channel.id]);

  const memberIds = new Set(members.map((m) => m.user_id));

  const handleInvite = async (userId: string) => {
    setBusyUserId(userId);
    try {
      await apiService.inviteToChannel(serverId, channel.id, userId);
      const target = serverMembers.find((m) => m.user_id === userId);
      setMembers((prev) => [
        ...prev,
        {
          user_id: userId,
          username: target?.username ?? userId,
          avatar_url: target?.avatar_url,
          invited_by: '',
          invited_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusyUserId(userId);
    try {
      await apiService.removeFromChannel(serverId, channel.id, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('channel.manageAccessTitle')}</h2>
        {error && <p className="modal-error">{error}</p>}
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : (
          <ul className="channel-access-list">
            {serverMembers
              .filter((m) => m.user_id !== channel.owner_id)
              .map((m) => {
                const isMember = memberIds.has(m.user_id);
                return (
                  <li key={m.user_id} className="channel-access-row">
                    <span>{m.username}</span>
                    <button
                      type="button"
                      disabled={busyUserId === m.user_id}
                      onClick={() => (isMember ? handleRemove(m.user_id) : handleInvite(m.user_id))}
                    >
                      {isMember ? t('channel.removeAccess') : t('channel.grantAccess')}
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
