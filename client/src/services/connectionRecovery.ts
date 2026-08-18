/**
 * ConnectionRecovery decides how far to escalate when a call's PeerConnection
 * loses connectivity.
 *
 * Before this existed, `connectionState === 'disconnected'` started a single
 * 3-second timer that then rejoined the room outright: WebSocket torn down,
 * PeerConnection closed, `participant_left` broadcast, and a renegotiation for
 * every other participant — all for an event that fires after a few hundred
 * milliseconds of packet loss and usually clears on its own.
 *
 * The ladder spends the cheap options first:
 *
 *   1. wait `selfHealMs` — most disconnects resolve here, ICE finds its way back;
 *   2. ask the SFU for an ICE restart and wait `iceRestartWindowMs` — the media
 *      path is rebuilt while the participant stays in the room;
 *   3. only then rejoin.
 *
 * Kept apart from GroupCallService deliberately: the policy is pure timing plus
 * two callbacks, which is testable on its own, while the WebRTC plumbing around
 * it is not.
 */
export interface ConnectionRecoveryOptions {
  /**
   * Asks the SFU for an ICE restart. Returns false when the request could not be
   * sent (signaling socket closed) — there is nothing to wait for then, so the
   * ladder escalates straight to a rejoin.
   */
  requestIceRestart: () => boolean;
  /** Full rejoin: new WebSocket, new PeerConnection. The expensive last resort. */
  fullReconnect: () => void;
  /**
   * Live connection check, consulted before each escalation. Guards against a
   * missed 'connected' event leaving a stale timer able to tear down a call that
   * is actually working.
   */
  isConnected?: () => boolean;
  /** How long to let ICE recover unaided. */
  selfHealMs?: number;
  /** How long to give the ICE restart before rejoining. */
  iceRestartWindowMs?: number;
  /** Diagnostics hook; receives each rung the ladder takes. */
  onStep?: (step: 'self_heal_expired' | 'ice_restart_requested' | 'ice_restart_unavailable' | 'rejoin') => void;
}

const DEFAULT_SELF_HEAL_MS = 2000;
const DEFAULT_ICE_RESTART_WINDOW_MS = 8000;

export class ConnectionRecovery {
  private readonly options: Required<Omit<ConnectionRecoveryOptions, 'isConnected' | 'onStep'>> &
    Pick<ConnectionRecoveryOptions, 'isConnected' | 'onStep'>;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** True from the first 'disconnected' until the connection returns or we rejoin. */
  private escalating = false;

  constructor(options: ConnectionRecoveryOptions) {
    this.options = {
      selfHealMs: options.selfHealMs ?? DEFAULT_SELF_HEAL_MS,
      iceRestartWindowMs: options.iceRestartWindowMs ?? DEFAULT_ICE_RESTART_WINDOW_MS,
      requestIceRestart: options.requestIceRestart,
      fullReconnect: options.fullReconnect,
      isConnected: options.isConnected,
      onStep: options.onStep,
    };
  }

  /**
   * Call on every 'disconnected'. Repeats while a ladder is already running are
   * ignored rather than restarting it: ICE flaps, and pushing the deadline back
   * on each flap would let a permanently broken connection escalate never.
   */
  onDisconnected(): void {
    if (this.escalating) return;
    this.escalating = true;
    this.timer = setTimeout(() => this.escalateToIceRestart(), this.options.selfHealMs);
  }

  /** Call on 'connected'. Whatever rung we were on, we are done. */
  onConnected(): void {
    this.cancel();
  }

  /** Call on teardown or intentional leave — a queued rejoin must not fire. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.escalating = false;
  }

  private escalateToIceRestart(): void {
    this.timer = null;
    if (this.options.isConnected?.()) {
      this.cancel();
      return;
    }

    this.options.onStep?.('self_heal_expired');

    if (!this.options.requestIceRestart()) {
      // No signaling, no restart offer to wait for.
      this.options.onStep?.('ice_restart_unavailable');
      this.rejoin();
      return;
    }

    this.options.onStep?.('ice_restart_requested');
    this.timer = setTimeout(() => this.escalateToRejoin(), this.options.iceRestartWindowMs);
  }

  private escalateToRejoin(): void {
    this.timer = null;
    if (this.options.isConnected?.()) {
      this.cancel();
      return;
    }
    this.rejoin();
  }

  private rejoin(): void {
    this.cancel();
    this.options.onStep?.('rejoin');
    this.options.fullReconnect();
  }
}
