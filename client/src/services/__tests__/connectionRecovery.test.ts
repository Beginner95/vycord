import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionRecovery } from '@/services/connectionRecovery';

// The ladder replaces the old single 3-second timer that went straight from
// 'disconnected' to a full rejoin (tearing down the PeerConnection and making
// everyone else in the room renegotiate) for what is usually a brief hiccup.
// Each test below fixes one rung of it.

describe('ConnectionRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(overrides: Partial<Parameters<typeof makeOptions>[0]> = {}) {
    const requestIceRestart = vi.fn(() => true);
    const fullReconnect = vi.fn();
    const options = makeOptions({ requestIceRestart, fullReconnect, ...overrides });
    return { recovery: new ConnectionRecovery(options), requestIceRestart, fullReconnect };
  }

  function makeOptions(o: {
    requestIceRestart: () => boolean;
    fullReconnect: () => void;
    isConnected?: () => boolean;
    selfHealMs?: number;
    iceRestartWindowMs?: number;
  }) {
    return { selfHealMs: 2000, iceRestartWindowMs: 8000, ...o };
  }

  it('gives the connection time to heal on its own before doing anything', () => {
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(1999);

    expect(requestIceRestart).not.toHaveBeenCalled();
    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('asks for an ICE restart once the self-heal window expires', () => {
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000);

    expect(requestIceRestart).toHaveBeenCalledTimes(1);
    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('does nothing at all when the connection recovers by itself', () => {
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(1500);
    recovery.onConnected();
    vi.advanceTimersByTime(60_000);

    expect(requestIceRestart).not.toHaveBeenCalled();
    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('does not rejoin when the ICE restart repairs the connection', () => {
    const { recovery, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000);
    recovery.onConnected();
    vi.advanceTimersByTime(60_000);

    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('falls back to a full rejoin when the ICE restart does not help in time', () => {
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000 + 8000);

    expect(requestIceRestart).toHaveBeenCalledTimes(1);
    expect(fullReconnect).toHaveBeenCalledTimes(1);
  });

  it('rejoins immediately when signaling is gone, since no restart can be requested', () => {
    // A closed WebSocket means the SFU cannot be asked for a restart offer, so
    // waiting out the 8-second window would only delay the rejoin.
    const { recovery, fullReconnect } = setup({ requestIceRestart: vi.fn(() => false) });

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000);

    expect(fullReconnect).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated disconnect events instead of restarting the ladder', () => {
    // ICE state flaps: 'disconnected' can fire several times in a row. Each event
    // must not push the deadline back, or a flapping connection would never
    // escalate, and must not queue a second restart request.
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(1000);
    recovery.onDisconnected();
    vi.advanceTimersByTime(1000);

    expect(requestIceRestart).toHaveBeenCalledTimes(1);

    recovery.onDisconnected();
    vi.advanceTimersByTime(8000);

    expect(requestIceRestart).toHaveBeenCalledTimes(1);
    expect(fullReconnect).toHaveBeenCalledTimes(1);
  });

  it('skips escalation when the connection is already back at firing time', () => {
    // Belt and braces for a missed 'connected' event: the ladder checks the live
    // state before acting, so a stale timer cannot tear down a working call.
    const { recovery, requestIceRestart, fullReconnect } = setup({ isConnected: () => true });

    recovery.onDisconnected();
    vi.advanceTimersByTime(60_000);

    expect(requestIceRestart).not.toHaveBeenCalled();
    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('stops pending escalation when cancelled', () => {
    // Called on teardown / intentional leave: a queued rejoin must not resurrect
    // a call the user has left.
    const { recovery, requestIceRestart, fullReconnect } = setup();

    recovery.onDisconnected();
    recovery.cancel();
    vi.advanceTimersByTime(60_000);

    expect(requestIceRestart).not.toHaveBeenCalled();
    expect(fullReconnect).not.toHaveBeenCalled();
  });

  it('runs the ladder again for a disconnect that happens after a recovery', () => {
    const { recovery, requestIceRestart } = setup();

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000);
    recovery.onConnected();

    recovery.onDisconnected();
    vi.advanceTimersByTime(2000);

    expect(requestIceRestart).toHaveBeenCalledTimes(2);
  });
});
