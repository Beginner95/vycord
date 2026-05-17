package application

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/pion/webrtc/v4"
)

// negotiator serialises offer/answer exchanges for a single PeerConnection.
//
// Why: pion fires OnNegotiationNeeded for every AddTrack / AddTransceiver call.
// If we create a new offer immediately, concurrent track additions cause overlapping
// negotiations which puts the PC in an invalid signaling state.
//
// Solution: a single goroutine owns the negotiation loop. Callers enqueue a
// trigger; if one is already pending it is merged (channel is buffered(1)).
// After each answer is applied, the loop checks whether a new trigger arrived
// and re-negotiates without delay.
type negotiator struct {
	pc      *webrtc.PeerConnection
	session SignalingSession
	log     *slog.Logger

	trigCh   chan struct{}                  // buffered(1): at most one pending trigger
	answerCh chan webrtc.SessionDescription // client's answer for the current offer

	mu     sync.Mutex
	closed bool
}

func newNegotiator(pc *webrtc.PeerConnection, session SignalingSession, log *slog.Logger) *negotiator {
	n := &negotiator{
		pc:       pc,
		session:  session,
		log:      log,
		trigCh:   make(chan struct{}, 1),
		answerCh: make(chan webrtc.SessionDescription, 1),
	}
	pc.OnNegotiationNeeded(n.trigger)
	return n
}

// trigger enqueues a renegotiation request (at most one pending at a time).
func (n *negotiator) trigger() {
	select {
	case n.trigCh <- struct{}{}:
	default:
	}
}

// DeliverAnswer delivers the client's SDP answer to the pending negotiation.
func (n *negotiator) DeliverAnswer(sdp webrtc.SessionDescription) {
	select {
	case n.answerCh <- sdp:
	default:
		n.log.Warn("negotiator: answer channel full, dropping answer")
	}
}

// Run is the negotiation loop. It must be started in its own goroutine and will
// exit when ctx is cancelled.
func (n *negotiator) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-n.trigCh:
			if err := n.negotiate(ctx); err != nil {
				n.log.Warn("negotiation failed", "error", err)
			}
		}
	}
}

func (n *negotiator) negotiate(ctx context.Context) error {
	offer, err := n.pc.CreateOffer(nil)
	if err != nil {
		return fmt.Errorf("create offer: %w", err)
	}

	// Gathering completes via ICE trickle; SetLocalDescription starts it.
	if err := n.pc.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("set local description: %w", err)
	}

	if err := n.session.SendOffer(*n.pc.LocalDescription()); err != nil {
		return fmt.Errorf("send offer: %w", err)
	}

	// Wait for the client's answer.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case answer := <-n.answerCh:
		if err := n.pc.SetRemoteDescription(answer); err != nil {
			return fmt.Errorf("set remote description: %w", err)
		}
	}
	return nil
}
