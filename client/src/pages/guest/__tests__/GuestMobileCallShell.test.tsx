// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GuestMobileCallShell } from '../GuestMobileCallShell';
import { useCallStore } from '@/stores/callStore';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { stubBrowser, participant } from '@/components/__tests__/callHarness';

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
  // GuestChatScreen -> GuestChatBody calls .scrollTo() in a useEffect; jsdom
  // has no implementation (same polyfill as GuestCallView.dom.test.tsx).
  Element.prototype.scrollTo = vi.fn();
});

beforeEach(() => {
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [], directory: {}, guestSelf: { id: 'g1', display_name: 'Аня' } as never,
  });
  useGuestCallStore.setState({
    phase: 'in_call', guestId: 'g1', displayName: 'Аня', roomId: 'c1',
    participants: { users: [], guests: [{ id: 'g1', display_name: 'Аня' }] },
    messages: [], chatUnread: 0,
  } as never);
});
afterEach(() => {
  cleanup();
  useCallStore.getState().reset();
  useGuestCallStore.getState().reset();
});

const mount = () => render(<MemoryRouter><GuestMobileCallShell /></MemoryRouter>);

// Удалённый поток: jsdom не реализует srcObject, но присваивание всё равно
// оседает на элементе обычным свойством — этого достаточно, чтобы сравнивать
// по ссылке (как и делает сам useCallStageModel).
const fakeStream = {
  id: 's-u2',
  getAudioTracks: () => [],
  getVideoTracks: () => [],
} as unknown as MediaStream;

/** Все <video>, к которым сейчас привязан удалённый поток (звук идёт из них). */
const remoteVideos = () =>
  [...document.querySelectorAll('video')].filter((v) => (v as HTMLVideoElement).srcObject === fakeStream);

describe('GuestMobileCallShell', () => {
  it('открывает чат по кнопке в панели и возвращается назад', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Открыть чат'));
    expect(screen.getByText('Чат')).toBeTruthy(); // ScreenHeader title — см. Task 5's GuestChatScreen
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(screen.queryByText('Чат')).toBeFalsy(); // снова сцена звонка, не экран чата
  });

  it('показывает спиннер, пока phase не in_call', () => {
    useGuestCallStore.setState({ phase: 'connecting' } as never);
    mount();
    expect(screen.getByText('Подключаемся…')).toBeTruthy();
    expect(screen.queryByLabelText('Открыть чат')).toBeFalsy();
  });

  it('C1: чат открыт и закрыт — удалённое <video> не размонтировано и держит поток (иначе гость немеет до конца звонка)', () => {
    useCallStore.setState({ participants: [participant('u2', { stream: fakeStream })] });
    mount();
    const before = remoteVideos();
    expect(before.length).toBe(1);

    fireEvent.click(screen.getByLabelText('Открыть чат'));
    expect(screen.getByText('Чат')).toBeTruthy();
    // Пока чат открыт, слой звонка только спрятан — элемент жив и играет.
    expect(remoteVideos()).toEqual(before);
    expect(before[0].isConnected).toBe(true);
    expect(document.querySelector('.guest-mobile-call-layer')!.classList.contains('is-hidden')).toBe(true);

    fireEvent.click(screen.getByLabelText('Назад'));
    expect(screen.queryByText('Чат')).toBeFalsy();
    // Тот же самый элемент (не перемонтирован) и поток всё ещё привязан.
    const after = remoteVideos();
    expect(after.length).toBe(1);
    expect(after[0]).toBe(before[0]);
    expect(document.querySelector('.guest-mobile-call-layer')!.classList.contains('is-hidden')).toBe(false);
  });

  it('C1: то же для ростера участников', () => {
    useCallStore.setState({ participants: [participant('u2', { stream: fakeStream })] });
    mount();
    const before = remoteVideos();
    expect(before.length).toBe(1);
    fireEvent.click(screen.getByLabelText('Участники'));
    expect(document.querySelector('.guest-participants-screen')).toBeTruthy();
    expect(remoteVideos()).toEqual(before);
    fireEvent.click(screen.getByLabelText('Назад'));
    expect(document.querySelector('.guest-participants-screen')).toBeNull();
    expect(remoteVideos()[0]).toBe(before[0]);
  });

  it('I1: у гостя нет шеврона «свернуть» (он завершал бы сессию)', () => {
    const leave = vi.fn(async () => {});
    useGuestCallStore.setState({ leave } as never);
    mount();
    expect(screen.queryByLabelText('Свернуть звонок')).toBeNull();
    expect(document.querySelector('.mcs-collapse-btn')).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it('M1: засевает стек навигации корнем guestCall при монтировании', () => {
    let state: unknown = undefined;
    function LocationProbe() {
      state = useLocation().state;
      return null;
    }
    render(<MemoryRouter><GuestMobileCallShell /><LocationProbe /></MemoryRouter>);
    expect((state as { m?: unknown } | null)?.m).toEqual([{ kind: 'guestCall' }]);
  });
});
