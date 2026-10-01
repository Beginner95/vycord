import { describe, it, expect, vi } from 'vitest';
import { recordFeedback } from '@/voice/recordFeedback';

describe('recordFeedback', () => {
  it('вибрация и звук на каждое событие', () => {
    const vibrate = vi.fn(() => true); const sound = vi.fn();
    recordFeedback('start', { vibrate, sound });
    expect(vibrate).toHaveBeenCalledWith(40);
    expect(sound).toHaveBeenCalledWith('start');
  });

  it('отмена — двойной импульс', () => {
    const vibrate = vi.fn(() => true); const sound = vi.fn();
    recordFeedback('cancel', { vibrate, sound });
    expect(vibrate).toHaveBeenCalledWith([20, 60, 20]);
    expect(sound).toHaveBeenCalledWith('cancel');
  });

  it('закрепление — только короткая вибрация, без звука', () => {
    const vibrate = vi.fn(() => true); const sound = vi.fn();
    recordFeedback('lock', { vibrate, sound });
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(sound).not.toHaveBeenCalled();
  });

  it('нет Vibration API (iOS, десктоп) — звук всё равно играет', () => {
    const sound = vi.fn();
    recordFeedback('send', { vibrate: undefined, sound });
    expect(sound).toHaveBeenCalledWith('send');
  });

  it('сбой звука не ломает запись', () => {
    expect(() => recordFeedback('start', { vibrate: undefined, sound: () => { throw new Error('no ctx'); } })).not.toThrow();
  });
});
