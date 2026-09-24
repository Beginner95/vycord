// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CreateServerScreen } from '@/mobile/screens/CreateServerScreen';

afterEach(cleanup);

const mount = (createServer: (n: string, p: boolean) => Promise<void>, back = vi.fn()) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <CreateServerScreen onCreate={createServer} onBack={back} />
  </MemoryRouter>,
);

describe('CreateServerScreen', () => {
  it('submits the trimmed name and the privacy flag', async () => {
    const createServer = vi.fn(async () => {});
    mount(createServer);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: '  Стая  ' } });
    fireEvent.click(document.querySelector('input[type="checkbox"]')!);
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(createServer).toHaveBeenCalledWith('Стая', true);
  });

  it('keeps the screen and shows the error when creation fails', async () => {
    const createServer = vi.fn(async () => { throw new Error('boom'); });
    const back = vi.fn();
    mount(createServer, back);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: 'X' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(document.querySelector('.modal-error')).not.toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it('renders its primary button inside the form (so type=submit submits)', () => {
    mount(vi.fn(async () => {}));
    expect(document.querySelector('form .form-screen-actions .btn-primary')).not.toBeNull();
  });

  it('disables the primary button while the name is empty and enables it once typed', () => {
    mount(vi.fn(async () => {}));
    const btn = document.querySelector<HTMLButtonElement>('form .form-screen-actions .btn-primary')!;
    expect(btn.disabled).toBe(true);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: 'X' } });
    expect(btn.disabled).toBe(false);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: '   ' } });
    expect(btn.disabled).toBe(true);
  });

  it('does not call onCreate when the name is empty or whitespace', async () => {
    const createServer = vi.fn(async () => {});
    mount(createServer);
    fireEvent.submit(document.querySelector('form')!);
    fireEvent.change(document.querySelector('input[type="text"]')!, { target: { value: '   ' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(createServer).not.toHaveBeenCalled();
  });

  it('clears the error message as soon as the user types again', async () => {
    const createServer = vi.fn(async () => { throw new Error('boom'); });
    mount(createServer);
    const input = document.querySelector('input[type="text"]')!;
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {});
    expect(document.querySelector('.modal-error')).not.toBeNull();
    fireEvent.change(input, { target: { value: 'XY' } });
    expect(document.querySelector('.modal-error')).toBeNull();
  });
});
