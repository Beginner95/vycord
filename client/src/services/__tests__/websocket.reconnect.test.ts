import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wsService } from '@/services/websocket';
import { mockSockets } from '@/test/setup';

describe('websocket reconnect backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // потолок задержки, чтобы рост был виден
    wsService.disconnect();
  });

  afterEach(() => {
    wsService.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('наращивает задержку, когда соединение умирает сразу после открытия', () => {
    const delays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    wsService.connect('token');

    // Пять циклов «открылось и тут же оборвалось» — ровно то, что делает вытеснение.
    for (let i = 0; i < 5; i++) {
      const socket = mockSockets[mockSockets.length - 1];
      socket.emitOpen();
      socket.emitClose(1006);
      const call = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      delays.push(call[1] as number);
      vi.advanceTimersByTime((call[1] as number) + 1);
    }

    // Первая задержка — до 1 c, пятая — как минимум на порядок больше.
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[4]).toBeGreaterThan(delays[0] * 8);
  });

  it('обнуляет счётчик, когда соединение проработало дольше порога', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    wsService.connect('token');
    for (let i = 0; i < 3; i++) {
      const socket = mockSockets[mockSockets.length - 1];
      socket.emitOpen();
      socket.emitClose(1006);
      const call = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      vi.advanceTimersByTime((call[1] as number) + 1);
    }

    // Здоровое соединение: открылось, прожило минуту, оборвалось.
    const healthy = mockSockets[mockSockets.length - 1];
    healthy.emitOpen();
    vi.advanceTimersByTime(60_000);
    healthy.emitClose(1006);

    const afterHealthy = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1][1] as number;
    // При Math.random()=0.99 задержка для attempt=0 — floor(0.99 * 1000) = 990.
    // Именно это число, а не просто «меньше 1000», доказывает, что счётчик
    // обнулился, а не просто оказался маленьким по случайному совпадению.
    expect(afterHealthy).toBe(990);
  });

  it('НЕ обнуляет счётчик, если соединение прожило меньше порога', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    wsService.connect('token');
    // Разогрев счётчика: три мгновенных цикла «открылось и тут же оборвалось».
    for (let i = 0; i < 3; i++) {
      const socket = mockSockets[mockSockets.length - 1];
      socket.emitOpen();
      socket.emitClose(1006);
      const call = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      vi.advanceTimersByTime((call[1] as number) + 1);
    }

    // Соединение прожило 9 c — меньше порога MIN_HEALTHY_CONNECTION_MS (10 c),
    // поэтому счётчик обнуляться не должен.
    const almostHealthy = mockSockets[mockSockets.length - 1];
    almostHealthy.emitOpen();
    vi.advanceTimersByTime(9_000);
    almostHealthy.emitClose(1006);

    const afterAlmostHealthy = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1][1] as number;
    // К этому моменту счётчик разогрет до attempt=3: при Math.random()=0.99
    // задержка — floor(0.99 * 8000) = 7920. Если бы счётчик ошибочно
    // обнулился, задержка была бы для attempt=0 — 990.
    expect(afterAlmostHealthy).toBe(7920);
  });
});
