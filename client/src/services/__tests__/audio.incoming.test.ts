import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioService, INCOMING_MESSAGE_MIN_GAP_MS } from '../audio';

describe('audioService.playIncomingMessage', () => {
  let now = 0;
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Каждый тест начинает далеко за окном предыдущего.
    now += 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    play = vi.spyOn(audioService, 'playMessage').mockImplementation(() => {});
    audioService.updateSettings({ messageSound: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it('a burst inside the window sounds once', () => {
    audioService.playIncomingMessage();
    now += 100;
    audioService.playIncomingMessage();
    now += INCOMING_MESSAGE_MIN_GAP_MS - 200;
    audioService.playIncomingMessage();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sounds again once the window has passed', () => {
    audioService.playIncomingMessage();
    now += INCOMING_MESSAGE_MIN_GAP_MS;
    audioService.playIncomingMessage();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('is silent with message sounds off and does not take the window', () => {
    audioService.updateSettings({ messageSound: false });
    audioService.playIncomingMessage();
    expect(play).not.toHaveBeenCalled();
    audioService.updateSettings({ messageSound: true });
    audioService.playIncomingMessage();
    expect(play).toHaveBeenCalledTimes(1);
  });
});
