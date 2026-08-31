import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { API_BASE_URL } from '@/services/api';
import { avatarColor } from '@/utils/avatarColor';

interface AvatarProps {
  url?: string;
  username: string;
  className: string;
}

function resolveAvatarUrl(url: string): string {
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

export function Avatar({ url, username, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return <img className={className} src={resolveAvatarUrl(url)} alt={username} onError={() => setFailed(true)} />;
  }

  return (
    <div
      className={className}
      style={
        {
          '--avatar-color': avatarColor(username),
          background: 'var(--avatar-bg, var(--avatar-color))',
          color: 'var(--avatar-ink, #FFFFFF)',
          fontWeight: 700,
        } as CSSProperties
      }
    >
      {username.charAt(0).toUpperCase() || '?'}
    </div>
  );
}
