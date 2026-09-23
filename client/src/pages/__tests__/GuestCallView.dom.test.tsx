// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { GuestCallView } from '../GuestCallView';
import { useCallStore } from '@/stores/callStore';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { stubBrowser } from '@/components/__tests__/callHarness';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    localStreamState: null, screenStreamState: null,
    toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(),
    stopScreenShare: vi.fn(), startScreenShare: vi.fn(),
    watchShare: vi.fn(), unwatchShare: vi.fn(),
  },
}));
vi.mock('@/services/callBus', () => ({
  callBus: { send: vi.fn(), on: vi.fn(() => () => {}) },
  setCallTransport: vi.fn(),
  getCallTransport: vi.fn(() => 'account'),
}));

beforeAll(() => {
  stubBrowser();
  // Mock scrollTo for HTMLElement refs in GuestChatBody
  Element.prototype.scrollTo = vi.fn();
});

const messages = [
  {
    id: 'm1', content: 'привет всем', created_at: '2026-09-23T10:00:00Z',
    author: { kind: 'guest' as const, guest_id: 'g1', display_name: 'Аня' },
  },
  {
    id: 'm2', content: 'привет!', created_at: '2026-09-23T10:01:00Z',
    author: { kind: 'user' as const, user_id: 'u2', username: 'boris' },
  },
];

beforeEach(() => {
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [], directory: {}, guestSelf: { id: 'g1', display_name: 'Аня' } as never,
  });
  useGuestCallStore.setState({
    phase: 'in_call', guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    preview: { server_name: 's', channel_name: 'general', participant_count: 2 },
    participants: {
      users: [{ user_id: 'u2', username: 'boris', avatar_url: undefined }],
      guests: [{ id: 'g1', display_name: 'Аня' }],
    },
    messages,
    chatUnread: 0,
  } as never);
});
afterEach(() => {
  cleanup();
  useCallStore.getState().reset();
  useGuestCallStore.getState().reset();
});

const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/GuestCallView.${name}.html`);

describe('GuestCallView DOM (desktop parity, снято до VYC-95 этапа 6)', () => {
  it('панель «Чат» открыта', async () => {
    // По title, не по индексу .stage-ctl-btn: CallStage сам рендерит
    // .stage-ctl-btn для мика/камеры/демонстрации/гостей раньше extraControls,
    // так что querySelectorAll(...)[0] попал бы на кнопку мика.
    const { getByTitle } = render(<GuestCallView />);
    fireEvent.click(getByTitle('Чат'));
    await snap('chat');
  });
  it('панель «Участники» открыта', async () => {
    const { getByTitle } = render(<GuestCallView />);
    fireEvent.click(getByTitle('Участники'));
    await snap('participants');
  });
});
