package signaling

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// Session implements application.SignalingSession over a WebSocket connection.
// It owns the write pump goroutine and guarantees ordered, non-concurrent writes.
type Session struct {
	conn   *websocket.Conn
	send   chan []byte
	log    *slog.Logger
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

func NewSession(ctx context.Context, conn *websocket.Conn, log *slog.Logger) *Session {
	ctx, cancel := context.WithCancel(ctx)
	s := &Session{
		conn:   conn,
		send:   make(chan []byte, 256),
		log:    log,
		ctx:    ctx,
		cancel: cancel,
	}
	go s.writePump()
	return s
}

// SendOffer sends a server-initiated SDP offer.
func (s *Session) SendOffer(sdp webrtc.SessionDescription) error {
	return s.sendMsg("offer", OfferPayload{Type: sdp.Type.String(), SDP: sdp.SDP})
}

// SendICECandidate sends a trickle ICE candidate.
func (s *Session) SendICECandidate(c *webrtc.ICECandidateInit) error {
	return s.sendMsg("ice_candidate", ICECandidatePayload{
		Candidate:        c.Candidate,
		SDPMid:           c.SDPMid,
		SDPMLineIndex:    c.SDPMLineIndex,
		UsernameFragment: c.UsernameFragment,
	})
}

// Notify sends an application-level event.
func (s *Session) Notify(eventType string, payload any) error {
	return s.sendMsg(eventType, payload)
}

// Context is cancelled when the client disconnects.
func (s *Session) Context() context.Context {
	return s.ctx
}

// Close signals the session to stop.
func (s *Session) Close() {
	s.once.Do(func() {
		s.cancel()
		close(s.send)
	})
}

// sendMsg marshals and enqueues a message for sending.
func (s *Session) sendMsg(msgType string, payload any) error {
	data, err := json.Marshal(Message{
		Type:    msgType,
		Payload: MustMarshal(payload),
	})
	if err != nil {
		return err
	}

	select {
	case s.send <- data:
		return nil
	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}

// writePump is the single goroutine that writes to the WebSocket connection.
// All writes are serialized here to satisfy the gorilla/websocket requirement
// that only one goroutine writes at a time.
func (s *Session) writePump() {
	defer s.conn.Close()

	for {
		msg, ok := <-s.send
		if !ok {
			s.conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}

		w, err := s.conn.NextWriter(websocket.TextMessage)
		if err != nil {
			s.log.Warn("writePump: failed to get writer", "error", err)
			return
		}
		if _, err := w.Write(msg); err != nil {
			s.log.Warn("writePump: write failed", "error", err)
			_ = w.Close()
			return
		}
		if err := w.Close(); err != nil {
			s.log.Warn("writePump: close writer failed", "error", err)
			return
		}
	}
}
