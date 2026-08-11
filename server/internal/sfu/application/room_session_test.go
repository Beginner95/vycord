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

// newFakeScreenTrack builds a minimal RoleScreen PublishedTrack without going
// through a real RTP session — sufficient for exercising routing/subscription
// logic, which never inspects RTP content itself.
func newFakeScreenTrack(t *testing.T, id string) *domain.PublishedTrack {
	t.Helper()
	return &domain.PublishedTrack{
		ID:          id,
		PublisherID: "p1",
		StreamID:    "alice:screen",
		Kind:        domain.TrackKindVideo,
		Role:        domain.RoleScreen,
		Fanout: domain.NewTrackFanout(
			webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
			id, "alice:screen", domain.TrackKindVideo,
		),
	}
}

func hasForwardedTrack(ps *ParticipantSession, t *domain.PublishedTrack) bool {
	ps.sendersMu.Lock()
	defer ps.sendersMu.Unlock()
	_, ok := ps.sendersByTrack[t.ForwardKey()]
	return ok
}

func joinTestRoom(t *testing.T) (*RoomSession, *domain.Room) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	room := domain.NewRoom("room1", func(domain.Event) {})
	return NewRoomSession(room, pf, log), room
}

func TestWatchShareForwardsCurrentScreenTrack(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)

	rs.WatchShare("p2", "alice")

	if !hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("bob did not receive alice's screen track after watch_share")
	}
}

func TestScreenTrackNotForwardedWithoutWatch(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)

	// Bob never calls WatchShare.
	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("bob received alice's screen track without ever calling watch_share")
	}
}

func TestSetSharingActiveFalseStopsForwardingAndClearsWatchers(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)
	rs.WatchShare("p2", "alice")
	if !hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("setup: bob should have received the track before stop")
	}

	rs.SetSharingActive("p1", false)

	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("screen track still forwarded to bob after screen_share_stop")
	}

	// A later watch_share for the same (now inactive) publisher must not
	// resurrect the stale track — sharingActive gates delivery, not the mere
	// existence of a PublishedTrack (which, once created, never goes away).
	rs.WatchShare("p2", "alice")
	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("stale screen track was forwarded even though sharing is inactive")
	}
}

func TestUnwatchShareStopsForwarding(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)
	rs.WatchShare("p2", "alice")
	if !hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("setup: bob should have received the track")
	}

	rs.UnwatchShare("p2", "alice")

	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("screen track still forwarded to bob after unwatch_share")
	}
}

// TestJoinDoesNotDeliverScreenTracksToNewParticipant: the Join-time "deliver all
// already-published tracks" loop predates screen sharing and used to hand every
// existing track to a new joiner. Screen-role tracks must be excluded — otherwise
// anyone joining AFTER a share started receives it without ever calling
// watch_share, defeating the subscription gate for every late joiner.
func TestJoinDoesNotDeliverScreenTracksToNewParticipant(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}

	// Alice starts sharing BEFORE bob is in the room.
	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)

	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("late joiner received an ongoing screen share without ever calling watch_share")
	}

	// The gate still opens on an explicit watch_share.
	rs.WatchShare("p2", "alice")
	if !hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("late joiner did not receive the screen track after watch_share")
	}
}

// TestSetSharingActiveTruePushesToExistingWatchers: a subscriber may already be
// registered as a watcher when the publisher (re)starts a share — via a
// watch_share/screen_share_start race, or the reconnect-restore path. onNewTrack
// only ever fires once per transceiver slot, so from the 2nd share of a call
// onward SetSharingActive(true) is the only remaining delivery trigger.
func TestSetSharingActiveTruePushesToExistingWatchers(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)

	// Bob registers while sharing is still inactive: nothing is forwarded yet
	// (sharingActive, not track existence, is the source of truth).
	rs.WatchShare("p2", "alice")
	if hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("setup: track forwarded while sharing was inactive")
	}

	rs.SetSharingActive("p1", true)

	if !hasForwardedTrack(bobPS, screenTrack) {
		t.Fatal("already-registered watcher got nothing when the share became active")
	}
}

// senderCountForTrack counts how many RTPSenders on the subscriber's PC carry a
// forwarding track for the given publisher track — sendersByTrack keeps only the
// LAST sender, so a duplicate pc.AddTrack is invisible there and only shows up
// here. Matches on the session-scoped wire id the fan-out assigns.
func senderCountForTrack(ps *ParticipantSession, t *domain.PublishedTrack) int {
	n := 0
	for _, s := range ps.pc.GetSenders() {
		if tr := s.Track(); tr != nil && tr.ID() == t.Fanout.WireID() {
			n++
		}
	}
	return n
}

// TestDuplicateWatchShareCreatesSingleSender: a repeated watch_share for the
// same (subscriber, publisher) pair must not create a second RTPSender for the
// same track. RemoveRemoteTrack can only detach the sender recorded in
// sendersByTrack, so an orphaned duplicate would forward RTP forever.
func TestDuplicateWatchShareCreatesSingleSender(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	screenTrack := newFakeScreenTrack(t, "alice-screen-video")
	alicePS.Participant.AddTrack(screenTrack)

	rs.WatchShare("p2", "alice")
	rs.WatchShare("p2", "alice")

	if got := senderCountForTrack(bobPS, screenTrack); got != 1 {
		t.Fatalf("sender count for screen track = %d, want 1 (duplicate watch_share created an orphan sender)", got)
	}

	// The single sender must still be removable — no leak past the gate.
	rs.UnwatchShare("p2", "alice")
	if got := senderCountForTrack(bobPS, screenTrack); got != 0 {
		t.Fatalf("sender count after unwatch_share = %d, want 0", got)
	}
}

// TestExistingSharingPeersReportsOnlyActiveSharesProves the Snapshot for Joiners:
// a participant who joins (or reconnects to) a call while someone is already
// sharing must be told which peers are currently sharing, so the viewer can
// surface the Watch button. The SFU's sharingActive flag is the authoritative
// "is sharing right now" source (a PublishedTrack stays registered even after
// sharing stops), so only participants with sharingActive=true may be reported.
func TestExistingSharingPeersReportsOnlyActiveShares(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	// Bob joins but never shares — the mere presence of a screen track must not
	// make him appear as sharing.
	if _, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("bob join: %v", err)
	}
	if _, err := rs.Join(domain.NewParticipant("p3", "carol", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("carol join: %v", err)
	}

	// Alice is actively sharing; Bob has a screen track registered but is NOT
	// actively sharing (simulates a stopped share whose slot stayed provisioned).
	alicePS.Participant.AddTrack(newFakeScreenTrack(t, "alice-screen-video"))
	rs.SetSharingActive("p1", true)
	rs.SetSharingActive("p2", false)

	snapshot := rs.ExistingSharingPeers()

	if len(snapshot) != 1 || snapshot[0] != "alice" {
		t.Fatalf("ExistingSharingPeers = %v, want exactly [alice]", snapshot)
	}
}

func TestLeaveCleansWatcherRecordsBothDirections(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	if _, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("bob join: %v", err)
	}

	rs.SetSharingActive("p1", true)
	alicePS.Participant.AddTrack(newFakeScreenTrack(t, "alice-screen-video"))
	rs.WatchShare("p2", "alice")

	// Bob (subscriber) leaves — his id must be gone from alice's watcher set.
	rs.Leave("p2")
	rs.mu.RLock()
	_, stillWatching := rs.watchers["p1"]["p2"]
	rs.mu.RUnlock()
	if stillWatching {
		t.Fatal("bob's id remained in alice's watcher set after bob left")
	}

	// Alice (publisher) leaves — her key must be gone from watchers entirely.
	rs.Leave("p1")
	rs.mu.RLock()
	_, publisherKeyExists := rs.watchers["p1"]
	rs.mu.RUnlock()
	if publisherKeyExists {
		t.Fatal("alice's watchers entry remained after alice left")
	}
}

// newFakeMicTrack builds a RoleCameraOrMic audio PublishedTrack with an
// explicit wire id. Two calls with the same id model the same microphone
// MediaStreamTrack being published by two successive sessions of one user:
// groupCall.ts's partialTeardown deliberately keeps localStream alive across an
// auto-reconnect, so the new PeerConnection re-adds the very same
// MediaStreamTrack and the SFU sees the same remote.ID() again.
func newFakeMicTrack(t *testing.T, publisherID, id string) *domain.PublishedTrack {
	t.Helper()
	return &domain.PublishedTrack{
		ID:          id,
		PublisherID: publisherID,
		StreamID:    "alice",
		Kind:        domain.TrackKindAudio,
		Role:        domain.RoleCameraOrMic,
		Fanout: domain.NewTrackFanout(
			webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2},
			// Session-scoped, exactly as NewPublishedTrack builds it: this is what
			// keeps a dead session's track distinguishable from the live one.
			id+"-"+publisherID, "alice", domain.TrackKindAudio,
		),
	}
}

// forwardedWireID returns the wire id of the track a subscriber currently
// forwards for t, or "". Identity matters, not just presence: a sender left
// bound to the PREVIOUS session's (now dead) track carries no RTP, which is
// indistinguishable from silence for the listener. The wire id is session-scoped
// (see domain.localTrackID), so it tells the two apart.
func forwardedWireID(ps *ParticipantSession, t *domain.PublishedTrack) string {
	ps.sendersMu.Lock()
	fwd, ok := ps.sendersByTrack[t.ForwardKey()]
	ps.sendersMu.Unlock()
	if !ok || fwd.sender == nil || fwd.sender.Track() == nil {
		return ""
	}
	return fwd.sender.Track().ID()
}

// TestRepublishAfterReconnectKeepsSubscriberForwarding is VYC-70 (a recurrence
// of VYC-47 through a different door): after a publisher auto-reconnects, some
// subscribers stop hearing them until the publisher fully rejoins.
//
// The teardown of a dead session and the routing of the new session's tracks
// both iterate rs.sessions under rs.mu.RLock, so they genuinely run
// CONCURRENTLY, per subscriber, in either order — which is why only *some*
// listeners lose the publisher. finishLeave additionally does pc.Close() before
// its removal loop, and closing a PeerConnection whose network path just died is
// exactly the slow case, so the teardown really can trail the new session's
// first RTP.
//
// This test pins the invariant for the losing order: the previous session's
// cleanup must not disturb what the NEW session of the same user publishes.
// Both are keyed by the wire track id, which the reconnect keeps identical.
func TestRepublishAfterReconnectKeepsSubscriberForwarding(t *testing.T) {
	rs, _ := joinTestRoom(t)

	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	// Alice's first session publishes her microphone; bob forwards it.
	aliceOld, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice first join: %v", err)
	}
	const micTrackID = "alice-mic"
	oldTrack := newFakeMicTrack(t, "p1", micTrackID)
	aliceOld.Participant.AddTrack(oldTrack)
	if err := bobPS.AddRemoteTrack(oldTrack); err != nil {
		t.Fatalf("forward alice's first mic track to bob: %v", err)
	}

	// Alice's connection dies. RoomSession.Leave has already taken her session
	// out of the map and is now inside finishLeave, blocked in pc.Close().
	rs.mu.Lock()
	delete(rs.sessions, "p1")
	rs.mu.Unlock()

	// Meanwhile auto-reconnect brings Alice back with a new session that
	// republishes the SAME microphone track, and routing hands it to bob.
	aliceNew, err := rs.Join(domain.NewParticipant("p1b", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice rejoin: %v", err)
	}
	newTrack := newFakeMicTrack(t, "p1b", micTrackID)
	aliceNew.Participant.AddTrack(newTrack)
	if err := bobPS.AddRemoteTrack(newTrack); err != nil {
		t.Fatalf("forward alice's republished mic track to bob: %v", err)
	}
	wantWireID := micTrackID + "-p1b"
	if got := forwardedWireID(bobPS, newTrack); got != wantWireID {
		t.Fatalf("bob forwards track %q, want the republished %q — "+
			"the new session's track was dropped as a duplicate of the dead one",
			got, wantWireID)
	}

	// Only now does the dead session's teardown reach its cleanup loop.
	rs.finishLeave(aliceOld)

	if got := forwardedWireID(bobPS, newTrack); got != wantWireID {
		t.Fatalf("after the previous session's teardown bob forwards track %q, want %q — "+
			"bob is now silent for alice until she rejoins", got, wantWireID)
	}
}

// A departing subscriber must release its fan-out sink on every publisher it was
// receiving. Nothing else does it: a sink is an application-level queue and
// goroutine keyed by subscriber id, unlike the old shared local track whose pion
// binding died with the subscriber's PeerConnection. Left behind, every
// disconnect would strand a goroutine that keeps being handed copies of every
// packet for the rest of the call — and reconnects make that unbounded.
func TestLeavingSubscriberReleasesFanoutSink(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	aliceTrack := newFakeMicTrack(t, "p1", "alice-mic")
	alicePS.Participant.AddTrack(aliceTrack)
	if err := bobPS.AddRemoteTrack(aliceTrack); err != nil {
		t.Fatalf("forward alice's mic to bob: %v", err)
	}
	if got := aliceTrack.Fanout.SinkCount(); got != 1 {
		t.Fatalf("alice's track has %d sinks after bob subscribed, want 1", got)
	}

	rs.Leave("p2")

	if got := aliceTrack.Fanout.SinkCount(); got != 0 {
		t.Fatalf("alice's track still has %d sinks after bob left, want 0", got)
	}
}

// A closed session must refuse new forwarding. WatchShare and SetSharingActive
// both capture the subscriber session under rs.mu and release it before calling
// AddRemoteTrack, so one can land after Close() has already drained
// sendersByTrack. Without a guard the sink it creates is registered on the
// publisher's fan-out with nothing left to ever remove it — a goroutine that
// keeps being handed a copy of every packet until the publisher's track ends.
func TestAddRemoteTrackAfterCloseCreatesNoSink(t *testing.T) {
	rs, _ := joinTestRoom(t)

	alicePS, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("alice join: %v", err)
	}
	bobPS, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("bob join: %v", err)
	}

	track := newFakeMicTrack(t, "p1", "alice-mic")
	alicePS.Participant.AddTrack(track)

	bobPS.Close()

	if err := bobPS.AddRemoteTrack(track); err == nil {
		t.Fatal("AddRemoteTrack succeeded on a closed session")
	}
	if track.Fanout.HasSink("p2") {
		t.Fatal("a closed session left a fan-out sink behind, and nothing will remove it")
	}
}
