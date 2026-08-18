package signaling

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/application"
	"github.com/vycord/server/pkg/authtoken"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(_ *http.Request) bool { return true },
}

// Handler is the HTTP handler that upgrades connections to WebSocket and
// drives the per-client signaling lifecycle.
type Handler struct {
	manager   *application.RoomManager
	log       *slog.Logger
	jwtSecret string
}

func NewHandler(manager *application.RoomManager, log *slog.Logger, jwtSecret string) *Handler {
	return &Handler{manager: manager, log: log, jwtSecret: jwtSecret}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		http.Error(w, "missing room_id", http.StatusBadRequest)
		return
	}
	parsedRoomID, err := uuid.Parse(roomID)
	if err != nil {
		http.Error(w, "invalid room_id", http.StatusBadRequest)
		return
	}

	uid, tokenRoomID, err := authtoken.ValidateRoomToken(h.jwtSecret, token)
	if err != nil {
		h.log.Warn("rejected connection: invalid token", "room_id", roomID, "error", err)
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	// Сравниваем разобранные UUID, а не строки: одинаковый идентификатор в
	// другом регистре — это тот же самый room, отказывать по нему нельзя.
	if tokenRoomID != parsedRoomID {
		h.log.Warn("rejected connection: token not scoped to this room", "room_id", roomID, "token_room_id", tokenRoomID)
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	userID := uid.String()

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

	// A resume_token means this connection is not a fresh join but a client
	// whose previous WebSocket died reattaching to the same ParticipantSession —
	// same PeerConnection, same forwarded tracks, no renegotiation for anyone
	// else in the room. An empty, garbage, expired, or wrong-user token all fall
	// through identically to the ordinary join below (VYC-78 step 3, section 7):
	// resume is a fast path, never a hard requirement.
	if resumeToken := r.URL.Query().Get("resume_token"); resumeToken != "" {
		if rs, ps, ok := h.manager.Resume(roomID, userID, resumeToken, sigSession); ok {
			h.log.Info("client resumed session",
				"user_id", userID,
				"room_id", roomID,
				"participant_id", ps.Participant.ID,
			)
			h.watchParticipantDone(ctx, ps, sigSession)
			defer rs.StartGrace(ps.Participant.ID, ps.Generation())

			_ = sigSession.Notify("resumed", ResumedPayload{
				RoomID:        roomID,
				ExistingPeers: rs.ExistingParticipants(),
				SharingPeers:  rs.ExistingSharingPeers(),
			})
			h.readPump(conn, rs, ps, userID, roomID)
			return
		}
		h.log.Warn("resume_token invalid or expired, falling back to a fresh join",
			"user_id", userID,
			"room_id", roomID,
		)
	}

	participantID := uuid.New().String()

	// Get existing peers before joining (for the joined notification).
	existingPeers := []string{}
	sharingPeers := []string{}
	if rs, ok := h.manager.GetRoom(roomID); ok {
		existingPeers = rs.ExistingParticipants()
		sharingPeers = rs.ExistingSharingPeers()
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
	// A dead WebSocket no longer means the participant leaves outright: it
	// starts a grace window (VYC-78 step 3) that Resume can cancel from a new
	// connection. An intentional "leave" message calls rs.Leave directly
	// (routeMessage), which makes this StartGrace a no-op by the time it runs —
	// see RoomSession.StartGrace.
	defer rs.StartGrace(participantID, ps.Generation())

	h.watchParticipantDone(ctx, ps, sigSession)

	// Notify the joining client about the room state.
	_ = sigSession.Notify("joined", JoinedPayload{
		RoomID:        roomID,
		ExistingPeers: existingPeers,
		SharingPeers:  sharingPeers,
		ResumeToken:   ps.ResumeToken(),
	})

	// Notify existing participants.
	h.notifyOthers(rs, participantID, userID)

	// Read pump -- drives all client -> server messages.
	h.readPump(conn, rs, ps, userID, roomID)
}

// watchParticipantDone closes sigSession once the participant session ends
// server-side (ICE timeout, disconnected timeout, PC failure, eviction by a
// rejoin, or a grace window expiring) — shared by both the join and resume
// paths in ServeHTTP.
//
// Closing the session rather than the raw conn lets writePump flush whatever is
// already queued first — most importantly "session_replaced", which an evicted
// client needs to see BEFORE the socket dies, or it will auto-rejoin and evict
// the replacement right back (endless ping-pong between two devices of one
// user). writePump then closes the underlying conn (bounded by writeWait),
// which unblocks readPump's ReadMessage; ServeHTTP exits and its defers fire.
//
// We close the connection rather than using SetReadDeadline because
// gorilla/websocket v1.5+ permanently stores the first read error in
// c.readErr; a deadline timeout makes every subsequent ReadMessage return
// immediately, spinning 1000+ times until gorilla panics.
func (h *Handler) watchParticipantDone(ctx context.Context, ps *application.ParticipantSession, sigSession *Session) {
	go func() {
		select {
		case <-ps.Done():
			sigSession.Close()
		case <-ctx.Done():
		}
	}()
}

func (h *Handler) readPump(
	conn *websocket.Conn,
	rs *application.RoomSession,
	ps *application.ParticipantSession,
	userID, roomID string,
) {
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
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

		h.routeMessage(rs, ps, &msg, userID, roomID)
	}
}

func (h *Handler) routeMessage(
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

	case "request_ice_restart":
		// The client noticed its media path break. It often sees this before the
		// SFU does — pion's ICE timers are slower than the browser's — and the
		// signaling socket is usually still alive when it happens, which is what
		// makes repairing the existing PeerConnection possible at all.
		// Rate-limited inside RequestICERestart: this arrives from the public
		// socket and a client could otherwise ask on a loop.
		h.log.Info("ICE restart requested by client", "user_id", userID, "room_id", roomID)
		ps.RequestICERestart("client_request")

	case "watch_share":
		h.handleWatchShare(rs, ps, msg, userID)

	case "unwatch_share":
		h.handleUnwatchShare(rs, ps, msg, userID)

	case "screen_share_start":
		var p ScreenShareStartPayload
		if err := json.Unmarshal(msg.Payload, &p); err != nil {
			p = ScreenShareStartPayload{}
		}
		ps.Participant.SetScreenTrackID(p.TrackID)
		rs.SetSharingActive(ps.Participant.ID, true)
		h.log.Info("screen share started",
			"user_id", userID,
			"screen_track_id", p.TrackID,
		)

	case "screen_share_stop":
		rs.SetSharingActive(ps.Participant.ID, false)
		h.log.Info("screen share stopped", "user_id", userID)

	case "leave":
		// An intentional leave ends the participant immediately — unlike an
		// unannounced WebSocket death, there is nothing to hold a grace window
		// open for. The deferred StartGrace in ServeHTTP still runs afterward
		// (when the client closes its socket), but by then rs.Leave has already
		// removed the participant, so it finds nothing and is a no-op.
		h.log.Info("client requested leave", "user_id", userID, "room_id", roomID)
		rs.Leave(ps.Participant.ID)

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
// (e.g. camera -> screen share via replaceTrack), which doesn't renegotiate and
// therefore gives the SFU no other signal that the encoded content just changed.
func (h *Handler) handleRequestKeyframe(ps *application.ParticipantSession, userID string) {
	h.log.Info("keyframe requested by client", "user_id", userID)
	ps.RequestKeyframe()
}

func (h *Handler) handleWatchShare(rs *application.RoomSession, ps *application.ParticipantSession, msg *Message, userID string) {
	var p WatchSharePayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil || p.TargetUserID == "" {
		h.log.Warn("invalid watch_share payload", "user_id", userID, "error", err)
		return
	}
	rs.WatchShare(ps.Participant.ID, p.TargetUserID)
}

func (h *Handler) handleUnwatchShare(rs *application.RoomSession, ps *application.ParticipantSession, msg *Message, userID string) {
	var p UnwatchSharePayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil || p.TargetUserID == "" {
		h.log.Warn("invalid unwatch_share payload", "user_id", userID, "error", err)
		return
	}
	rs.UnwatchShare(ps.Participant.ID, p.TargetUserID)
}

func (h *Handler) notifyOthers(rs *application.RoomSession, excludeParticipantID, userID string) {
	rs.NotifyOthers(excludeParticipantID, "participant_joined", ParticipantEventPayload{UserID: userID})
}
