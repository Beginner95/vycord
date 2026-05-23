package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/pion/webrtc/v4"
)

// negotiationAnswerTimeout is how long we wait for a client's SDP answer.
// If the client doesn't answer in this time (network partition, client bug),
// we rollback the PC to stable state so future renegotiations can proceed.
const negotiationAnswerTimeout = 15 * time.Second

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

	// onAnswerApplied is called after each successful SetRemoteDescription(answer).
	// Used to flush ICE candidates that were buffered before the answer arrived.
	onAnswerApplied func()
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
		// A trigger is already queued; it will be processed after current negotiation.
	}
}

// DeliverAnswer delivers the client's SDP answer to the pending negotiation.
func (n *negotiator) DeliverAnswer(sdp webrtc.SessionDescription) {
	select {
	case n.answerCh <- sdp:
	default:
		n.log.Warn("negotiator: answer channel full, dropping answer — client sent duplicate?")
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
				if !errors.Is(err, context.Canceled) {
					n.log.Warn("negotiation failed", "error", err)
				}
			}
		}
	}
}

func (n *negotiator) negotiate(ctx context.Context) error {
	// Drain any stale answer from a previous timed-out negotiation.
	// Without this, a late-arriving answer would be consumed by the next offer,
	// causing SetRemoteDescription to fail (answer doesn't match the new offer).
	select {
	case <-n.answerCh:
		n.log.Warn("negotiator: discarded stale answer from previous negotiation")
	default:
	}

	offer, err := n.pc.CreateOffer(nil)
	if err != nil {
		return fmt.Errorf("create offer: %w", err)
	}

	// SetLocalDescription starts ICE gathering (trickle ICE sends candidates async).
	if err := n.pc.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("set local description: %w", err)
	}

	// Count m-lines by direction to see what's being offered.
	// sendonly = server forwarding a remote participant's track to this subscriber.
	// recvonly = slot for this participant's own upload (audio/video).
	mlineStats := countMLineDirections(n.pc.LocalDescription().SDP)
	n.log.Info("offer created and sent",
		"signaling_state", n.pc.SignalingState().String(),
		"m_lines_total", mlineStats["total"],
		"m_lines_recvonly", mlineStats["recvonly"],
		"m_lines_sendonly", mlineStats["sendonly"],
		"m_lines_sendrecv", mlineStats["sendrecv"],
		"m_lines_inactive", mlineStats["inactive"],
	)
	// Log per-m-line detail so we can see which tracks are being forwarded.
	// This is critical for diagnosing "subscriber not receiving audio" bugs:
	// if sendonly count is 0 when it should be >0, the track was never added.
	for _, detail := range parseMLineDetails(n.pc.LocalDescription().SDP) {
		n.log.Debug("offer m-line detail",
			"index", detail.index,
			"kind", detail.kind,
			"direction", detail.direction,
			"ssrc_count", detail.ssrcCount,
			"mid", detail.mid,
		)
	}

	if err := n.session.SendOffer(*n.pc.LocalDescription()); err != nil {
		// If we can't send the offer, the WS is gone — context will be cancelled soon.
		return fmt.Errorf("send offer: %w", err)
	}

	// Wait for the client's answer with a timeout.
	// Without a timeout, a client that never answers (network partition, browser bug)
	// leaves the PC stuck in have-local-offer and blocks all future renegotiations.
	timer := time.NewTimer(negotiationAnswerTimeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()

	case <-timer.C:
		// Rollback returns the PC to stable so the next trigger can create a fresh offer.
		_ = n.pc.SetLocalDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeRollback})
		return fmt.Errorf("negotiation timeout: no answer received after %s", negotiationAnswerTimeout)

	case answer := <-n.answerCh:
		n.log.Info("answer received, applying",
			"signaling_state", n.pc.SignalingState().String(),
		)
		if err := n.pc.SetRemoteDescription(answer); err != nil {
			return fmt.Errorf("set remote description: %w", err)
		}
		n.log.Info("negotiation complete",
			"signaling_state", n.pc.SignalingState().String(),
		)
		// Flush ICE candidates that arrived before this answer was applied.
		if n.onAnswerApplied != nil {
			n.onAnswerApplied()
		}
	}
	return nil
}

type mLineDetail struct {
	index     int
	kind      string
	direction string
	ssrcCount int
	mid       string
}

// parseMLineDetails extracts per-m-section diagnostics from an SDP string.
// Used to confirm which tracks are sendonly (forwarded) vs recvonly (upload slots).
func parseMLineDetails(sdp string) []mLineDetail {
	var details []mLineDetail
	var current *mLineDetail
	idx := -1

	for _, line := range splitLines(sdp) {
		switch {
		case len(line) > 2 && line[0] == 'm' && line[1] == '=':
			if current != nil {
				details = append(details, *current)
			}
			idx++
			kind := "unknown"
			if len(line) > 2 {
				rest := line[2:]
				if len(rest) >= 5 && rest[:5] == "audio" {
					kind = "audio"
				} else if len(rest) >= 5 && rest[:5] == "video" {
					kind = "video"
				}
			}
			current = &mLineDetail{index: idx, kind: kind, direction: "sendrecv"}
		case current != nil && line == "a=recvonly":
			current.direction = "recvonly"
		case current != nil && line == "a=sendonly":
			current.direction = "sendonly"
		case current != nil && line == "a=sendrecv":
			current.direction = "sendrecv"
		case current != nil && line == "a=inactive":
			current.direction = "inactive"
		case current != nil && len(line) > 7 && line[:7] == "a=ssrc:":
			current.ssrcCount++
		case current != nil && len(line) > 6 && line[:6] == "a=mid:":
			current.mid = line[6:]
		}
	}
	if current != nil {
		details = append(details, *current)
	}
	return details
}

// countMLineDirections parses SDP text and counts m-lines by direction attribute.
func countMLineDirections(sdp string) map[string]int {
	stats := map[string]int{
		"total":    0,
		"recvonly": 0,
		"sendonly": 0,
		"sendrecv": 0,
		"inactive": 0,
	}
	lines := splitLines(sdp)
	inMedia := false
	currentDir := "sendrecv" // SDP default
	for _, line := range lines {
		if len(line) >= 2 && line[0] == 'm' && line[1] == '=' {
			if inMedia {
				stats[currentDir]++
				stats["total"]++
			}
			inMedia = true
			currentDir = "sendrecv"
		} else if inMedia && line == "a=recvonly" {
			currentDir = "recvonly"
		} else if inMedia && line == "a=sendonly" {
			currentDir = "sendonly"
		} else if inMedia && line == "a=sendrecv" {
			currentDir = "sendrecv"
		} else if inMedia && line == "a=inactive" {
			currentDir = "inactive"
		}
	}
	if inMedia {
		stats[currentDir]++
		stats["total"]++
	}
	return stats
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
