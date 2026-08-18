package application

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// countingSession counts SendOffer calls and never delivers an answer,
// simulating a client that fails to answer a renegotiation offer (its
// setRemoteDescription failed, so it silently returns without answering).
type countingSession struct {
	ctx    context.Context
	offers int32
}

func (s *countingSession) SendOffer(webrtc.SessionDescription) error {
	atomic.AddInt32(&s.offers, 1)
	return nil
}
func (s *countingSession) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (s *countingSession) Notify(string, any) error                        { return nil }
func (s *countingSession) Context() context.Context                        { return s.ctx }

// TestNegotiatorRetriesAfterFailedNegotiation reproduces the root cause of the
// "one participant can't hear another until rejoin" bug (VYC-47).
//
// When a renegotiation fails — the client never answers, so negotiate() times
// out and rolls back — the track that was added to the subscriber PC before the
// offer is left un-negotiated. Without a retry, the negotiator waits passively
// for the next external OnNegotiationNeeded, which never fires for an
// already-added track, so the subscriber never receives that publisher until an
// unrelated room event triggers a fresh negotiation.
//
// The fix makes the negotiator re-trigger itself (with bounded backoff) after a
// failed negotiation. This test asserts the retry happens and is bounded.
func TestNegotiatorRetriesAfterFailedNegotiation(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer pc.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sess := &countingSession{ctx: ctx}
	n := newNegotiator(pc, sess, log)
	// Shrink timeouts so the test doesn't wait the production 15s answer timeout.
	n.answerTimeout = 100 * time.Millisecond
	n.retryBackoff = []time.Duration{
		50 * time.Millisecond,
		50 * time.Millisecond,
		50 * time.Millisecond,
	}

	// A recvonly transceiver makes the offer non-trivial (mirrors a real PC that
	// has a forwarded track pending). This also fires OnNegotiationNeeded.
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		t.Fatalf("AddTransceiver: %v", err)
	}

	go n.Run(ctx)
	n.trigger()

	// The client never answers, so every negotiation times out. With the retry
	// fix, the negotiator re-offers; without it, exactly one offer is ever sent.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sess.offers) >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&sess.offers); got < 2 {
		t.Fatalf("expected negotiator to retry after failed negotiation, got %d offer(s)", got)
	}

	// The retry budget must be bounded — a permanently failing client must not
	// cause an infinite offer loop. initial + len(retryBackoff) attempts.
	time.Sleep(500 * time.Millisecond)
	if got := atomic.LoadInt32(&sess.offers); got > int32(1+len(n.retryBackoff)+1) {
		t.Fatalf("retry not bounded: %d offers sent", got)
	}
}

// iceUfrag extracts the session-level ICE username fragment from an SDP. It is
// the observable fingerprint of an ICE restart: pion keeps the same ufrag for
// every ordinary renegotiation and mints a fresh one only when the offer is
// created with ICERestart:true.
func iceUfrag(t *testing.T, sdp string) string {
	t.Helper()
	for _, line := range splitLines(sdp) {
		if len(line) > 12 && line[:12] == "a=ice-ufrag:" {
			return line[12:]
		}
	}
	t.Fatalf("no a=ice-ufrag in SDP:\n%s", sdp)
	return ""
}

// recordingClient is a real pion PeerConnection acting as the remote client that
// answers every offer and keeps each offer's SDP, so a test can compare the ICE
// credentials of successive offers.
type recordingClient struct {
	clientPC *webrtc.PeerConnection
	neg      *negotiator
	ctx      context.Context

	mu     sync.Mutex
	offers []string
}

func (c *recordingClient) SendOffer(sdp webrtc.SessionDescription) error {
	c.mu.Lock()
	c.offers = append(c.offers, sdp.SDP)
	c.mu.Unlock()

	if err := c.clientPC.SetRemoteDescription(sdp); err != nil {
		return err
	}
	ans, err := c.clientPC.CreateAnswer(nil)
	if err != nil {
		return err
	}
	if err := c.clientPC.SetLocalDescription(ans); err != nil {
		return err
	}
	c.neg.DeliverAnswer(*c.clientPC.LocalDescription())
	return nil
}
func (c *recordingClient) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (c *recordingClient) Notify(string, any) error                        { return nil }
func (c *recordingClient) Context() context.Context                        { return c.ctx }

func (c *recordingClient) offerCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.offers)
}

func (c *recordingClient) lastOffer() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.offers) == 0 {
		return ""
	}
	return c.offers[len(c.offers)-1]
}

// TestNegotiatorICERestartMintsNewICECredentials is the core of VYC-78 step 1:
// when connectivity is lost, the SFU must re-gather ICE on the existing
// PeerConnection instead of the client tearing the whole call down and rejoining.
// A restart is only a restart if the offer carries fresh ICE credentials — an
// ordinary renegotiation reuses them and would make the client's ICE agent
// continue with the same dead candidate pair.
func TestNegotiatorICERestartMintsNewICECredentials(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	serverPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("server NewPeerConnection: %v", err)
	}
	defer serverPC.Close()
	clientPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("client NewPeerConnection: %v", err)
	}
	defer clientPC.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client := &recordingClient{clientPC: clientPC, ctx: ctx}
	n := newNegotiator(serverPC, client, log)
	client.neg = n
	n.answerTimeout = 500 * time.Millisecond

	if _, err := serverPC.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		t.Fatalf("AddTransceiver: %v", err)
	}

	go n.Run(ctx)
	n.trigger()

	waitFor(t, 3*time.Second, "first negotiation to reach stable", func() bool {
		return client.offerCount() >= 1 && serverPC.SignalingState() == webrtc.SignalingStateStable
	})

	// Adding the transceiver fires OnNegotiationNeeded on its own, so ordinary
	// negotiations may still be in flight here. They all carry the same ICE
	// credentials, which is exactly the point: only a restart changes them.
	beforeRestart := iceUfrag(t, client.lastOffer())

	n.TriggerICERestart()

	waitFor(t, 3*time.Second, "an offer carrying fresh ICE credentials", func() bool {
		last := client.lastOffer()
		return last != "" && iceUfrag(t, last) != beforeRestart
	})
}

// TestNegotiatorDefersICERestartUntilSignalingStable covers the case the
// negotiator cannot satisfy immediately: pion has no rollback for a local offer,
// so while the PC sits in have-local-offer (a client missed an offer) a restart
// is impossible. Dropping the request there would leave the participant on a
// dead ICE path with nothing to retry it, so the request must survive the
// recovery and be applied once the PC is stable again.
func TestNegotiatorDefersICERestartUntilSignalingStable(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	serverPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("server NewPeerConnection: %v", err)
	}
	defer serverPC.Close()
	clientPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("client NewPeerConnection: %v", err)
	}
	defer clientPC.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// dropFirst=1: the first offer is never answered, wedging the server PC in
	// have-local-offer — the state in which a restart cannot be created.
	client := &answeringClient{clientPC: clientPC, ctx: ctx, dropFirst: 1}
	n := newNegotiator(serverPC, client, log)
	client.neg = n
	n.answerTimeout = 200 * time.Millisecond
	n.retryBackoff = []time.Duration{50 * time.Millisecond, 100 * time.Millisecond, 200 * time.Millisecond}

	if _, err := serverPC.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		t.Fatalf("AddTransceiver: %v", err)
	}

	go n.Run(ctx)
	n.trigger()

	waitFor(t, 3*time.Second, "PC to be wedged in have-local-offer", func() bool {
		return serverPC.SignalingState() == webrtc.SignalingStateHaveLocalOffer
	})
	firstUfrag := iceUfrag(t, serverPC.LocalDescription().SDP)

	// Requested while a restart is impossible.
	n.TriggerICERestart()

	waitFor(t, 5*time.Second, "deferred ICE restart to be applied after recovery", func() bool {
		ld := serverPC.LocalDescription()
		return serverPC.SignalingState() == webrtc.SignalingStateStable &&
			ld != nil && iceUfrag(t, ld.SDP) != firstUfrag
	})
}

// waitFor polls cond until it holds or the timeout expires, failing with what
// was being waited for. Negotiation is driven by goroutines and timers, so tests
// observe outcomes rather than sequencing them.
func waitFor(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for %s", timeout, what)
}

// fakeOffererPC is a minimal offererPC whose CreateOffer and SetLocalDescription
// outcomes are independently controllable — a real pion PeerConnection cannot
// do this: its only failure trigger for either call is pc.isClosed, which
// fails both identically, so there is no way to make CreateOffer succeed and
// SetLocalDescription fail deterministically against the real thing.
type fakeOffererPC struct {
	state           webrtc.SignalingState
	setLocalDescErr error
}

func (f *fakeOffererPC) SignalingState() webrtc.SignalingState { return f.state }
func (f *fakeOffererPC) LocalDescription() *webrtc.SessionDescription {
	return &webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n"}
}
func (f *fakeOffererPC) CreateOffer(*webrtc.OfferOptions) (webrtc.SessionDescription, error) {
	return webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n"}, nil
}
func (f *fakeOffererPC) SetLocalDescription(webrtc.SessionDescription) error {
	return f.setLocalDescErr
}
func (f *fakeOffererPC) SetRemoteDescription(webrtc.SessionDescription) error { return nil }

// TestNegotiateRestoresICERestartFlagWhenSetLocalDescriptionFails: the restart
// flag is deliberately restored when CreateOffer itself fails (see the comment
// above that branch in negotiate()) so a retry still asks for a restart instead
// of negotiating without one. SetLocalDescription can fail too, after a
// successful CreateOffer, and that path must give the identical guarantee —
// otherwise the restart request is silently dropped and the participant is
// left on the broken ICE path negotiator.TriggerICERestart exists to fix.
func TestNegotiateRestoresICERestartFlagWhenSetLocalDescriptionFails(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	// newNegotiator needs a real PC only to register OnNegotiationNeeded; the
	// fake below replaces it as the thing negotiate() actually drives.
	realPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer realPC.Close()

	n := newNegotiator(realPC, &fakeSignalingSession{}, log)
	n.pc = &fakeOffererPC{
		state:           webrtc.SignalingStateStable,
		setLocalDescErr: errors.New("boom"),
	}
	n.iceRestartPending.Store(true)

	if err := n.negotiate(context.Background()); err == nil {
		t.Fatal("expected negotiate to propagate the SetLocalDescription error")
	}

	if !n.iceRestartPending.Load() {
		t.Fatal("ICE restart request was lost when SetLocalDescription failed after a successful CreateOffer")
	}
}

// answeringClient is a real pion PeerConnection acting as the remote client. It
// ignores the first dropFirst offers (simulating a client whose answer was lost
// or whose setRemoteDescription transiently failed), then answers every offer
// after that by generating a real SDP answer and feeding it back to the negotiator.
type answeringClient struct {
	clientPC  *webrtc.PeerConnection
	neg       *negotiator
	ctx       context.Context
	dropFirst int32
	seen      int32
}

func (c *answeringClient) SendOffer(sdp webrtc.SessionDescription) error {
	if atomic.AddInt32(&c.seen, 1) <= atomic.LoadInt32(&c.dropFirst) {
		return nil // simulate the client failing to answer this offer
	}
	if err := c.clientPC.SetRemoteDescription(sdp); err != nil {
		return err
	}
	ans, err := c.clientPC.CreateAnswer(nil)
	if err != nil {
		return err
	}
	if err := c.clientPC.SetLocalDescription(ans); err != nil {
		return err
	}
	c.neg.DeliverAnswer(*c.clientPC.LocalDescription())
	return nil
}
func (c *answeringClient) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (c *answeringClient) Notify(string, any) error                        { return nil }
func (c *answeringClient) Context() context.Context                        { return c.ctx }

// TestNegotiatorRecoversStalledNegotiationByResendingOffer is the end-to-end
// proof of the fix: a client that misses the first renegotiation offer must
// still reach a stable signaling state once the negotiator re-sends the pending
// offer — instead of being wedged forever in have-local-offer (pion can't roll
// back a local offer). This is exactly the "subscriber can't hear a publisher
// until rejoin" scenario, resolved without a rejoin.
func TestNegotiatorRecoversStalledNegotiationByResendingOffer(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	serverPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("server NewPeerConnection: %v", err)
	}
	defer serverPC.Close()
	clientPC, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("client NewPeerConnection: %v", err)
	}
	defer clientPC.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	client := &answeringClient{clientPC: clientPC, ctx: ctx, dropFirst: 1}
	n := newNegotiator(serverPC, client, log)
	client.neg = n
	n.answerTimeout = 150 * time.Millisecond
	n.retryBackoff = []time.Duration{50 * time.Millisecond, 100 * time.Millisecond, 200 * time.Millisecond}

	if _, err := serverPC.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		t.Fatalf("AddTransceiver: %v", err)
	}

	go n.Run(ctx)
	n.trigger()

	// The first offer is dropped → timeout → the negotiator re-sends the pending
	// offer → the client answers → the server PC reaches stable.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if serverPC.SignalingState() == webrtc.SignalingStateStable && atomic.LoadInt32(&client.seen) >= 2 {
			return // recovered
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("negotiation did not recover: signaling_state=%s offers_seen=%d",
		serverPC.SignalingState(), atomic.LoadInt32(&client.seen))
}

// TestNegotiatorResetsRetryBudgetOnSuccess verifies the retry counter resets
// after a successful negotiation, so a later independent failure gets its full
// retry budget again rather than being starved by earlier failures.
func TestNegotiatorResetsRetryBudgetOnSuccess(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	pc, err := pf.NewPeerConnection()
	if err != nil {
		t.Fatalf("NewPeerConnection: %v", err)
	}
	defer pc.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sess := &countingSession{ctx: ctx}
	n := newNegotiator(pc, sess, log)
	n.answerTimeout = 100 * time.Millisecond
	n.retryBackoff = []time.Duration{50 * time.Millisecond}

	// Drive a failure sequence to exhaustion, then confirm the counter is reset
	// so a fresh trigger negotiates again (not stuck in "budget exhausted").
	go n.Run(ctx)
	n.trigger()

	// Wait for the failure sequence to exhaust (initial + 1 retry = 2 offers).
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sess.offers) >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Let the budget exhaust and settle.
	time.Sleep(300 * time.Millisecond)
	before := atomic.LoadInt32(&sess.offers)

	// A brand-new external trigger must still produce an offer.
	n.trigger()
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sess.offers) > before {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&sess.offers); got <= before {
		t.Fatalf("negotiator ignored a fresh trigger after exhausting an earlier retry budget: offers stayed at %d", got)
	}
}
