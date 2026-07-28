import { create } from 'zustand';
import type { Server, Channel, MemberWithUser } from '@/types';

interface ServerState {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  members: MemberWithUser[];
  setServers: (servers: Server[]) => void;
  setCurrentServer: (server: Server | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  setMembers: (members: MemberWithUser[]) => void;
  patchMemberAvatar: (userId: string, avatarUrl: string | null) => void;
  patchServer: (id: string, patch: Partial<Server>) => void;
  removeServer: (id: string) => void;
  patchChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  currentServer: null,
  channels: [],
  currentChannel: null,
  members: [],

  setServers: (servers) => set({ servers }),
  setCurrentServer: (server) => set({ currentServer: server }),
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  setMembers: (members) => set({ members }),
  patchMemberAvatar: (userId, avatarUrl) =>
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId ? { ...m, avatar_url: avatarUrl ?? undefined } : m
      ),
    })),
  patchServer: (id, patch) =>
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      currentServer:
        state.currentServer?.id === id ? { ...state.currentServer, ...patch } : state.currentServer,
    })),
  removeServer: (id) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
    })),
  patchChannel: (id, patch) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      currentChannel:
        state.currentChannel?.id === id ? { ...state.currentChannel, ...patch } : state.currentChannel,
    })),
  removeChannel: (id) =>
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== id),
    })),
}));
