package application

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// fakeSignalingSession records Notify events; offers/candidates are discarded.
type fakeSignalingSession struct {
	mu     sync.Mutex
	events []string
}

func (f *fakeSignalingSession) SendOffer(webrtc.SessionDescription) error       { return nil }
func (f *fakeSignalingSession) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (f *fakeSignalingSession) Context() context.Context                        { return context.Background() }

func (f *fakeSignalingSession) Notify(eventType string, _ any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, eventType)
	return nil
}

func (f *fakeSignalingSession) received(eventType string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, e := range f.events {
		if e == eventType {
			return true
		}
	}
	return false
}

func TestJoinEvictsStaleSessionOfSameUser(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	room := domain.NewRoom("room1", func(domain.Event) {})
	rs := NewRoomSession(room, pf, log)

	// Alice joins, then "loses network": her session stays in the room.
	psOld, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("first alice join: %v", err)
	}

	bobSig := &fakeSignalingSession{}
	if _, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), bobSig); err != nil {
		t.Fatalf("bob join: %v", err)
	}

	// Alice reconnects with a new participant ID before the old session timed out.
	if _, err := rs.Join(domain.NewParticipant("p3", "alice", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("alice rejoin: %v", err)
	}

	select {
	case <-psOld.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("stale alice session was not closed on rejoin")
	}

	if got := rs.participantCount(); got != 2 {
		t.Fatalf("participant count = %d, want 2 (bob + new alice)", got)
	}
	if !bobSig.received("participant_left") {
		t.Fatal("bob was not notified that stale alice session left")
	}
}

// TestConcurrentJoinsSameUserLeaveSingleSession: two joins of the same user
// racing each other (double-click, overlapping reconnect attempts) must never
// leave two live sessions — the stale-session scan and the registration of the
// new session have to be atomic.
func TestConcurrentJoinsSameUserLeaveSingleSession(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}

	for i := 0; i < 30; i++ {
		room := domain.NewRoom("room1", func(domain.Event) {})
		rs := NewRoomSession(room, pf, log)

		var wg sync.WaitGroup
		start := make(chan struct{})
		for j := 0; j < 2; j++ {
			wg.Add(1)
			go func(j int) {
				defer wg.Done()
				<-start
				// Errors are acceptable (the loser may fail); duplicates are not.
				_, _ = rs.Join(domain.NewParticipant(fmt.Sprintf("p%d", j), "alice", "room1"), &fakeSignalingSession{})
			}(j)
		}
		close(start)
		wg.Wait()

		// Eviction cleanup is asynchronous (watchSession) — poll briefly.
		deadline := time.Now().Add(2 * time.Second)
		for {
			sessions := rs.participantCount()
			roomParts := len(room.GetAll())
			if sessions == 1 && roomParts == 1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("iteration %d: sessions=%d roomParticipants=%d, want 1/1 (duplicate or ghost session)",
					i, sessions, roomParts)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

// TestEvictedSessionNotifiedSessionReplaced: the evicted client must be told
// its session was superseded, so it suppresses auto-rejoin instead of starting
// an eviction ping-pong with the new session (two devices of the same user).
func TestEvictedSessionNotifiedSessionReplaced(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	room := domain.NewRoom("room1", func(domain.Event) {})
	rs := NewRoomSession(room, pf, log)

	oldSig := &fakeSignalingSession{}
	psOld, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), oldSig)
	if err != nil {
		t.Fatalf("first alice join: %v", err)
	}
	if _, err := rs.Join(domain.NewParticipant("p2", "alice", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("alice rejoin: %v", err)
	}

	select {
	case <-psOld.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("stale session was not closed on rejoin")
	}
	if !oldSig.received("session_replaced") {
		t.Fatal("evicted session did not receive session_replaced")
	}
}
