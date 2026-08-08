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

// WatchSharePayload requests that this participant start receiving
// target_user_id's screen-share video/audio (if currently active).
type WatchSharePayload struct {
	TargetUserID string `json:"target_user_id"`
}

// UnwatchSharePayload requests that this participant stop receiving
// target_user_id's screen-share video/audio.
type UnwatchSharePayload struct {
	TargetUserID string `json:"target_user_id"`
}

// ScreenShareStartPayload is sent by a participant right before their screen
// video RTP starts flowing. TrackID is the wire ID of the screen video track the
// SFU will publish — the SFU uses it to classify the track as RoleScreen by id
// (not by m-line position, which is unreliable: some clients negotiate the
// screen video onto the same m-line as the camera).
type ScreenShareStartPayload struct {
	TrackID string `json:"track_id"`
}

// --- Server → Client ---

type JoinedPayload struct {
	RoomID        string   `json:"room_id"`
	ExistingPeers []string `json:"existing_peers"`
	// SharingPeers lists the existing participants who are screen-sharing right
	// now. Lets a joining viewer surface the Watch button for an already-active
	// share, which the app-WS 'screen_share_started' broadcast alone never
	// delivers to late joiners.
	SharingPeers []string `json:"sharing_peers"`
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
