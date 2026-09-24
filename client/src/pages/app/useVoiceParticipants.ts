import { useEffect, useState } from 'react';
import { wsService } from '@/services/websocket';

/** voice_state / voice_participants → channelId → userIds (перенесено из AppPage). */
export function useVoiceParticipants(): Map<string, string[]> {
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    const unsubState = wsService.on('voice_state', (payload) => {
      const p = payload as { channels: Record<string, string[]> };
      setVoiceParticipants(new Map(Object.entries(p.channels ?? {})));
    });
    const unsubParticipants = wsService.on('voice_participants', (payload) => {
      const p = payload as { channel_id: string; user_ids: string[] };
      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (p.user_ids.length === 0) {
          next.delete(p.channel_id);
        } else {
          next.set(p.channel_id, p.user_ids);
        }
        return next;
      });
    });
    return () => { unsubState(); unsubParticipants(); };
  }, []);

  return voiceParticipants;
}
