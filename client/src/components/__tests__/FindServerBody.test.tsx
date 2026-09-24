// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { FindServerBody } from '@/components/FindServerBody';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      searchServers: vi.fn(async () => [{ id: 's9', name: 'Найденный' }]),
      previewInvite: vi.fn(async () => { throw new Error('404'); }),
      joinViaInvite: vi.fn(async () => ({ id: 's9', name: 'Найденный' })),
    },
  };
});
import { apiService } from '@/services/api';

afterEach(cleanup);

describe('FindServerBody', () => {
  it('debounces the query and lists what the search returned', async () => {
    render(<FindServerBody active onJoinServer={vi.fn()} onServerJoined={vi.fn()} onDone={vi.fn()} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    expect(apiService.searchServers).not.toHaveBeenCalled();
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(apiService.searchServers).toHaveBeenCalledWith('най');
    expect(document.querySelector('.find-server-row')?.textContent).toContain('Найденный');
  });

  it('joins a found server and finishes', async () => {
    const onJoinServer = vi.fn();
    const onDone = vi.fn();
    render(<FindServerBody active onJoinServer={onJoinServer} onServerJoined={vi.fn()} onDone={onDone} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    fireEvent.click(document.querySelector('.find-server-row .btn-primary')!);
    expect(onJoinServer).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('does not search while inactive', async () => {
    vi.mocked(apiService.searchServers).mockClear();
    render(<FindServerBody active={false} onJoinServer={vi.fn()} onServerJoined={vi.fn()} onDone={vi.fn()} onCreateServer={vi.fn()} />);
    fireEvent.change(document.querySelector('input')!, { target: { value: 'най' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(apiService.searchServers).not.toHaveBeenCalled();
  });
});
