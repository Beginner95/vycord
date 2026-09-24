import { vi } from 'vitest';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import type { AppController } from '@/pages/app/useAppController';
import type { MobileNav } from '@/mobile/nav/useMobileNav';

/** Общие фикстуры тестов мобильных экранов (задачи 5, 6, 12). */
export const user: User = { id: 'u1', username: 'anna', email: 'anna@example.com' } as User;
export const s1: Server = { id: 's1', name: 'Волчья стая', owner_id: 'u1' } as Server;
export const s2: Server = { id: 's2', name: 'Тихий омут', owner_id: 'u9', is_private: true } as Server;
export const ch: Channel = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
export const members: MemberWithUser[] = [{ user_id: 'u2', username: 'Борис' } as MemberWithUser];

export const nav = (): MobileNav => ({
  stack: [{ kind: 'servers' }], top: { kind: 'servers' }, tab: 'servers', valid: true,
  push: vi.fn(), pushMany: vi.fn(), back: vi.fn(), replaceStack: vi.fn(), switchTab: vi.fn(),
});

export const controller = (over: Partial<AppController> = {}): AppController => ({
  user, servers: [s1, s2], currentServer: s1, channels: [ch], currentChannel: null, members,
  pendingCount: 0, voiceParticipants: new Map(), callNotif: null,
  selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
  joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
  joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
  joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(), subscribe: () => () => {},
  ui: {
    findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
    createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
  },
  ...over,
});
