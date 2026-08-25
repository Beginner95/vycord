import type { Channel } from '@/types';

// «в голосовом · X» в списке участников: находит канал, в чьей голосовой
// сессии состоит пользователь. Сервер не пускает в две сессии сразу —
// первое совпадение единственное.
export function voiceChannelNameFor(
  userId: string,
  voiceParticipants: Map<string, string[]> | undefined,
  channels: Channel[],
): string | null {
  if (!voiceParticipants) return null;
  for (const [channelId, userIds] of voiceParticipants) {
    if (userIds.includes(userId)) {
      return channels.find((c) => c.id === channelId)?.name ?? null;
    }
  }
  return null;
}
