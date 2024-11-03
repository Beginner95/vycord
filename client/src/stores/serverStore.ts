import { create } from 'zustand';
import type { Server, Channel } from '@/types';

const LAST_CHANNEL_KEY = 'discrod_last_channel';
const LAST_SERVER_KEY = 'discrod_last_server';

function getStoredChannel(): { serverId: string; channelId: string } | null {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getStoredServer(): { serverId: string } | null {
  try {
    const raw = localStorage.getItem(LAST_SERVER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface ServerState {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  setServers: (servers: Server[]) => void;
  setCurrentServer: (server: Server | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  getLastChannel: () => { serverId: string; channelId: string } | null;
  getLastServer: () => { serverId: string } | null;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  currentServer: null,
  channels: [],
  currentChannel: null,

  setServers: (servers) => set({ servers }),
  setCurrentServer: (server) => {
    if (server) {
      localStorage.setItem(LAST_SERVER_KEY, JSON.stringify({ serverId: server.id }));
    }
    set({ currentServer: server });
  },
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => {
    if (channel) {
      localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({
        serverId: channel.server_id,
        channelId: channel.id,
      }));
    }
    set({ currentChannel: channel });
  },

  // Restore last visited channel
  getLastChannel: getStoredChannel,
  getLastServer: getStoredServer,
}));
