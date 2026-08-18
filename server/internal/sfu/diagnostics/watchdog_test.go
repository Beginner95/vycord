package diagnostics

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func newTestWatchdog(buf *bytes.Buffer) *Watchdog {
	return New(slog.New(slog.NewTextHandler(buf, nil)))
}

// TestCheckTickSilentWithinThreshold: the overwhelming majority of ticks are
// on time or only trivially late (scheduler jitter, not a stall) — these must
// never produce a log line. This is also the "hot path" allocation test's
// premise: this is the branch that runs 50 times a second forever.
func TestCheckTickSilentWithinThreshold(t *testing.T) {
	var buf bytes.Buffer
	w := newTestWatchdog(&buf)

	w.checkTick(w.interval)                    // dead on time
	w.checkTick(w.interval + time.Millisecond) // trivial jitter
	w.checkTick(w.interval + w.threshold)      // exactly at the threshold — not OVER it

	if buf.Len() != 0 {
		t.Fatalf("unexpected log output for lag within threshold: %s", buf.String())
	}
}

// TestCheckTickLogsWarnBeyondThreshold reproduces the exact scenario the
// design doc's example line documents: a 20ms ticker that actually fired
// after ~1840ms of real elapsed time is direct evidence the process itself
// was not scheduled to run — GC, OS preemption, or a major page fault on
// swap all look identical from here, which is the whole point (see design
// doc 4.1: this only needs to prove THAT the process stood still, not why).
func TestCheckTickLogsWarnBeyondThreshold(t *testing.T) {
	var buf bytes.Buffer
	w := newTestWatchdog(&buf)
	w.numGoroutine = func() int { return 214 }

	w.checkTick(1840 * time.Millisecond)

	out := buf.String()
	if !strings.Contains(out, "runtime stall detected") {
		t.Fatalf("expected a stall log line, got: %s", out)
	}
	// lag is elapsed-since-last-tick minus the expected interval (20ms):
	// 1840ms elapsed - 20ms interval = 1820ms lag.
	if !strings.Contains(out, "lag_ms=1820") {
		t.Fatalf("expected lag_ms=1820 (elapsed 1840ms minus the 20ms tick interval), got: %s", out)
	}
	if !strings.Contains(out, "threshold_ms=200") {
		t.Fatalf("expected threshold_ms=200, got: %s", out)
	}
	if !strings.Contains(out, "goroutines=214") {
		t.Fatalf("expected goroutines=214, got: %s", out)
	}
}

// TestCheckTickHasZeroAllocationsOnTheHotPath pins the design doc's explicit
// requirement ("ноль аллокаций в горячем пути"): checkTick runs on every one
// of the watchdog's own ticks, forever, so any allocation there would itself
// become a small, permanent source of GC pressure — ironic for a detector
// whose whole job is noticing when GC (among other things) held the world too
// long.
func TestCheckTickHasZeroAllocationsOnTheHotPath(t *testing.T) {
	w := newTestWatchdog(&bytes.Buffer{})

	allocs := testing.AllocsPerRun(1000, func() {
		w.checkTick(w.interval)
	})

	if allocs != 0 {
		t.Fatalf("checkTick allocated %.2f objects/call on the fast (no-stall) path, want 0", allocs)
	}
}

// TestRunStopsOnContextCancellation: the watchdog must not leak a goroutine
// past SFU shutdown.
func TestRunStopsOnContextCancellation(t *testing.T) {
	w := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	w.interval = time.Millisecond // fast, so the test doesn't wait 20ms ticks

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()

	time.Sleep(10 * time.Millisecond) // let a handful of ticks pass
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after context cancellation")
	}
}
