package signaling

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// writeWait bounds every WebSocket write. Without it a peer with a dead TCP
// connection (the typical evicted-after-network-change session) would block
// writePump forever and leak the connection handler.
const writeWait = 5 * time.Second

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
//
// The send channel is deliberately NOT closed here: a session can be closed
// while other goroutines (negotiator of an evicted session, room broadcasts)
// are still inside sendMsg, and closing the channel turns their pending send
// into a process-wide "send on closed channel" panic. Cancelling the context
// both unblocks those senders and tells writePump to finish.
func (s *Session) Close() {
	s.once.Do(s.cancel)
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

	// Fast-fail once the session is closed: with a buffered channel the send
	// below could otherwise "succeed" into a queue nobody drains anymore,
	// making the select outcome (and the returned error) nondeterministic.
	if s.ctx.Err() != nil {
		return s.ctx.Err()
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
		select {
		case <-s.ctx.Done():
			// Flush whatever is already queued (e.g. the "error" notification
			// on a failed join) so it reaches the client before the close frame.
			for {
				select {
				case msg := <-s.send:
					if !s.writeMsg(msg) {
						return
					}
				default:
					s.conn.SetWriteDeadline(time.Now().Add(writeWait)) //nolint:errcheck
					s.conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
			}
		case msg := <-s.send:
			if !s.writeMsg(msg) {
				return
			}
		}
	}
}

// writeMsg writes one text message; false means the connection is unusable
// and writePump must stop.
func (s *Session) writeMsg(msg []byte) bool {
	if err := s.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
		return false
	}
	w, err := s.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		s.log.Warn("writePump: failed to get writer", "error", err)
		return false
	}
	if _, err := w.Write(msg); err != nil {
		s.log.Warn("writePump: write failed", "error", err)
		_ = w.Close()
		return false
	}
	if err := w.Close(); err != nil {
		s.log.Warn("writePump: close writer failed", "error", err)
		return false
	}
	return true
}
