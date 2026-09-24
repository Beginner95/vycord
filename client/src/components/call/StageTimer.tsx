import { useState, useEffect } from 'react';
import { useCallStore } from '@/stores/callStore';
import { formatCallDuration } from '@/utils/callStage';

// ─── Stage Timer ─────────────────────────────────────────────────────────────
// Board 1e's «В ЭФИРЕ 12:04». Lives in the live pill and ticks once a second;
// `startedAt` survives a reconnect on purpose (callStore.onReconnected does not
// touch it), so the elapsed time keeps counting through a blip.

export function StageTimer() {
  const startedAt = useCallStore((s) => s.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{formatCallDuration(now - (startedAt ?? now))}</>;
}
