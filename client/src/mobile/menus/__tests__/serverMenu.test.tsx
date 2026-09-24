// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode, useState } from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Server, User, PermissionSet } from '@/types';
import { PERMISSIONS } from '@/utils/permissions';
import { useServerStore } from '@/stores/serverStore';
import { useServerMenuItems } from '@/mobile/menus/useServerMenuItems';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, deleteServer: vi.fn(async () => {}) } };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

const owner: User = { id: 'u1' } as User;
const stranger: User = { id: 'u2' } as User;
const server: Server = { id: 's1', name: 'Стая', owner_id: 'u1' } as Server;

const perms = (bits: bigint, isOwner = false): PermissionSet => ({ isOwner, bits, highestPosition: 0 });
const setPerms = (p: PermissionSet | undefined) => {
  useServerStore.setState({ permissions: new Map(p ? [['s1', p]] : []) });
};

const allActions = {
  onCreateChannel: vi.fn(), onSettings: vi.fn(), onInvites: vi.fn(), onStickers: vi.fn(), onDelete: vi.fn(),
};

function Items({ user }: { user: User | null }) {
  const items = useServerMenuItems(server, user, allActions);
  return <ul>{items.map((i) => <li key={i.label} data-danger={String(!!i.danger)}>{i.label}</li>)}</ul>;
}
const labels = () => [...document.querySelectorAll('li')].map((li) => li.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiService.deleteServer).mockReset().mockResolvedValue(undefined);
  useServerStore.setState({ servers: [server] });
  setPerms(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('useServerMenuItems', () => {
  it('gives the owner every action, with delete last and dangerous', () => {
    setPerms(perms(0n, true));
    render(<Items user={owner} />);
    expect(labels().length).toBe(5);
    expect(document.querySelectorAll('li')[4].getAttribute('data-danger')).toBe('true');
  });

  it('hides delete from a non-owner who can manage the server', () => {
    setPerms(perms(PERMISSIONS.MANAGE_SERVER | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.CREATE_INVITE));
    render(<Items user={stranger} />);
    expect(labels().length).toBe(4);
    expect(document.querySelectorAll('li[data-danger="true"]').length).toBe(0);
  });

  it('gives a member with only CREATE_INVITE exactly one item', () => {
    setPerms(perms(PERMISSIONS.CREATE_INVITE));
    render(<Items user={stranger} />);
    expect(labels().length).toBe(1);
  });

  it('gives a member with no permissions no items at all', () => {
    setPerms(perms(0n));
    render(<Items user={stranger} />);
    expect(labels().length).toBe(0);
  });

  it('omits an item whose callback was not supplied', () => {
    setPerms(perms(0n, true));
    function Partial() {
      const items = useServerMenuItems(server, owner, { onSettings: vi.fn() });
      return <ul>{items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>;
    }
    render(<Partial />);
    expect(labels().length).toBe(1);
  });
});

const dangerItem = () => [...document.querySelectorAll('.action-sheet-item')].find((b) => b.classList.contains('is-danger'))!;
const confirmBtn = () => document.querySelector('.confirm-modal .btn-danger') as HTMLButtonElement;

const sheet = (over: Partial<React.ComponentProps<typeof ServerMenuSheet>> = {}) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <ServerMenuSheet server={server} user={owner} open onClose={vi.fn()} onSettings={vi.fn()} {...over} />
  </MemoryRouter>,
);

describe('ServerMenuSheet', () => {
  it('renders the items as an ActionSheet', async () => {
    setPerms(perms(0n, true));
    sheet();
    await act(async () => {});
    expect(document.querySelector('.sheet .action-sheet-item')).not.toBeNull();
  });

  it('deletes only after confirmation and reports the removal', async () => {
    setPerms(perms(0n, true));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    sheet({ onDeleted, onClose });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(apiService.deleteServer).not.toHaveBeenCalled();
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(apiService.deleteServer).toHaveBeenCalledWith('s1');
    expect(onDeleted).toHaveBeenCalledWith('s1');
  });

  it('renders nothing when there is no server', () => {
    sheet({ server: null });
    expect(document.querySelector('.sheet')).toBeNull();
  });

  it('cancelling the confirmation never deletes and reports the end once', async () => {
    setPerms(perms(0n, true));
    const onClose = vi.fn();
    sheet({ onDeleted: vi.fn(), onClose });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    expect(apiService.deleteServer).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render the ActionSheet while the confirmation is open', async () => {
    setPerms(perms(0n, true));
    sheet({ onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    expect(document.querySelector('.sheet')).toBeNull();
  });

  it('sends exactly one DELETE on a double click of the confirm button', async () => {
    setPerms(perms(0n, true));
    let release!: () => void;
    vi.mocked(apiService.deleteServer).mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    sheet({ onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    const btn = confirmBtn();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => { release(); });
    expect(apiService.deleteServer).toHaveBeenCalledTimes(1);
  });

  it('omits the delete item when onDeleted is not passed', async () => {
    setPerms(perms(0n, true));
    sheet();
    await act(async () => {});
    expect(dangerItem()).toBeUndefined();
  });

  it('reports a scrim dismissal once and a successful delete once', async () => {
    setPerms(perms(0n, true));
    const dismissed = vi.fn();
    const first = sheet({ onClose: dismissed });
    await act(async () => {});
    fireEvent.click(document.querySelector('.sheet-overlay') as HTMLElement);
    await act(async () => {});
    expect(dismissed).toHaveBeenCalledTimes(1);
    first.unmount();

    const onClose = vi.fn();
    sheet({ onClose, onDeleted: vi.fn() });
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
    await act(async () => {});
    expect(apiService.deleteServer).toHaveBeenCalledWith('s1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirmation alive when the host nulls its server inside onClose', async () => {
    setPerms(perms(0n, true));
    function Host() {
      const [current, setCurrent] = useState<Server | null>(server);
      return (
        <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
          <ServerMenuSheet server={current} user={owner} open onClose={() => setCurrent(null)} onDeleted={vi.fn()} />
        </MemoryRouter>
      );
    }
    render(<Host />);
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
  });

  const pathState = { pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } };
  function Host({ onClosed, onDeleted }: { onClosed: () => void; onDeleted?: (id: string) => void }) {
    const [current, setCurrent] = useState<Server | null>(server);
    return (
      <MemoryRouter initialEntries={[pathState]}>
        <ServerMenuSheet
          server={current}
          user={owner}
          open={current !== null}
          onClose={() => { onClosed(); setCurrent(null); }}
          onDeleted={onDeleted}
        />
      </MemoryRouter>
    );
  }
  const startDelete = async () => {
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    fireEvent.click(confirmBtn());
  };

  it('failed delete: toast shown, onDeleted skipped, onClose once and only after the toast period', async () => {
    setPerms(perms(0n, true));
    vi.useFakeTimers();
    vi.mocked(apiService.deleteServer).mockReset().mockRejectedValue(new Error('boom'));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    sheet({ onDeleted, onClose });
    await startDelete();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(document.querySelector('.sheet')).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4900); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('failed delete keeps the toast when the host nulls its server inside onClose', async () => {
    setPerms(perms(0n, true));
    vi.useFakeTimers();
    vi.mocked(apiService.deleteServer).mockReset().mockRejectedValue(new Error('boom'));
    const onClosed = vi.fn();
    render(<Host onClosed={onClosed} onDeleted={vi.fn()} />);
    await startDelete();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('.error-toast')).not.toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('cancelling while the DELETE is in flight: one onClose, and a later success still reports the removal', async () => {
    setPerms(perms(0n, true));
    let release!: () => void;
    vi.mocked(apiService.deleteServer).mockReset().mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    sheet({ onDeleted, onClose });
    await startDelete();
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('s1');
    expect(useServerStore.getState().servers.length).toBe(0);
  });

  it('cancelling while the DELETE is in flight: a later failure is silent', async () => {
    setPerms(perms(0n, true));
    let fail!: (e: Error) => void;
    vi.mocked(apiService.deleteServer).mockReset().mockImplementation(() => new Promise<void>((_, rej) => { fail = rej; }));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    sheet({ onDeleted, onClose });
    await startDelete();
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    await act(async () => { fail(new Error('boom')); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(document.querySelector('.error-toast')).toBeNull();
  });

  it('successful delete removes the server from the store', async () => {
    setPerms(perms(0n, true));
    sheet({ onDeleted: vi.fn() });
    await startDelete();
    await act(async () => {});
    expect(useServerStore.getState().servers.length).toBe(0);
  });

  it('shows no action for a member without the needed permission bits', async () => {
    setPerms(perms(0n));
    const onClose = vi.fn();
    sheet({
      user: stranger, onClose, onDeleted: vi.fn(), onCreateChannel: vi.fn(), onInvites: vi.fn(), onStickers: vi.fn(),
    });
    await act(async () => {});
    expect(document.querySelectorAll('.action-sheet-item').length).toBe(0);
  });

  it('ignores permissions granted on a different server', async () => {
    useServerStore.setState({ permissions: new Map([['s2', perms(PERMISSIONS.MANAGE_SERVER | PERMISSIONS.CREATE_INVITE)]]) });
    sheet({ user: stranger, onSettings: vi.fn(), onInvites: vi.fn() });
    await act(async () => {});
    expect(document.querySelectorAll('.action-sheet-item').length).toBe(0);
  });

  it('an empty menu shows no sheet and reports the end exactly once even under StrictMode', async () => {
    setPerms(perms(0n));
    const onClose = vi.fn();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[pathState]}>
          <ServerMenuSheet server={server} user={stranger} open onClose={onClose} onSettings={vi.fn()} />
        </MemoryRouter>
      </StrictMode>,
    );
    await act(async () => {});
    expect(document.querySelector('.sheet')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an empty menu reports again after close and reopen of a kept Body', async () => {
    setPerms(perms(0n));
    const onClose = vi.fn();
    const at = (open: boolean) => (
      <MemoryRouter initialEntries={[pathState]}>
        <ServerMenuSheet server={server} user={stranger} open={open} onClose={onClose} onSettings={vi.fn()} />
      </MemoryRouter>
    );
    const view = render(at(true));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(at(false));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(at(true));
    await act(async () => {});
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('a permission change mid-flow does not report the empty menu before the flow ends', async () => {
    setPerms(perms(0n, true));
    const onClose = vi.fn();
    const at = (u: User) => (
      <MemoryRouter initialEntries={[pathState]}>
        <ServerMenuSheet server={server} user={u} open onClose={onClose} onDeleted={vi.fn()} />
      </MemoryRouter>
    );
    const view = render(at(owner));
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    view.rerender(at(stranger));
    setPerms(perms(0n));
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unmounting during the error state clears the timer: no late onClose', async () => {
    setPerms(perms(0n, true));
    vi.useFakeTimers();
    vi.mocked(apiService.deleteServer).mockReset().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    const view = sheet({ onDeleted: vi.fn(), onClose });
    await startDelete();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(document.querySelector('.error-toast')).not.toBeNull();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a stale in-flight DELETE never fails a newer confirmation (kept Body)', async () => {
    setPerms(perms(0n, true));
    const rejects: Array<(e: Error) => void> = [];
    vi.mocked(apiService.deleteServer).mockReset().mockImplementation(
      () => new Promise<void>((_, rej) => { rejects.push(rej); }),
    );
    const onDeleted = vi.fn();
    sheet({ onDeleted });
    await startDelete();
    fireEvent.click(document.querySelector('.confirm-modal .btn-secondary') as HTMLButtonElement);
    await act(async () => {});
    fireEvent.click(dangerItem());
    await act(async () => {});
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    await act(async () => { rejects[0](new Error('boom')); });
    expect(document.querySelector('.confirm-modal')).not.toBeNull();
    expect(document.querySelector('.error-toast')).toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
