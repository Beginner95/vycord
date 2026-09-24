import { useEffect } from 'react';
import { groupCallService, type BackgroundAudioSnapshot } from '@/services/groupCall';
import { noiseCancellationService } from '@/services/noiseCancellation';

/**
 * VYC-96 — ДИАГНОСТИКА, поведение звонка не меняет (только чтение и лог).
 *
 * Жалоба: после сворачивания мобильного приложения звук от свернувшего
 * слышен 3–5 с и пропадает. Чтобы отличить «ОС глушит микрофон» от «AudioContext
 * встал» и от «энкодер перестал слать», на каждый цикл hidden → visible
 * снимаем серию снимков цепочки и отправителя микрофона и шлём ОДИН отчёт
 * (logger.report, module vyc76, kind background-audio) + console.info
 * '[bg-audio]' для chrome://inspect.
 *
 * Монтируется только в мобильных оболочках и только пока идёт групповой звонок.
 */

/** Секунды после hidden, в которые снимаются снимки. В фоне таймеры
 *  замедляются — фактическое время снимка пишется отдельно (dtMs/perfMs). */
export const BG_SNAPSHOT_SCHEDULE_S = [0, 1, 2, 3, 5, 8, 12, 20, 30];
/** Короче — не отчитываемся (шторка уведомлений, системный диалог). */
export const BG_MIN_HIDDEN_MS = 2000;
/** Снимок на возврате не должен задерживать отчёт навсегда (getStats завис). */
const FINAL_SNAPSHOT_TIMEOUT_MS = 1500;

interface Row {
  /** Плановая секунда; -1 — снимок на возврате. */
  sched: number;
  dtMs: number;
  perfMs: number;
  vis: 'h' | 'v';
  snap: BackgroundAudioSnapshot;
}

interface Cycle {
  hiddenAt: number;
  perfAt: number;
  timers: ReturnType<typeof setTimeout>[];
  rows: Row[];
  trackEvents: string[];
  ctxEvents: string[];
  unsubs: (() => void)[];
  micMutedAtHide: boolean;
}

const perfNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

function round(n: number | null | undefined, digits: number): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

const bit = (b: boolean | undefined): 0 | 1 | null => (b === undefined ? null : b ? 1 : 0);

/** Колонки вместо массива объектов: Sentry обрезает extra глубже 3 уровней. */
export function buildBackgroundAudioReport(
  rows: Row[],
  meta: { endReason: string; hiddenMs: number; trackEvents: string[]; ctxEvents: string[]; micMutedAtHide: boolean },
): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.dtMs - b.dtMs);
  const col = <T>(fn: (r: Row) => T): T[] => sorted.map(fn);
  const first = sorted.find((r) => r.snap.chain)?.snap.chain ?? null;
  return {
    endReason: meta.endReason,
    hiddenMs: meta.hiddenMs,
    snapshotCount: sorted.length,
    micMutedAtHide: meta.micMutedAtHide,
    sampleRate: first?.sampleRate ?? null,
    baseLatency: round(first?.baseLatency, 4),
    ncActive: first?.ncActive ?? null,
    trackEvents: meta.trackEvents,
    ctxEvents: meta.ctxEvents,
    s_sched: col((r) => r.sched),
    s_dtMs: col((r) => Math.round(r.dtMs)),
    s_perfMs: col((r) => Math.round(r.perfMs)),
    s_vis: col((r) => r.vis),
    s_ctx: col((r) => r.snap.chain?.contextState ?? null),
    s_ctxTime: col((r) => round(r.snap.chain?.contextTime, 2)),
    s_micGain: col((r) => round(r.snap.chain?.micGain, 2)),
    s_ncActive: col((r) => bit(r.snap.chain?.ncActive)),
    s_ncBypass: col((r) => bit(r.snap.chain?.ncBypassed)),
    s_rawState: col((r) => r.snap.chain?.rawTrack?.readyState ?? null),
    s_rawMuted: col((r) => bit(r.snap.chain?.rawTrack?.muted)),
    s_rawEnabled: col((r) => bit(r.snap.chain?.rawTrack?.enabled)),
    s_destState: col((r) => r.snap.chain?.destTrack?.readyState ?? null),
    s_destMuted: col((r) => bit(r.snap.chain?.destTrack?.muted)),
    s_sendState: col((r) => r.snap.senderTrack?.readyState ?? null),
    s_sendMuted: col((r) => bit(r.snap.senderTrack?.muted)),
    s_sendEnabled: col((r) => bit(r.snap.senderTrack?.enabled)),
    s_micMuted: col((r) => bit(r.snap.micMuted)),
    s_pkts: col((r) => r.snap.packetsSent),
    s_bytes: col((r) => r.snap.bytesSent),
    s_lvl: col((r) => round(r.snap.audioLevel, 4)),
    s_energy: col((r) => round(r.snap.totalAudioEnergy, 5)),
    s_samplesDur: col((r) => round(r.snap.totalSamplesDuration, 2)),
    s_pc: col((r) => r.snap.pcState),
    s_ice: col((r) => r.snap.iceState),
  };
}

export function useBackgroundAudioDiagnostics(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let cycle: Cycle | null = null;
    let disposed = false;

    const since = (c: Cycle) => Date.now() - c.hiddenAt;

    const snapshot = async (c: Cycle, sched: number): Promise<Row> => {
      const snap = await groupCallService.getBackgroundAudioSnapshot();
      return {
        sched,
        dtMs: since(c),
        perfMs: perfNow() - c.perfAt,
        vis: document.visibilityState === 'hidden' ? 'h' : 'v',
        snap,
      };
    };

    const watchTrack = (c: Cycle, track: MediaStreamTrack | null | undefined, prefix: string) => {
      if (!track) return;
      for (const type of ['mute', 'unmute', 'ended'] as const) {
        const handler = () => c.trackEvents.push(`${prefix}${type}@${since(c)}`);
        track.addEventListener(type, handler);
        c.unsubs.push(() => track.removeEventListener(type, handler));
      }
    };

    const start = () => {
      if (cycle) return;
      const local = groupCallService.localStreamState;
      const c: Cycle = {
        hiddenAt: Date.now(),
        perfAt: perfNow(),
        timers: [],
        rows: [],
        trackEvents: [],
        ctxEvents: [],
        unsubs: [],
        micMutedAtHide: false,
      };
      cycle = c;
      if (local) {
        c.micMutedAtHide = noiseCancellationService.getChainDiagnostics(local.id)?.micGain === 0;
        watchTrack(c, noiseCancellationService.getRawAudioTrack(local.id), 'raw-');
        watchTrack(c, local.getAudioTracks()[0], 'dest-');
        c.unsubs.push(
          noiseCancellationService.onChainContextStateChange(local.id, (state) => {
            c.ctxEvents.push(`${state}@${since(c)}`);
          }),
        );
      }
      for (const s of BG_SNAPSHOT_SCHEDULE_S) {
        c.timers.push(
          setTimeout(() => {
            void snapshot(c, s).then((row) => {
              if (cycle === c) c.rows.push(row);
            });
          }, s * 1000),
        );
      }
    };

    const teardown = (c: Cycle) => {
      c.timers.forEach(clearTimeout);
      c.timers = [];
      c.unsubs.forEach((u) => u());
      c.unsubs = [];
    };

    const send = (c: Cycle, endReason: string, hiddenMs: number) => {
      const extra = buildBackgroundAudioReport(c.rows, {
        endReason,
        hiddenMs,
        trackEvents: c.trackEvents,
        ctxEvents: c.ctxEvents,
        micMutedAtHide: c.micMutedAtHide,
      });
      console.info('[bg-audio]', extra);
      groupCallService.reportBackgroundAudio(extra);
    };

    const finish = (endReason: 'visible' | 'pagehide') => {
      const c = cycle;
      if (!c) return;
      cycle = null; // один отчёт на цикл
      teardown(c);
      const hiddenMs = since(c);
      if (hiddenMs < BG_MIN_HIDDEN_MS) return;
      if (endReason === 'pagehide') {
        // Страница выгружается — ждать getStats некогда.
        send(c, endReason, hiddenMs);
        return;
      }
      let sent = false;
      const sendOnce = () => {
        if (sent || disposed) return;
        sent = true;
        send(c, endReason, hiddenMs);
      };
      const guard = setTimeout(sendOnce, FINAL_SNAPSHOT_TIMEOUT_MS);
      void snapshot(c, -1)
        .then((row) => { if (!sent) c.rows.push(row); })
        .catch(() => {})
        .finally(() => {
          clearTimeout(guard);
          sendOnce();
        });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') start();
      else finish('visible');
    };
    const onPageHide = () => finish('pagehide');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    // Смонтировались уже в фоне — цикл начинается сразу.
    if (document.visibilityState === 'hidden') start();

    return () => {
      // Конец звонка: без отчёта, всё снимаем.
      disposed = true;
      if (cycle) teardown(cycle);
      cycle = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled]);
}
