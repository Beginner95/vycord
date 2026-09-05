import { useState } from 'react';
import { apiService, apiErrorText } from '@/services/api';
import { useFriendStore } from '@/stores/friendStore';
import { useT } from '@/i18n';

export function AddFriendForm() {
  const t = useT();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const load = useFriendStore((s) => s.load);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = username.trim();
    if (!value) return;

    setStatus('sending');
    try {
      const res = await apiService.sendFriendRequest(value);
      setStatus('ok');
      setMessage(res.status === 'accepted' ? t('friends.addAccepted') : t('friends.addSent'));
      setUsername('');
      await load();
    } catch (err) {
      setStatus('error');
      // apiErrorText looks up errors.<code> itself (e.g. friend_self,
      // friend_request_exists, already_friends, interaction_forbidden) and
      // falls back to errors.unknown when the code is missing/unrecognised —
      // it must receive `t` itself, not an already-resolved string.
      setMessage(apiErrorText(err, t));
    }
  };

  return (
    <form className="add-friend-form" onSubmit={submit}>
      <label className="add-friend-label" htmlFor="add-friend-input">{t('friends.addTitle')}</label>
      <div className="add-friend-row">
        <input
          id="add-friend-input"
          className="input"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setStatus('idle'); }}
          placeholder={t('friends.addPlaceholder')}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={status === 'sending' || !username.trim()}>
          {t('friends.addSubmit')}
        </button>
      </div>
      {status !== 'idle' && status !== 'sending' && (
        <p className={`add-friend-msg is-${status}`} role="status">{message}</p>
      )}
    </form>
  );
}
