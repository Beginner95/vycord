import { describe, it, expect, vi, beforeEach } from 'vitest';

function fakeMedia(paused: boolean) {
  return { paused, pause: vi.fn() } as unknown as HTMLMediaElement;
}

describe('notifyPlaying', () => {
  // Модуль — синглтон с состоянием на уровне модуля, поэтому каждый тест
  // подключает его заново через resetModules — иначе тесты делят один "current".
  let notifyPlaying: typeof import('../chatMediaCoordinator').notifyPlaying;

  beforeEach(async () => {
    vi.resetModules();
    ({ notifyPlaying } = await import('../chatMediaCoordinator'));
  });

  it('останавливает предыдущий проигрывающийся элемент', () => {
    const first = fakeMedia(false);
    const second = fakeMedia(false);

    notifyPlaying(first);
    notifyPlaying(second);

    expect(first.pause).toHaveBeenCalledTimes(1);
  });

  it('не трогает элемент, который уже на паузе', () => {
    const first = fakeMedia(true);
    const second = fakeMedia(false);

    notifyPlaying(first);
    notifyPlaying(second);

    expect(first.pause).not.toHaveBeenCalled();
  });

  it('повторный вызов на том же элементе не паузит сам себя', () => {
    const el = fakeMedia(false);

    notifyPlaying(el);
    notifyPlaying(el);

    expect(el.pause).not.toHaveBeenCalled();
  });
});
