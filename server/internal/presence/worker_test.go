package presence

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"maps"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// fakeFetcher returns a fixed snapshot or error, simulating the SFU /presence
// call without a real HTTP round trip.
type fakeFetcher struct {
	snapshot map[string][]string
	err      error
}

func (f *fakeFetcher) Fetch(context.Context) (map[string][]string, error) {
	return f.snapshot, f.err
}

// fakeReconciler is a minimal stand-in for *ws.Hub's presence surface. It
// mirrors ReconcileVoicePresence's real "replace and report what changed"
// contract closely enough to exercise Worker's logic without dragging in the
// whole Hub.
type fakeReconciler struct {
	mu             sync.Mutex
	state          map[uuid.UUID][]uuid.UUID
	reconcileCalls int
	broadcasts     []broadcastCall
}

type broadcastCall struct {
	channelID    uuid.UUID
	participants []uuid.UUID
}

func newFakeReconciler(initial map[uuid.UUID][]uuid.UUID) *fakeReconciler {
	if initial == nil {
		initial = map[uuid.UUID][]uuid.UUID{}
	}
	return &fakeReconciler{state: initial}
}

func (f *fakeReconciler) GetVoiceState() map[uuid.UUID][]uuid.UUID {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[uuid.UUID][]uuid.UUID, len(f.state))
	maps.Copy(out, f.state)
	return out
}

func (f *fakeReconciler) ReconcileVoicePresence(actual map[uuid.UUID][]uuid.UUID) []uuid.UUID {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reconcileCalls++

	var changed []uuid.UUID
	seen := map[uuid.UUID]bool{}
	for channelID, users := range actual {
		seen[channelID] = true
		if !slicesEqualUnordered(f.state[channelID], users) {
			changed = append(changed, channelID)
		}
	}
	for channelID := range f.state {
		if !seen[channelID] {
			changed = append(changed, channelID)
		}
	}
	f.state = actual
	return changed
}

func (f *fakeReconciler) BroadcastVoiceParticipants(channelID uuid.UUID, participants []uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.broadcasts = append(f.broadcasts, broadcastCall{channelID, participants})
}

func slicesEqualUnordered(a, b []uuid.UUID) bool {
	if len(a) != len(b) {
		return false
	}
	set := map[uuid.UUID]bool{}
	for _, id := range a {
		set[id] = true
	}
	for _, id := range b {
		if !set[id] {
			return false
		}
	}
	return true
}

func newTestLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(buf, nil))
}

// TestTick_FetchErrorLeavesStateUntouched is the first half of the safety
// valve (VYC-78 8.5): a failed fetch (SFU down, network blip) must not touch
// voice state at all — better a stale-but-correct picture than acting on
// nothing.
func TestTick_FetchErrorLeavesStateUntouched(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{err: errors.New("connection refused")}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background())

	if reconciler.reconcileCalls != 0 {
		t.Fatalf("ReconcileVoicePresence called %d times, want 0 on fetch error", reconciler.reconcileCalls)
	}
	if len(reconciler.broadcasts) != 0 {
		t.Fatalf("broadcasts sent on fetch error: %v", reconciler.broadcasts)
	}
}

// TestTick_EmptySnapshotWithNonEmptyLocalStateSkipsCycle is the second half of
// the safety valve: an SFU that just restarted (or is briefly unreachable in a
// way that still returns 200 with an empty body) must not be trusted to mean
// "everyone left every call" — that would wipe the sidebar for every ongoing
// call in the app.
func TestTick_EmptySnapshotWithNonEmptyLocalStateSkipsCycle(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background())

	if reconciler.reconcileCalls != 0 {
		t.Fatalf("ReconcileVoicePresence called %d times, want 0 when an empty snapshot would wipe non-empty local state", reconciler.reconcileCalls)
	}
	if len(reconciler.broadcasts) != 0 {
		t.Fatalf("broadcasts sent despite the safety valve: %v", reconciler.broadcasts)
	}
	if !strings.Contains(buf.String(), "skip") {
		t.Fatalf("expected the skipped cycle to be logged, got: %s", buf.String())
	}
}

// TestTick_PersistentEmptySnapshotEventuallyTrustedAfterConsecutiveTicks is
// the fix for a real bug in the original one-shot safety valve: the check was
// global (across every room on the server), not per-channel, so once every
// OTHER call ends, a single stuck ghost channel could never be corrected
// again — every future tick would see the same "SFU reports nothing
// anywhere, local state has this one ghost" shape and skip forever. A ghost
// entry (crashed client that never sent voice_left, aged out server-side by
// the SFU's own grace timeout) must eventually be trusted and cleared once
// the empty snapshot has been confirmed across enough consecutive ticks,
// not blocked permanently by a rule meant to catch a single bad response.
func TestTick_PersistentEmptySnapshotEventuallyTrustedAfterConsecutiveTicks(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	for i := 0; i < emptySnapshotConfirmThreshold-1; i++ {
		w.tick(context.Background())
		if reconciler.reconcileCalls != 0 {
			t.Fatalf("tick %d: ReconcileVoicePresence called before the confirmation threshold was reached", i+1)
		}
	}

	w.tick(context.Background()) // the confirming tick

	if reconciler.reconcileCalls != 1 {
		t.Fatalf("ReconcileVoicePresence called %d times, want exactly 1 once the empty snapshot was confirmed", reconciler.reconcileCalls)
	}
	if len(reconciler.broadcasts) != 1 || reconciler.broadcasts[0].channelID != channelID {
		t.Fatalf("expected the now-empty ghost channel to be broadcast, got: %v", reconciler.broadcasts)
	}
}

// TestTick_EmptySnapshotConfirmationCounterResetsOnNonEmptyTick: the debounce
// counter must track CONSECUTIVE suspicious ticks, not a lifetime total — a
// single healthy tick in between (SFU genuinely reachable and non-empty)
// means a later run of empty snapshots must start counting from zero again,
// not inherit progress toward the threshold from an unrelated earlier blip.
func TestTick_EmptySnapshotConfirmationCounterResetsOnNonEmptyTick(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	for i := 0; i < emptySnapshotConfirmThreshold-1; i++ {
		w.tick(context.Background())
	}

	// A healthy, non-empty tick in between must reset the counter. It also
	// legitimately calls ReconcileVoicePresence itself (a normal non-empty
	// snapshot always does), so the assertions below compare against THIS
	// baseline, not zero.
	fetcher.snapshot = map[string][]string{channelID.String(): {userID.String()}}
	w.tick(context.Background())
	baseline := reconciler.reconcileCalls

	fetcher.snapshot = map[string][]string{}
	for i := 0; i < emptySnapshotConfirmThreshold-1; i++ {
		w.tick(context.Background())
		if reconciler.reconcileCalls != baseline {
			t.Fatalf("tick %d after reset: ReconcileVoicePresence called before the threshold was reached again", i+1)
		}
	}
}

// TestTick_EmptySnapshotWithEmptyLocalStateIsFine: genuinely nobody in any
// call anywhere is not the dangerous case the valve exists for — it must not
// be treated as suspicious just because it's empty.
func TestTick_EmptySnapshotWithEmptyLocalStateIsFine(t *testing.T) {
	reconciler := newFakeReconciler(nil)
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background())

	if len(reconciler.broadcasts) != 0 {
		t.Fatalf("unexpected broadcasts for a no-op tick: %v", reconciler.broadcasts)
	}
}

// TestTick_BroadcastsOnlyChangedChannels is the core reconciliation behavior:
// a valid, non-empty snapshot is applied, and only the channels the
// reconciler reports as changed get a fresh voice_participants broadcast —
// not every channel on every tick.
func TestTick_BroadcastsOnlyChangedChannels(t *testing.T) {
	changedChannel := uuid.New()
	unchangedChannel := uuid.New()
	userA := uuid.New()
	userB := uuid.New()

	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{
		unchangedChannel: {userB},
	})
	fetcher := &fakeFetcher{snapshot: map[string][]string{
		changedChannel.String():   {userA.String()},
		unchangedChannel.String(): {userB.String()},
	}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background())

	if reconciler.reconcileCalls != 1 {
		t.Fatalf("ReconcileVoicePresence called %d times, want 1", reconciler.reconcileCalls)
	}
	if len(reconciler.broadcasts) != 1 {
		t.Fatalf("broadcasts = %v, want exactly one for the changed channel", reconciler.broadcasts)
	}
	if reconciler.broadcasts[0].channelID != changedChannel {
		t.Fatalf("broadcast channel = %v, want the changed one %v", reconciler.broadcasts[0].channelID, changedChannel)
	}
	if got := reconciler.broadcasts[0].participants; len(got) != 1 || got[0] != userA {
		t.Fatalf("broadcast participants = %v, want [%v]", got, userA)
	}
}

// TestTick_MalformedIDAbortsWithoutTouchingState: a snapshot the SFU could
// never actually produce (its own room/user IDs are always valid UUIDs) is
// treated as untrustworthy data, same as a fetch error — abort rather than
// reconcile against garbage.
func TestTick_MalformedIDAbortsWithoutTouchingState(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{snapshot: map[string][]string{
		"not-a-uuid": {userID.String()},
	}}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background())

	if reconciler.reconcileCalls != 0 {
		t.Fatalf("ReconcileVoicePresence called %d times, want 0 for an unparseable snapshot", reconciler.reconcileCalls)
	}
}

// --- VYC-87: CallSweeper wiring ---

// fakeSweeper is a minimal CallSweeper double.
type fakeSweeper struct {
	mu    sync.Mutex
	calls [][]uuid.UUID
}

func (f *fakeSweeper) SweepCalls(activeChannelIDs []uuid.UUID) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, activeChannelIDs)
}

func (f *fakeSweeper) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeSweeper) lastCall() []uuid.UUID {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[len(f.calls)-1]
}

func TestTick_CallSweeperReceivesActiveChannelIDs(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(nil)
	fetcher := &fakeFetcher{snapshot: map[string][]string{channelID.String(): {userID.String()}}}
	sweeper := &fakeSweeper{}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))
	w.SetCallSweeper(sweeper)

	w.tick(context.Background())

	if sweeper.callCount() != 1 {
		t.Fatalf("SweepCalls called %d times, want 1", sweeper.callCount())
	}
	got := sweeper.lastCall()
	if len(got) != 1 || got[0] != channelID {
		t.Fatalf("SweepCalls activeChannelIDs = %v, want [%v]", got, channelID)
	}
}

// TestTick_CallSweeperReceivesNonNilEmptySliceOnEmptySnapshot guards the pgx
// NULL-vs-empty-array pitfall: activeChannelIDs must be a non-nil empty
// slice, never nil.
func TestTick_CallSweeperReceivesNonNilEmptySliceOnEmptySnapshot(t *testing.T) {
	reconciler := newFakeReconciler(nil)
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	sweeper := &fakeSweeper{}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))
	w.SetCallSweeper(sweeper)

	w.tick(context.Background())

	if sweeper.callCount() != 1 {
		t.Fatalf("SweepCalls called %d times, want 1", sweeper.callCount())
	}
	got := sweeper.lastCall()
	if got == nil {
		t.Fatal("activeChannelIDs must be a non-nil empty slice, not nil")
	}
	if len(got) != 0 {
		t.Fatalf("activeChannelIDs = %v, want empty", got)
	}
}

// TestTick_CallSweeperNotInvokedWhileEmptySnapshotUnconfirmed: the sweep
// must not run on a tick the existing safety valve already skipped.
func TestTick_CallSweeperNotInvokedWhileEmptySnapshotUnconfirmed(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	reconciler := newFakeReconciler(map[uuid.UUID][]uuid.UUID{channelID: {userID}})
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	sweeper := &fakeSweeper{}
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))
	w.SetCallSweeper(sweeper)

	w.tick(context.Background())

	if sweeper.callCount() != 0 {
		t.Fatalf("SweepCalls called %d times, want 0 while the empty-snapshot valve has not confirmed yet", sweeper.callCount())
	}
}

func TestTick_NilCallSweeperIsSafe(t *testing.T) {
	fetcher := &fakeFetcher{snapshot: map[string][]string{}}
	reconciler := newFakeReconciler(nil)
	var buf bytes.Buffer
	w := NewWorker(fetcher, reconciler, newTestLogger(&buf))

	w.tick(context.Background()) // must not panic
}
