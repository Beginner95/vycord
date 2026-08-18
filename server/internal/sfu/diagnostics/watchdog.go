// Package diagnostics holds runtime self-checks for the SFU process — not
// call-quality logic itself, but instrumentation for telling apart "the
// network is bad" from "the SFU process itself stood still" (VYC-78 §4.1).
package diagnostics

import (
	"context"
	"log/slog"
	"runtime"
	"time"
)

const (
	// tickInterval is how often the watchdog's own ticker is scheduled to
	// fire. Short enough that any stall worth caring about (the observed
	// inbound-accel episodes run 1.5-2s) is a huge multiple of it, so there is
	// no meaningful risk of a false positive from ordinary scheduling jitter.
	tickInterval = 20 * time.Millisecond

	// stallThreshold is how far a tick's actual arrival may lag its scheduled
	// time before it is logged as a stall.
	stallThreshold = 200 * time.Millisecond
)

// Watchdog measures its own scheduling lag: a goroutine that asked to be
// woken every tickInterval and instead was woken stallThreshold or more late
// is direct evidence the process itself was not running for that stretch —
// GC pausing the world, the OS scheduler preempting it, or a major page fault
// on swap all produce the same signature here, and telling them apart is not
// this package's job (see design doc 4.1 — that is what 4.2/4.3 are for if
// this comes back positive).
type Watchdog struct {
	log       *slog.Logger
	interval  time.Duration
	threshold time.Duration
	// numGoroutine is runtime.NumGoroutine, overridable in tests. Only called
	// on the (rare) stall path, so it plays no part in the hot-path
	// zero-allocations requirement.
	numGoroutine func() int
}

// New builds a Watchdog with the design doc's fixed interval/threshold
// (20ms / 200ms). Both fields are exported-in-package (lowercase, same
// package) for tests to override — Run itself takes no parameters, so
// production wiring in cmd/sfu/main.go stays a one-liner.
func New(log *slog.Logger) *Watchdog {
	return &Watchdog{
		log:          log,
		interval:     tickInterval,
		threshold:    stallThreshold,
		numGoroutine: runtime.NumGoroutine,
	}
}

// Run blocks, ticking every w.interval and checking its own lag, until ctx is
// cancelled. Intended to be started as `go w.Run(ctx)`.
func (w *Watchdog) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	last := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			w.checkTick(now.Sub(last))
			last = now
		}
	}
}

// checkTick is Run's per-tick decision, split out so it is testable without
// waiting on a real ticker or fabricating an actual multi-hundred-millisecond
// stall. elapsed is the real wall-clock time since the previous tick.
//
// Hot path (elapsed - w.interval <= w.threshold, the overwhelming majority of
// calls — this runs 50 times a second forever): a subtraction and a
// comparison, nothing that allocates. Only the rare stall branch below the
// early return allocates anything, via the slog call.
func (w *Watchdog) checkTick(elapsed time.Duration) {
	lag := elapsed - w.interval
	if lag <= w.threshold {
		return
	}
	w.log.Warn("runtime stall detected",
		"lag_ms", lag.Milliseconds(),
		"threshold_ms", w.threshold.Milliseconds(),
		"goroutines", w.numGoroutine(),
	)
}
