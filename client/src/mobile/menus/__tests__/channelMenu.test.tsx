// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Channel, PermissionSet } from '@/types';
import { PERMISSIONS } from '@/utils/permissions';
import { useServerStore } from '@/stores/serverStore';
import { useChannelMenuItems } from '@/mobile/menus/useChannelMenuItems';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteChannel: vi.fn(async () => {}), updateChannel: vi.fn(async () => ({})) } };
});
import { apiService } from '@/services/api';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const channel: Channel = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
const NEW_NAME = 'новое-имя';
const other: Channel = { ...channel, id: 'c2', name: 'флудилка', position: 1 };
const perms = (bits: bigint): PermissionSet => ({ isOwner: false, bits, highestPosition: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  useServerStore.setState({
    permissions: new Map([['s1', perms(PERMISSIONS.MANAGE_CHANNELS)]]),
    channels: [channel, other],
  });
});

function Items({ canManage, isLast }: { canManage: boolean; isLast: boolean }) {
  const items = useChannelMenuItems({ canManage, isLast, onRename: vi.fn(), onDelete: vi.fn() });
  return (
    <ul>
      {items.map((i) => (
        <li key={i.label} data-disabled={String(!!i.disabled)} data-reason={i.disabledReason ?? ''}>{i.label}</li>
      ))}
    </ul>
  );
}

describe('useChannelMenuItems', () => {
  it('gives rename and delete to a manager', () => {
    render(<Items canManage isLast={false} />);
    expect(document.querySelectorAll('li').length).toBe(2);
    expect(document.querySelectorAll('li')[1].getAttribute('data-disabled')).toBe('false');
  });

  it('disables delete for the last channel and says why', () => {
    render(<Items canManage isLast />);
    const del = document.querySelectorAll('li')[1];
    expect(del.getAttribute('data-disabled')).toBe('true');
    expect(del.getAttribute('data-reason')).not.toBe('');
  });

  it('gives a member without MANAGE_CHANNELS nothing', () => {
    render(<Items canManage={false} isLast={false} />);
    expect(document.querySelectorAll('li').length).toBe(0);
  });
});

const dangerItem = () => [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
const confirmBtn = () => document.querySelector('.confirm-modal .btn-danger') as HTMLButtonElement;

const sheet = (over: Partial<React.ComponentProps<typeof ChannelMenuSheet>> = {}) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ChannelMenuSheet channel={channel} serverId="s1" channelCount={2} open onClose={vi.fn()} {...over} />
  </MemoryRouter>,
);

describe('ChannelMenuSheet', () => {
  it('deletes after confirmation', async () => {
    const onDeleted = vi.fn();
    sheet({ onDeleted });
    await act(async () => {});
    const del = dangerItem();
    fireEvent.click(del);
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(apiService.deleteChannel).toHaveBeenCalledWith('s1', 'c1');
    expect(onDeleted).toHaveBeenCalledWith('c1');
  });

  it('refuses to delete the last channel even if the list shrank while the sheet was open', async () => {
    sheet({ channelCount: 1, onDeleted: vi.fn() });
    await act(async () => {});
    const del = dangerItem();
    expect(del.hasAttribute('disabled')).toBe(true);
    expect(apiService.deleteChannel).not.toHaveBeenCalled();
  });

  it('opens the rename modal', async () => {
    sheet();
    await act(async () => {});
    const rename = document.querySelectorAll('.action-sheet-item')[0] as HTMLButtonElement;
    fireEvent.click(rename);
    await act(async () => {});
    expect(document.querySelector('.modal-overlay .modal')).not.toBeNull();
  });

  it('refuses at delete time when the store shrank to one channel after the sheet opened', async () => {
    const onDeleted = vi.fn();
    sheet({ onDeleted });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    act(() => { useServerStore.setState({ channels: [channel] }); });
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(apiService.deleteChannel).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(document.querySelector('.error-toast')).not.toBeNull();
  });

  it('does not tell the parent the sheet closed when an item starts a flow, and reports the flow end once', async () => {
    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.modal-actions .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a plain dismissal (scrim) once', async () => {
    const onClose = vi.fn();
    sheet({ onClose });
    await act(async () => {});
    fireEvent.click(document.querySelector('.sheet-overlay') as HTMLElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reports cancelling the confirmation once', async () => {
    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiService.deleteChannel).not.toHaveBeenCalled();
  });

  it('shows nothing to a member without MANAGE_CHANNELS and reports the close once', async () => {
    useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    expect(document.querySelectorAll('.action-sheet-item').length).toBe(0);
    expect(document.querySelector('.sheet')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores MANAGE_CHANNELS granted on a different server', async () => {
    useServerStore.setState({ permissions: new Map([['s2', perms(PERMISSIONS.MANAGE_CHANNELS)]]) });
    sheet({ onDeleted: vi.fn() });
    await act(async () => {});
    expect(document.querySelectorAll('.action-sheet-item').length).toBe(0);
  });

  it('reports an empty menu once even under StrictMode', async () => {
    useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
    const onClose = vi.fn();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
          <ChannelMenuSheet channel={channel} serverId="s1" channelCount={2} open onClose={onClose} onDeleted={vi.fn()} />
        </MemoryRouter>
      </StrictMode>,
    );
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides delete when onDeleted is not passed', async () => {
    sheet();
    await act(async () => {});
    expect(dangerItem()).toBeUndefined();
  });

  it('on success removes the channel from the store and reports close once', async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    sheet({ onClose, onDeleted });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(useServerStore.getState().channels.map((c) => c.id)).toEqual(['c2']);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('a rejected delete shows the toast, skips onDeleted and reports close once only after the toast period', async () => {
    vi.useFakeTimers();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    sheet({ onClose, onDeleted });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(document.querySelector('.action-sheet-item')).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('the last-channel refusal at delete time follows the same toast-then-close flow', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    act(() => { useServerStore.setState({ channels: [channel] }); });
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the toast visible when the host unmounts the entity in onClose (regression: toast died with the menu)', async () => {
    vi.useFakeTimers();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const hostClose = vi.fn();
    function Host() {
      const [x, setX] = useState<Channel | null>(channel);
      return (
        <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
          <ChannelMenuSheet
            channel={x}
            serverId="s1"
            channelCount={2}
            open={x !== null}
            onClose={() => { hostClose(); setX(null); }}
            onDeleted={vi.fn()}
          />
        </MemoryRouter>
      );
    }
    render(<Host />);
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(hostClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(hostClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('cancelling while the DELETE is in flight reports close once; a later success still calls onDeleted', async () => {
    let resolve!: () => void;
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    sheet({ onClose, onDeleted });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('c1');
    expect(useServerStore.getState().channels.map((c) => c.id)).toEqual(['c2']);
  });

  it('cancelling while the DELETE is in flight, then a failure: nothing visible, close still once', async () => {
    let reject!: (e: Error) => void;
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r; }));
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    sheet({ onClose, onDeleted });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    await act(async () => { reject(new Error('boom')); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('a rename that settles after the user dismissed the modal reports close exactly once (N1)', async () => {
    let resolve!: (c: Channel) => void;
    (apiService.updateChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.updateChannel as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<Channel>((r) => { resolve = r; }),
    );
    const hostClose = vi.fn();
    function Host() {
      const [x, setX] = useState<Channel | null>(channel);
      return (
        <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
          <ChannelMenuSheet
            channel={x}
            serverId="s1"
            channelCount={2}
            open={x !== null}
            onClose={() => { hostClose(); setX(null); }}
          />
        </MemoryRouter>
      );
    }
    render(<Host />);
    await act(async () => {});
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    await act(async () => {});
    fireEvent.change(document.querySelector('#edit-channel-name') as HTMLInputElement, { target: { value: NEW_NAME } });
    fireEvent.submit(document.querySelector('.modal form') as HTMLFormElement);
    await act(async () => {});
    expect(apiService.updateChannel).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.modal-overlay') as HTMLElement);
    await act(async () => {});
    expect(hostClose).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ...channel, name: NEW_NAME }); });
    expect(hostClose).toHaveBeenCalledTimes(1);
  });

  it('a stale DELETE rejection does not replace a newer confirm modal (flowSeq guard, M2)', async () => {
    let reject!: (e: Error) => void;
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<void>((_, r) => { reject = r; }));
    // Хост, который только держит open=true и сущность смонтированной.
    sheet({ onClose: vi.fn(), onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    await act(async () => { reject(new Error('boom')); });
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('unmounting during the error state clears the timer: no late onClose (M3)', async () => {
    vi.useFakeTimers();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.deleteChannel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const onClose = vi.fn();
    const view = sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(document.querySelector('.error-toast')).not.toBeNull();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('re-reports an empty menu after close then reopen on the same Body (M4)', async () => {
    useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) });
    const onClose = vi.fn();
    const tree = (open: boolean) => (
      <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
        <ChannelMenuSheet channel={channel} serverId="s1" channelCount={2} open={open} onClose={onClose} onDeleted={vi.fn()} />
      </MemoryRouter>
    );
    const view = render(tree(true));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(tree(false));
    await act(async () => {});
    view.rerender(tree(true));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a stale rename settling during a NEWER rename does not close it (seq half of closeRename, C2)', async () => {
    let resolve!: (c: Channel) => void;
    (apiService.updateChannel as ReturnType<typeof vi.fn>).mockReset();
    (apiService.updateChannel as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<Channel>((r) => { resolve = r; }),
    );
    const onClose = vi.fn();
    sheet({ onClose });
    await act(async () => {});
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    await act(async () => {});
    fireEvent.change(document.querySelector('#edit-channel-name') as HTMLInputElement, { target: { value: NEW_NAME } });
    fireEvent.submit(document.querySelector('.modal form') as HTMLFormElement);
    await act(async () => {});
    fireEvent.click(document.querySelector('.modal-overlay') as HTMLElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    // Хост держит open=true: sheet вернулся, открываем второе переименование.
    fireEvent.click(document.querySelectorAll('.action-sheet-item')[0]);
    await act(async () => {});
    expect(document.querySelector('.modal-overlay .modal')).not.toBeNull();
    await act(async () => { resolve({ ...channel, name: NEW_NAME }); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.modal-overlay .modal')).not.toBeNull();
  });

  it('permissions vanishing while the confirm is open do not report the empty menu before the flow ends (C5)', async () => {
    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    act(() => { useServerStore.setState({ permissions: new Map([['s1', perms(0n)]]) }); });
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
