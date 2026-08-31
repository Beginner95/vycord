import { create } from 'zustand';
import type { Server, Channel, MemberWithUser, PermissionSet } from '@/types';

interface ServerState {
  servers: Server[];
  serversLoaded: boolean;
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  members: MemberWithUser[];
  permissions: Map<string, PermissionSet>;
  setServers: (servers: Server[]) => void;
  setServersLoaded: (loaded: boolean) => void;
  setCurrentServer: (server: Server | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  setMembers: (members: MemberWithUser[]) => void;
  setPermissions: (serverId: string, set: PermissionSet) => void;
  patchMemberAvatar: (userId: string, avatarUrl: string | null) => void;
  patchServer: (id: string, patch: Partial<Server>) => void;
  removeServer: (id: string) => void;
  patchChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
  addChannel: (channel: Channel) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  serversLoaded: false,
  currentServer: null,
  channels: [],
  currentChannel: null,
  members: [],
  permissions: new Map<string, PermissionSet>(),

  setServers: (servers) => set({ servers }),
  setServersLoaded: (loaded) => set({ serversLoaded: loaded }),
  setCurrentServer: (server) => set({ currentServer: server }),
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  setMembers: (members) => set({ members }),
  setPermissions: (serverId, permissionSet) =>
    set((state) => {
      const next = new Map(state.permissions);
      next.set(serverId, permissionSet);
      return { permissions: next };
    }),
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
    set((state) => {
      const permissions = new Map(state.permissions);
      permissions.delete(id);
      return { servers: state.servers.filter((s) => s.id !== id), permissions };
    }),
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
  addChannel: (channel) =>
    set((state) =>
      state.channels.some((c) => c.id === channel.id) ? state : { channels: [...state.channels, channel] }
    ),
}));
