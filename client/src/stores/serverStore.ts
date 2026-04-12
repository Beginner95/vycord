import { create } from 'zustand';
import type { Server, Channel } from '@/types';

interface ServerState {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  setServers: (servers: Server[]) => void;
  setCurrentServer: (server: Server | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: Channel | null) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  currentServer: null,
  channels: [],
  currentChannel: null,

  setServers: (servers) => set({ servers }),
  setCurrentServer: (server) => set({ currentServer: server }),
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
}));
