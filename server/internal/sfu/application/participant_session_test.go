package application

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// TestNewParticipantSessionCreatesFourTransceivers pins down the fixed
// transceiver order that RoomSession's Role resolution depends on:
// [0]=mic-audio, [1]=camera-video, [2]=screen-video, [3]=screen-audio.
func TestNewParticipantSessionCreatesFourTransceivers(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer pc.Close()

	participant := domain.NewParticipant("p1", "alice", "room1")
	ps := NewParticipantSession(context.Background(), participant, pc, &fakeSignalingSession{}, log, nil)
	defer ps.Close()

	transceivers := pc.GetTransceivers()
	if len(transceivers) != 4 {
		t.Fatalf("transceiver count = %d, want 4 (mic-audio, camera-video, screen-video, screen-audio)", len(transceivers))
	}

	wantKinds := []webrtc.RTPCodecType{
		webrtc.RTPCodecTypeAudio,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeVideo,
		webrtc.RTPCodecTypeAudio,
	}
	for i, want := range wantKinds {
		if got := transceivers[i].Kind(); got != want {
			t.Fatalf("transceiver[%d].Kind() = %s, want %s", i, got, want)
		}
		if got := transceivers[i].Direction(); got != webrtc.RTPTransceiverDirectionRecvonly {
			t.Fatalf("transceiver[%d].Direction() = %s, want recvonly", i, got)
		}
	}
}

// cancellableSession is a SignalingSession whose Context() is independently
// cancellable, standing in for a real signaling.Session's socket-bound context
// without needing an actual WebSocket. Used to simulate "the WS died" as
// distinct from "the caller decided to close the participant".
type cancellableSession struct {
	ctx    context.Context
	cancel context.CancelFunc
}

func newCancellableSession() *cancellableSession {
	ctx, cancel := context.WithCancel(context.Background())
	return &cancellableSession{ctx: ctx, cancel: cancel}
}

func (s *cancellableSession) SendOffer(webrtc.SessionDescription) error       { return nil }
func (s *cancellableSession) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (s *cancellableSession) Notify(string, any) error                        { return nil }
func (s *cancellableSession) Context() context.Context                        { return s.ctx }

func isDone(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// TestParticipantSessionOutlivesSignalingSessionDeath is the point of the
// VYC-78 step 2 ctx decoupling: ParticipantSession.ctx used to be a child of
// session.Context(), so a dying WebSocket tore down the PeerConnection and RTP
// forwarding as a side effect — before grace-session resume (step 3) exists to
// reconnect anything. Killing only the signaling session's own context must now
// leave the participant, its PC, and its forwarding untouched.
func TestParticipantSessionOutlivesSignalingSessionDeath(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}

	sess := newCancellableSession()
	participant := domain.NewParticipant("p1", "alice", "room1")
	ps := NewParticipantSession(context.Background(), participant, pc, sess, log, nil)
	defer ps.Close()

	sess.cancel() // the WS died
	time.Sleep(50 * time.Millisecond)

	if isDone(ps.Done()) {
		t.Fatalf("participant session ended when only its signaling session's context was cancelled")
	}
	if pc.ConnectionState() == webrtc.PeerConnectionStateClosed {
		t.Fatalf("PeerConnection was closed when only the signaling session died")
	}
}

// TestParticipantSessionEndsWhenParentContextCancelled is the other half of the
// same invariant: the participant's lifetime is now governed by the ctx it was
// constructed with (the room's, once RoomSession wires it in Join) rather than
// by signaling. Cancelling that parent context must still tear the participant
// down — otherwise nothing would ever end a participant whose signaling session
// never dies on its own (e.g. RoomManager.Shutdown-style forced teardown of a
// whole room).
func TestParticipantSessionEndsWhenParentContextCancelled(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}

	parentCtx, parentCancel := context.WithCancel(context.Background())
	participant := domain.NewParticipant("p1", "alice", "room1")
	ps := NewParticipantSession(parentCtx, participant, pc, &fakeSignalingSession{}, log, nil)
	defer ps.Close()

	parentCancel()

	waitFor(t, 2*time.Second, "the participant session to end when its parent context is cancelled", func() bool {
		return isDone(ps.Done())
	})
}

// newNegotiatedSession spins up a ParticipantSession whose PeerConnection has
// completed one offer/answer exchange against a real pion client, and returns it
// together with the client so a test can inspect the offers that follow.
func newNegotiatedSession(t *testing.T) (*ParticipantSession, *recordingClient) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	serverPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("server NewPeerConnection: %v", err)
	}
	clientPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("client NewPeerConnection: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	client := &recordingClient{clientPC: clientPC, ctx: ctx}
	ps := NewParticipantSession(context.Background(), domain.NewParticipant("p1", "alice", "room1"), serverPC, client, log, nil)
	client.neg = ps.neg

	t.Cleanup(func() {
		ps.Close()
		cancel()
		_ = clientPC.Close()
	})

	ps.Start()
	waitFor(t, 3*time.Second, "the initial negotiation to reach stable", func() bool {
		return client.offerCount() >= 1 && serverPC.SignalingState() == webrtc.SignalingStateStable
	})
	return ps, client
}

// TestParticipantSessionRestartsICEOnDisconnect covers the server-side trigger of
// VYC-78 step 1. ICE 'disconnected' is a routine event — a few hundred
// milliseconds of loss, a NAT rebinding — and the SFU's only reaction used to be
// a 30-second timer that eventually kills the session. Now it first tries to
// repair the connection in place by re-gathering ICE, which the client can act on
// without leaving the room.
func TestParticipantSessionRestartsICEOnDisconnect(t *testing.T) {
	ps, client := newNegotiatedSession(t)
	beforeRestart := iceUfrag(t, client.lastOffer())

	ps.handleConnectionState(webrtc.PeerConnectionStateDisconnected)

	waitFor(t, 3*time.Second, "an offer carrying fresh ICE credentials", func() bool {
		last := client.lastOffer()
		return last != "" && iceUfrag(t, last) != beforeRestart
	})
}

// TestParticipantSessionThrottlesICERestarts pins down the rate limit. Both
// triggers are outside our control — ICE state can flap, and request_ice_restart
// arrives over the public signaling socket — so without a floor between restarts
// a flapping path (or a misbehaving client) would keep the PeerConnection
// re-gathering ICE and never let it settle.
func TestParticipantSessionThrottlesICERestarts(t *testing.T) {
	ps, client := newNegotiatedSession(t)
	beforeRestart := iceUfrag(t, client.lastOffer())

	ps.RequestICERestart("test")
	waitFor(t, 3*time.Second, "the first restart to produce fresh ICE credentials", func() bool {
		last := client.lastOffer()
		return last != "" && iceUfrag(t, last) != beforeRestart
	})
	afterFirst := iceUfrag(t, client.lastOffer())

	// Immediately again: still inside the minimum interval, so it must be dropped.
	ps.RequestICERestart("test")
	time.Sleep(500 * time.Millisecond)
	if got := iceUfrag(t, client.lastOffer()); got != afterFirst {
		t.Fatalf("second restart was not throttled: ice-ufrag changed from %q to %q", afterFirst, got)
	}

	// Once the interval has passed, a restart must be possible again — the limit
	// is a floor on the rate, not a one-shot fuse.
	ps.iceRestartMinInterval = 10 * time.Millisecond
	time.Sleep(20 * time.Millisecond)
	ps.RequestICERestart("test")
	waitFor(t, 3*time.Second, "a restart after the interval elapsed", func() bool {
		last := client.lastOffer()
		return last != "" && iceUfrag(t, last) != afterFirst
	})
}
