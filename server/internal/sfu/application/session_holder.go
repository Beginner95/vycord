package application

import (
	"context"
	"sync"

	"github.com/pion/webrtc/v4"
)

// sessionHolder holds the currently active SignalingSession for a participant
// and implements SignalingSession itself by delegating to it.
//
// It exists so a WebSocket reconnect (grace-session resume, VYC-78 step 3) can
// swap in a fresh SignalingSession while the PeerConnection, negotiator and RTP
// forwarding underneath keep running untouched — Set is the entire reattach
// mechanism. ParticipantSession and the negotiator hold this in place of a raw
// SignalingSession, so neither has to know whether the session it is talking to
// has ever been swapped.
type sessionHolder struct {
	mu      sync.RWMutex
	current SignalingSession
}

func newSessionHolder(initial SignalingSession) *sessionHolder {
	return &sessionHolder{current: initial}
}

// Set swaps the session future calls are delegated to.
func (h *sessionHolder) Set(s SignalingSession) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.current = s
}

func (h *sessionHolder) get() SignalingSession {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.current
}

func (h *sessionHolder) SendOffer(sdp webrtc.SessionDescription) error {
	return h.get().SendOffer(sdp)
}

func (h *sessionHolder) SendICECandidate(c *webrtc.ICECandidateInit) error {
	return h.get().SendICECandidate(c)
}

func (h *sessionHolder) Notify(eventType string, payload any) error {
	return h.get().Notify(eventType, payload)
}

func (h *sessionHolder) Context() context.Context {
	return h.get().Context()
}
