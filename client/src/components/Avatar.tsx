import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/services/api';

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

  return <div className={className}>{username.charAt(0).toUpperCase() || '?'}</div>;
}
