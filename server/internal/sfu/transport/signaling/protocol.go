package signaling

import "encoding/json"

// Message is the envelope for all WebSocket messages.
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// --- Client → Server ---

type AnswerPayload struct {
	Type string `json:"type"` // "answer"
	SDP  string `json:"sdp"`
}

type ICECandidatePayload struct {
	Candidate        string  `json:"candidate"`
	SDPMid           *string `json:"sdpMid"`
	SDPMLineIndex    *uint16 `json:"sdpMLineIndex"`
	UsernameFragment *string `json:"usernameFragment"`
}

// --- Server → Client ---

type JoinedPayload struct {
	RoomID       string   `json:"room_id"`
	ExistingPeers []string `json:"existing_peers"`
}

type OfferPayload struct {
	Type string `json:"type"` // "offer"
	SDP  string `json:"sdp"`
}

type ParticipantEventPayload struct {
	UserID string `json:"user_id"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func MustMarshal(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
