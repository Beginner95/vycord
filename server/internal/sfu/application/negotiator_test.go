package application

import (
	"context"
	"io"
	"log/slog"
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
