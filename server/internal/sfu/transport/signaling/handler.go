package signaling

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/application"
)

// readPumpPollInterval is how often readPump checks its context while waiting
// for a WebSocket message. A short deadline ensures prompt shutdown when the
// participant session is cancelled (e.g. ICE timeout) without keeping the WS
// open indefinitely in a ghost state.
const readPumpPollInterval = 5 * time.Second

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(_ *http.Request) bool { return true },
}

// Handler is the HTTP handler that upgrades connections to WebSocket and
// drives the per-client signaling lifecycle.
type Handler struct {
	manager *application.RoomManager
	log     *slog.Logger
}

func NewHandler(manager *application.RoomManager, log *slog.Logger) *Handler {
	return &Handler{manager: manager, log: log}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	roomID := r.URL.Query().Get("room_id")
	if userID == "" || roomID == "" {
		http.Error(w, "missing user_id or room_id", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Error("websocket upgrade failed", "user_id", userID, "error", err)
		return
	}

	h.log.Info("client connected", "user_id", userID, "room_id", roomID, "addr", r.RemoteAddr)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sigSession := NewSession(ctx, conn, h.log)
	defer sigSession.Close()

	participantID := uuid.New().String()

	// Get existing peers before joining (for the joined notification).
	existingPeers := []string{}
	if rs, ok := h.manager.GetRoom(roomID); ok {
		existingPeers = rs.ExistingParticipants()
	}

	rs, ps, err := h.manager.Join(roomID, participantID, userID, sigSession)
	if err != nil {
		h.log.Error("failed to join room",
			"user_id", userID,
			"room_id", roomID,
			"error", err,
		)
		_ = sigSession.Notify("error", ErrorPayload{Code: "join_failed", Message: err.Error()})
		return
	}
	defer rs.Leave(participantID)

	// If the participant session is cancelled server-side (ICE timeout, etc.),
	// cancel the ServeHTTP context so readPump exits and the WebSocket is closed.
	// Without this, the WS stays open indefinitely and the client never learns
	// they were removed — the "ghost participant" bug.
	go func() {
		select {
		case <-ps.Done():
			cancel()
		case <-ctx.Done():
		}
	}()

	// Notify the joining client about the room state.
	_ = sigSession.Notify("joined", JoinedPayload{
		RoomID:        roomID,
		ExistingPeers: existingPeers,
	})

	// Notify existing participants.
	h.notifyOthers(rs, participantID, userID)

	// Read pump — drives all client → server messages.
	h.readPump(ctx, conn, rs, ps, userID, roomID)
}

func (h *Handler) readPump(
	ctx context.Context,
	conn *websocket.Conn,
	rs *application.RoomSession,
	ps *application.ParticipantSession,
	userID, roomID string,
) {
	defer h.log.Info("readPump stopped", "user_id", userID, "room_id", roomID)

	for {
		// Check if the session or request context was cancelled before blocking
		// on ReadMessage. This is the key fix for the "ghost participant" bug:
		// when ps.cancel() fires (ICE timeout), ctx is cancelled by the goroutine
		// in ServeHTTP, and readPump exits → WebSocket closes → client learns.
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Set a read deadline so we periodically re-check ctx.Done() even when
		// no message arrives. Without this, readPump blocks on ReadMessage
		// indefinitely and the participant stays in a ghost state.
		conn.SetReadDeadline(time.Now().Add(readPumpPollInterval))

		_, raw, err := conn.ReadMessage()
		if err != nil {
			// Timeout — loop back and re-check ctx.
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				continue
			}
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				h.log.Warn("unexpected websocket close", "user_id", userID, "error", err)
			}
			return
		}

		var msg Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			h.log.Warn("invalid message", "user_id", userID, "error", err)
			continue
		}

		h.routeMessage(ctx, rs, ps, &msg, userID, roomID)
	}
}

func (h *Handler) routeMessage(
	_ context.Context,
	rs *application.RoomSession,
	ps *application.ParticipantSession,
	msg *Message,
	userID, roomID string,
) {
	switch msg.Type {
	case "answer":
		h.handleAnswer(ps, msg, userID)

	case "ice_candidate":
		h.handleICECandidate(rs, ps, msg, userID)

	case "request_keyframe":
		h.handleRequestKeyframe(ps, userID)

	case "leave":
		// The deferred Leave() in ServeHTTP handles cleanup;
		// closing the connection triggers readPump to return.
		h.log.Info("client requested leave", "user_id", userID, "room_id", roomID)

	default:
		h.log.Warn("unknown message type", "type", msg.Type, "user_id", userID)
	}
}

func (h *Handler) handleAnswer(ps *application.ParticipantSession, msg *Message, userID string) {
	var p AnswerPayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.log.Warn("invalid answer payload", "user_id", userID, "error", err)
		return
	}

	sdpType := webrtc.NewSDPType(p.Type)
	if sdpType != webrtc.SDPTypeAnswer {
		h.log.Warn("expected answer SDP type", "got", p.Type, "user_id", userID)
		return
	}

	ps.DeliverAnswer(webrtc.SessionDescription{Type: sdpType, SDP: p.SDP})
}

func (h *Handler) handleICECandidate(
	rs *application.RoomSession,
	ps *application.ParticipantSession,
	msg *Message,
	userID string,
) {
	var p ICECandidatePayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.log.Warn("invalid ICE candidate payload", "user_id", userID, "error", err)
		return
	}

	rs.AddICECandidate(ps.Participant.ID, webrtc.ICECandidateInit{
		Candidate:        p.Candidate,
		SDPMid:           p.SDPMid,
		SDPMLineIndex:    p.SDPMLineIndex,
		UsernameFragment: p.UsernameFragment,
	})
}

// handleRequestKeyframe forces a fresh keyframe from this participant's published
// video track(s). The client sends this right after switching the video source
// (e.g. camera → screen share via replaceTrack), which doesn't renegotiate and
// therefore gives the SFU no other signal that the encoded content just changed.
// Without an explicit push here, recovery relies entirely on a subscriber's decoder
// noticing the bad frame and emitting its own PLI — which is unreliable exactly at
// the moment of the switch and is what caused the screen-share black-screen reports.
func (h *Handler) handleRequestKeyframe(ps *application.ParticipantSession, userID string) {
	h.log.Info("keyframe requested by client", "user_id", userID)
	ps.RequestKeyframe()
}

func (h *Handler) notifyOthers(rs *application.RoomSession, excludeParticipantID, userID string) {
	// RoomSession.broadcastEvent is unexported; use Notify via existing sessions.
	// We expose a dedicated method for this.
	rs.NotifyOthers(excludeParticipantID, "participant_joined", ParticipantEventPayload{UserID: userID})
}
