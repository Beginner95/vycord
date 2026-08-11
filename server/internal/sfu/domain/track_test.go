package domain

import "testing"

// A reconnecting client re-adds the very same MediaStreamTrack, so both the dead
// session and the live one publish an identical remote.ID(). The two forwarding
// tracks briefly coexist on a subscriber's PeerConnection (the dead session's
// teardown starts with pc.Close() on a broken network path and can take seconds),
// and the subscriber must be able to tell the two m-lines apart: groupCall.ts
// dedupes incoming tracks with stream.getTrackById(event.track.id), so identical
// wire ids make it mistake the live track for the dead one already in the stream
// and never attach it — silently reproducing the very bug this all fixes.
func TestLocalTrackIDDistinguishesPublishingSessions(t *testing.T) {
	const wireID = "alice-mic"

	dead := localTrackID("participant-1", wireID)
	live := localTrackID("participant-2", wireID)

	if dead == live {
		t.Fatalf("both sessions advertise the same wire track id %q; a subscriber "+
			"cannot tell the dead session's track from the live one", dead)
	}
}

// The id must stay stable for one session: it ends up in the SDP of every
// renegotiation that subscriber goes through.
func TestLocalTrackIDIsStablePerSession(t *testing.T) {
	first := localTrackID("participant-1", "alice-mic")
	second := localTrackID("participant-1", "alice-mic")

	if first != second {
		t.Fatalf("id changed between calls for one session: %q then %q", first, second)
	}
}
