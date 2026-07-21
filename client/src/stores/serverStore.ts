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
}));
