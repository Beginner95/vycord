import type { Screen, Stack } from './types';

export interface NavSnapshot {
  serversLoaded: boolean;
  serverIds: ReadonlySet<string>;
  currentServerId: string | null;
  channels: readonly { id: string; server_id: string }[];
  currentChannelId: string | null;
  callActive: boolean;
}

export type SyncAction =
  | { type: 'selectServer'; serverId: string }
  | { type: 'selectChannel'; channelId: string }
  | null;

const serverOf = (s: Screen): string | null =>
  s.kind === 'channels' || s.kind === 'serverSettings' || s.kind === 'invites' || s.kind === 'stickers'
    ? s.serverId : null;

const channelOf = (s: Screen): string | null =>
  s.kind === 'chat' || s.kind === 'channelInfo' ? s.channelId : null;

/** Спека §3.3: экран — из стека, данные — из serverStore. Чистая функция:
 *  MobileShell применяет результат (replace стека / вызов контроллера). */
export function reconcile(stack: Stack, snap: NavSnapshot): { stack: Stack; action: SyncAction } {
  let serverCtx: string | null = null;
  let cut = stack.length;

  for (let i = 1; i < stack.length; i++) {
    const s = stack[i];
    const sid = serverOf(s);
    if (sid) {
      if (snap.serversLoaded && !snap.serverIds.has(sid)) { cut = i; break; }
      serverCtx = sid;
      continue;
    }
    const cid = channelOf(s);
    if (cid) {
      if (!serverCtx) { cut = i; break; }
      if (snap.currentServerId === serverCtx) {
        const loaded = snap.channels.filter((c) => c.server_id === serverCtx);
        if (loaded.length > 0 && !loaded.some((c) => c.id === cid)) { cut = i; break; }
      }
      continue;
    }
    if (s.kind === 'call' && !snap.callActive) { cut = i; break; }
  }

  const next = cut === stack.length ? stack : stack.slice(0, cut);

  let deepestServer: string | null = null;
  let topChannel: string | null = null;
  for (const s of next) {
    deepestServer = serverOf(s) ?? deepestServer;
    topChannel = channelOf(s) ?? topChannel;
  }

  let action: SyncAction = null;
  if (deepestServer && snap.serversLoaded && snap.currentServerId !== deepestServer) {
    action = { type: 'selectServer', serverId: deepestServer };
  } else if (
    topChannel && deepestServer === snap.currentServerId && snap.currentChannelId !== topChannel &&
    snap.channels.some((c) => c.id === topChannel && c.server_id === deepestServer)
  ) {
    action = { type: 'selectChannel', channelId: topChannel };
  }
  return { stack: next, action };
}
