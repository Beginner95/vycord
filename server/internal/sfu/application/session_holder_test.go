package application

import (
	"context"
	"sync"
	"testing"

	"github.com/pion/webrtc/v4"
)

// recordingFakeSession is a minimal SignalingSession that records which of its
// methods were called, so a test can tell which underlying session a
// sessionHolder actually routed a call to.
type recordingFakeSession struct {
	mu       sync.Mutex
	notified []string
}

func (f *recordingFakeSession) SendOffer(webrtc.SessionDescription) error       { return nil }
func (f *recordingFakeSession) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (f *recordingFakeSession) Context() context.Context                        { return context.Background() }
func (f *recordingFakeSession) Notify(eventType string, _ any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notified = append(f.notified, eventType)
	return nil
}
func (f *recordingFakeSession) notifiedEvents() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.notified...)
}

// TestSessionHolderDelegatesToCurrentSession pins down the holder's basic job:
// callers that hold a *sessionHolder instead of a raw SignalingSession must see
// calls reach whichever session is current, with no special-casing needed at the
// call site (ParticipantSession, negotiator) — the holder itself satisfies
// SignalingSession.
func TestSessionHolderDelegatesToCurrentSession(t *testing.T) {
	initial := &recordingFakeSession{}
	h := newSessionHolder(initial)

	if err := h.Notify("joined", nil); err != nil {
		t.Fatalf("Notify: %v", err)
	}

	if got := initial.notifiedEvents(); len(got) != 1 || got[0] != "joined" {
		t.Fatalf("initial session events = %v, want [joined]", got)
	}
}

// TestSessionHolderSetSwapsTarget is the reason the holder exists at all: VYC-78
// step 3 (grace-session resume) needs to swap in a freshly reconnected client's
// SignalingSession while the PeerConnection, negotiator and RTP forwarding
// underneath keep running untouched. Set is the entire reattach mechanism, so it
// must actually redirect subsequent calls — not just accept a new value.
func TestSessionHolderSetSwapsTarget(t *testing.T) {
	oldSession := &recordingFakeSession{}
	newSession := &recordingFakeSession{}
	h := newSessionHolder(oldSession)

	h.Set(newSession)

	if err := h.Notify("resumed", nil); err != nil {
		t.Fatalf("Notify: %v", err)
	}

	if got := oldSession.notifiedEvents(); len(got) != 0 {
		t.Fatalf("old session received events after Set: %v, want none", got)
	}
	if got := newSession.notifiedEvents(); len(got) != 1 || got[0] != "resumed" {
		t.Fatalf("new session events = %v, want [resumed]", got)
	}
}
