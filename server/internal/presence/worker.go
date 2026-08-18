// Package presence reconciles the API's voice-channel presence (what
// hub.voiceChannels believes) against the SFU's own /presence snapshot (who is
// actually in a call), correcting drift instead of trusting client-driven
// voice_joined/voice_left as the sole source of truth — see VYC-78 step 4
// (design doc section 8).
package presence

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// DefaultInterval is how often a Worker reconciles by default (design doc
// 8.2: "период сверки — 5 секунд").
const DefaultInterval = 5 * time.Second

// emptySnapshotConfirmThreshold is how many CONSECUTIVE ticks an empty SFU
// snapshot must repeat, while local state is non-empty, before it is trusted.
// The valve is deliberately global (every room on the server, not just one
// channel) — the SFU has no cheaper way to say "definitely nothing anywhere"
// vs "definitely nothing in this one room" — which means a single stuck
// ghost channel (a crashed client that never sent voice_left, aged out
// server-side by the SFU's own grace timeout) would block itself from ever
// being corrected again once every OTHER call on the server also ended: every
// future tick would see the identical "SFU empty, local non-empty" shape.
// Requiring confirmation across a few ticks rather than forever fixes that
// while still absorbing a single bad response (SFU restarting, momentary
// empty body) — see design doc 8.5, and the review that caught this after
// the safety valve initially shipped as a one-shot check.
const emptySnapshotConfirmThreshold = 3

// Fetcher retrieves the SFU's current presence snapshot: room_id (== the
// API's channel_id) to the user IDs actually in it.
type Fetcher interface {
	Fetch(ctx context.Context) (map[string][]string, error)
}

// Reconciler is the slice of *ws.Hub this package depends on. Kept as an
// interface so Worker's logic is testable without a real Hub.
type Reconciler interface {
	GetVoiceState() map[uuid.UUID][]uuid.UUID
	ReconcileVoicePresence(actual map[uuid.UUID][]uuid.UUID) []uuid.UUID
	BroadcastVoiceParticipants(channelID uuid.UUID, participants []uuid.UUID)
}

// Worker periodically reconciles voice presence. Construct with NewWorker and
// start with Run in its own goroutine.
type Worker struct {
	fetcher    Fetcher
	reconciler Reconciler
	log        *slog.Logger
	interval   time.Duration

	// consecutiveEmptySuspicious counts ticks in a row where the SFU reported
	// nothing anywhere while local state was non-empty — reset to 0 the moment
	// either condition stops holding. Only tick (single goroutine, via Run)
	// touches this, so it needs no synchronization.
	consecutiveEmptySuspicious int
}

func NewWorker(fetcher Fetcher, reconciler Reconciler, log *slog.Logger) *Worker {
	return &Worker{
		fetcher:    fetcher,
		reconciler: reconciler,
		log:        log,
		interval:   DefaultInterval,
	}
}

// Run ticks every w.interval until ctx is cancelled. Intended to be started as
// `go worker.Run(ctx)` from main.
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick(ctx)
		}
	}
}

// tick runs one reconciliation pass. Split out from Run so tests can drive it
// directly without waiting on a real ticker.
func (w *Worker) tick(ctx context.Context) {
	snapshot, err := w.fetcher.Fetch(ctx)
	if err != nil {
		// Safety valve, half 1 (design doc 8.5): a fetch that failed for any
		// reason carries no information — touching state on it risks acting on
		// nothing. An unreachable/restarting SFU freezes the last-known picture
		// instead of corrupting it.
		w.log.Warn("presence: failed to fetch SFU snapshot, leaving voice state untouched", "error", err)
		return
	}

	actual, err := parseSnapshot(snapshot)
	if err != nil {
		// The SFU only ever emits its own room/user IDs, which are always valid
		// UUIDs (see RoomManager.Presence) — anything else means the snapshot
		// cannot be trusted, same treatment as a fetch error.
		w.log.Warn("presence: SFU snapshot contained an unparseable id, leaving voice state untouched", "error", err)
		return
	}

	if len(actual) == 0 {
		current := w.reconciler.GetVoiceState()
		if len(current) > 0 {
			// Safety valve, half 2: an empty snapshot while local state is
			// non-empty would wipe every ongoing call's roster from every
			// sidebar. This is exactly the shape a freshly (re)started or
			// briefly misbehaving SFU produces, so it is treated as suspect
			// rather than authoritative — but only for a bounded number of
			// ticks; see emptySnapshotConfirmThreshold for why this cannot be
			// a one-shot, permanent block.
			w.consecutiveEmptySuspicious++
			if w.consecutiveEmptySuspicious < emptySnapshotConfirmThreshold {
				w.log.Warn("presence: SFU snapshot reports no one in any channel while local state is non-empty, skipping this cycle",
					"local_channel_count", len(current),
					"consecutive_empty_ticks", w.consecutiveEmptySuspicious,
					"confirm_threshold", emptySnapshotConfirmThreshold,
				)
				return
			}
			w.log.Warn("presence: empty SFU snapshot confirmed across enough consecutive ticks, trusting it",
				"consecutive_empty_ticks", w.consecutiveEmptySuspicious,
			)
		}
	}
	w.consecutiveEmptySuspicious = 0

	changed := w.reconciler.ReconcileVoicePresence(actual)
	for _, channelID := range changed {
		w.reconciler.BroadcastVoiceParticipants(channelID, actual[channelID])
	}
}

// parseSnapshot converts the SFU's string-keyed JSON snapshot into the
// uuid.UUID-keyed shape ReconcileVoicePresence needs.
func parseSnapshot(snapshot map[string][]string) (map[uuid.UUID][]uuid.UUID, error) {
	out := make(map[uuid.UUID][]uuid.UUID, len(snapshot))
	for roomID, userIDs := range snapshot {
		channelID, err := uuid.Parse(roomID)
		if err != nil {
			return nil, err
		}
		ids := make([]uuid.UUID, len(userIDs))
		for i, s := range userIDs {
			id, err := uuid.Parse(s)
			if err != nil {
				return nil, err
			}
			ids[i] = id
		}
		out[channelID] = ids
	}
	return out, nil
}
