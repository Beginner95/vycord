import { useEffect, useState } from 'react';

interface AvatarProps {
  url?: string;
  username: string;
  className: string;
}

export function Avatar({ url, username, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return <img className={className} src={url} alt={username} onError={() => setFailed(true)} />;
  }

  return <div className={className}>{username.charAt(0).toUpperCase() || '?'}</div>;
}
