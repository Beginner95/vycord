package application

import (
	"io"
	"log/slog"
	"testing"
	"time"

	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// TestRoomManagerJoinSoloReconnect reproduces the solo-participant reconnect
// race: RoomSession.Join evicts the sole stale session for the same user
// (see the "evicting stale session" comment in room_session.go), which empties
// the domain Room and closes it. Without a fix, the immediately-following
// domain.Room.AddParticipant call inside the same RoomSession.Join returns
// ErrRoomClosed and the rejoin fails outright — the caller only recovers once
// the reaper goroutine (RoomManager.GetOrCreateRoom's `go func` waiting on
// rs.Done()) removes the closed room from the map and a *later* retry creates
// a fresh one.
//
// RoomManager.Join must absorb this itself: on ErrRoomClosed it should evict
// the closed room from its map and retry once against a freshly created room.
func TestRoomManagerJoinSoloReconnect(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	mgr := NewRoomManager(pf, log)

	// Solo user joins.
	_, psOld, err := mgr.Join("room1", "p1", "alice", &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("first alice join: %v", err)
	}

	// Alice reconnects with a new participant ID before the old session timed
	// out. Since she's the only participant, evicting her stale session inside
	// RoomSession.Join empties (and closes) the domain Room.
	_, psNew, err := mgr.Join("room1", "p2", "alice", &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice rejoin: %v (expected RoomManager.Join to self-heal from ErrRoomClosed)", err)
	}
	if psNew == nil {
		t.Fatal("alice rejoin: nil ParticipantSession returned with nil error")
	}

	select {
	case <-psOld.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("stale alice session was not closed on rejoin")
	}
}
