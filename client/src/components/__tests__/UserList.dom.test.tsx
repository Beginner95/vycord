// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { UserList } from '../UserList';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { useLocaleStore } from '@/stores/localeStore';
import { PERMISSIONS } from '@/utils/permissions';
import { channel, fixedNow, me, normalizeHtml, serverA, stubBrowser } from './chatHarness';
import type { MemberWithUser, PermissionSet } from '@/types';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2', username: 'boris' }]),
      getLastSeenBatch: vi.fn(async () => ({
        u3: { last_seen_at: '2026-09-20T11:30:00Z', visible: true },
        u4: { last_seen_at: null, visible: false },
      })),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

beforeAll(stubBrowser);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(fixedNow);
  useLocaleStore.setState({ locale: 'ru' });
  useAuthStore.setState({ user: me });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const member = (user_id: string, username: string): MemberWithUser => ({ user_id, username, roles: [], joined_at: '' });
const members = [member('u2', 'boris'), member('u3', 'clara'), member('u4', 'dmitry')];

/** Чужой сервер (владелец не me), чтобы карточка приглашения зависела только от права. */
const foreign = { ...serverA, owner_id: 'u2' };
const perms = (bits: bigint): PermissionSet => ({ isOwner: false, bits, highestPosition: 0 });
const seed = (bits: bigint) => useServerStore.setState({
  currentServer: foreign, servers: [foreign], members, channels: [channel],
  permissions: new Map([[foreign.id, perms(bits)]]),
});

const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/UserList.${name}.html`);
const mount = async () => {
  const utils = render(<UserList onMobileBack={vi.fn()} voiceParticipants={new Map([['c1', ['u2']]])} />);
  await act(async () => {});
  return utils;
};

describe('UserList DOM (desktop parity, снято до VYC-95 этапа 3)', () => {
  it('members with invite card (CREATE_INVITE)', async () => { seed(PERMISSIONS.CREATE_INVITE); await mount(); await snap('with-invite'); });
  it('members without invite card', async () => { seed(0n); await mount(); await snap('no-invite'); });
});
