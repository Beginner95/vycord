package domain

import "testing"

func TestParticipantSharingActiveDefaultsFalse(t *testing.T) {
	p := NewParticipant("p1", "alice", "room1")
	if p.IsSharingActive() {
		t.Fatal("sharingActive should default to false")
	}
	p.SetSharingActive(true)
	if !p.IsSharingActive() {
		t.Fatal("SetSharingActive(true) did not take effect")
	}
	p.SetSharingActive(false)
	if p.IsSharingActive() {
		t.Fatal("SetSharingActive(false) did not take effect")
	}
}

func TestParticipantGetScreenTracksFiltersByRole(t *testing.T) {
	p := NewParticipant("p1", "alice", "room1")
	p.AddTrack(&PublishedTrack{ID: "mic", Role: RoleCameraOrMic})
	p.AddTrack(&PublishedTrack{ID: "camera", Role: RoleCameraOrMic})
	p.AddTrack(&PublishedTrack{ID: "screen-video", Role: RoleScreen})
	p.AddTrack(&PublishedTrack{ID: "screen-audio", Role: RoleScreen})

	got := p.GetScreenTracks()
	if len(got) != 2 {
		t.Fatalf("GetScreenTracks() len = %d, want 2", len(got))
	}
	for _, tr := range got {
		if tr.Role != RoleScreen {
			t.Fatalf("GetScreenTracks() returned non-screen track %q (role %s)", tr.ID, tr.Role)
		}
	}
}

func TestParticipantScreenTrackID(t *testing.T) {
	p := NewParticipant("p1", "alice", "room1")

	// Empty id never matches.
	if p.IsScreenTrackID("") {
		t.Fatal("IsScreenTrackID('') should be false when no track id recorded")
	}
	if p.IsScreenTrackID("track-123") {
		t.Fatal("IsScreenTrackID should be false before SetScreenTrackID")
	}

	p.SetScreenTrackID("track-123")
	if !p.IsScreenTrackID("track-123") {
		t.Fatal("IsScreenTrackID should be true after SetScreenTrackID with matching id")
	}
	if p.IsScreenTrackID("other-track") {
		t.Fatal("IsScreenTrackID should be false for a non-matching id")
	}

	// A new (empty) screen_share_start clears the designation.
	p.SetScreenTrackID("")
	if p.IsScreenTrackID("track-123") {
		t.Fatal("IsScreenTrackID should be false after the id is cleared")
	}
}
