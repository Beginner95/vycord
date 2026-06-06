package application

import (
	"context"

	"github.com/pion/webrtc/v4"
)

// SignalingSession abstracts the transport layer for SFU → client messages.
// The application layer never touches WebSocket directly.
type SignalingSession interface {
	// SendOffer delivers a server-initiated SDP offer (initial or renegotiation).
	SendOffer(sdp webrtc.SessionDescription) error

	// SendICECandidate delivers a trickle ICE candidate.
	SendICECandidate(c *webrtc.ICECandidateInit) error

	// Notify sends a named event with an arbitrary payload.
	Notify(eventType string, payload any) error

	// Context is cancelled when the client disconnects.
	Context() context.Context
}
