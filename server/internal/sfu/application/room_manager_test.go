package application

import (
	"io"
	"log/slog"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

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

// TestPresenceReportsRoomIDToUserIDsAcrossRooms is the SFU-side half of VYC-78
// step 4: the API's reconciliation worker needs a ground truth of who is
// actually in each room, keyed the same way the client and API already key
// voice channels — room_id here IS channel_id there (handleJoinGroupCall
// passes the same identifier into both).
func TestPresenceReportsRoomIDToUserIDsAcrossRooms(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	mgr := NewRoomManager(pf, log)

	if _, _, err := mgr.Join("room1", "p1", "alice", &fakeSignalingSession{}); err != nil {
		t.Fatalf("alice join room1: %v", err)
	}
	if _, _, err := mgr.Join("room1", "p2", "bob", &fakeSignalingSession{}); err != nil {
		t.Fatalf("bob join room1: %v", err)
	}
	if _, _, err := mgr.Join("room2", "p3", "carol", &fakeSignalingSession{}); err != nil {
		t.Fatalf("carol join room2: %v", err)
	}

	got := mgr.Presence()

	sort.Strings(got["room1"])
	if want := []string{"alice", "bob"}; !equalStrings(got["room1"], want) {
		t.Fatalf("Presence()[\"room1\"] = %v, want %v", got["room1"], want)
	}
	if want := []string{"carol"}; !equalStrings(got["room2"], want) {
		t.Fatalf("Presence()[\"room2\"] = %v, want %v", got["room2"], want)
	}
	if _, ok := got["room3"]; ok {
		t.Fatal("Presence() reported a room nobody ever joined")
	}
}

// TestPresenceIncludesParticipantInGrace: the whole point of grace (VYC-78 step
// 3) is that a participant with a dead WebSocket is still genuinely in the
// call — media flowing, PC alive. The presence snapshot must reflect that, or
// the reconciliation worker built on top of it would flicker a mid-hiccup
// participant out of everyone else's sidebar for the length of the grace
// window, which is exactly what step 3 exists to prevent.
func TestPresenceIncludesParticipantInGrace(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	mgr := NewRoomManager(pf, log)

	rs, ps, err := mgr.Join("room1", "p1", "alice", &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	rs.graceTimeout = time.Hour // must not fire during this test
	rs.StartGrace("p1", ps.Generation())

	got := mgr.Presence()
	if want := []string{"alice"}; !equalStrings(got["room1"], want) {
		t.Fatalf("Presence()[\"room1\"] while alice is in grace = %v, want %v", got["room1"], want)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRoomManager_PresenceSeparatesGuests(t *testing.T) {
	m, roomID := newPresenceTestManager(t)
	userID := uuid.NewString()
	guestID := "guest:" + uuid.NewString()
	joinTestParticipant(t, m, roomID, userID)
	joinTestParticipant(t, m, roomID, guestID)

	presence := m.Presence()
	assert.Equal(t, []string{userID}, presence[roomID], "guests never appear in /presence")

	guests := m.GuestPresence()
	assert.Equal(t, []string{guestID}, guests[roomID])
}

func TestRoomManager_KickGuestAndDenyList(t *testing.T) {
	m, roomID := newPresenceTestManager(t)
	guestID := "guest:" + uuid.NewString()
	joinTestParticipant(t, m, roomID, guestID)

	assert.False(t, m.GuestDenied(guestID))
	assert.True(t, m.KickGuest(roomID, guestID))
	assert.Empty(t, m.GuestPresence()[roomID], "the kicked guest is gone from the room")
	assert.True(t, m.GuestDenied(guestID), "a kicked guest cannot walk back in with an unused token")

	// Idempotent: kicking someone who is not there still deny-lists them, so a
	// token minted a moment before the kick cannot be redeemed.
	other := "guest:" + uuid.NewString()
	assert.False(t, m.KickGuest(roomID, other))
	assert.True(t, m.GuestDenied(other))
	assert.False(t, m.KickGuest("no-such-room", "guest:"+uuid.NewString()))
}

// Н4
func TestRoomManager_JTIIsSingleUse(t *testing.T) {
	m, _ := newPresenceTestManager(t)
	exp := time.Now().Add(time.Minute)
	assert.True(t, m.UseJTI("jti-1", exp))
	assert.False(t, m.UseJTI("jti-1", exp))
	assert.True(t, m.UseJTI("jti-2", exp))

	// An expired entry is forgotten rather than kept forever.
	assert.True(t, m.UseJTI("jti-old", time.Now().Add(-time.Second)))
	assert.True(t, m.UseJTI("jti-old", time.Now().Add(time.Minute)))
}

func newPresenceTestManager(t *testing.T) (*RoomManager, string) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	m := NewRoomManager(pf, log)
	t.Cleanup(m.Shutdown)
	return m, uuid.NewString()
}

func joinTestParticipant(t *testing.T, m *RoomManager, roomID, userID string) {
	t.Helper()
	if _, _, err := m.Join(roomID, uuid.NewString(), userID, &fakeSignalingSession{}); err != nil {
		t.Fatalf("Join(%s): %v", userID, err)
	}
}
