package usecase

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// callSessionRecorder is the DB-and-domain-aware half of call bookkeeping
// (docs/superpowers/specs/2026-09-03-call-events-in-chat-design.md). It
// implements two consumer-defined interfaces on purpose, from two different
// packages that both need the same messageRepo+hub pair:
//   - ws.CallSessionRecorder — the hub calls CallStarted/CallEnded directly
//     on voice-presence transitions (Hub.SetCallSessionRecorder).
//   - presence.CallSweeper — the presence worker calls SweepCalls once per
//     tick, independent of hub state (presence.Worker.SetCallSweeper).
type callSessionRecorder struct {
	messageRepo domain.MessageRepository
	hub         *ws.Hub
}

// NewCallSessionRecorder builds the recorder. Wire it from main.go with
// hub.SetCallSessionRecorder(...) and, when the presence worker is running,
// presenceWorker.SetCallSweeper(...).
func NewCallSessionRecorder(messageRepo domain.MessageRepository, hub *ws.Hub) *callSessionRecorder {
	return &callSessionRecorder{messageRepo: messageRepo, hub: hub}
}

// CallStarted implements ws.CallSessionRecorder. Idempotent: if
// idx_messages_active_call is already held (another goroutine won the
// race), CreateCall returns ok=false and no broadcast happens.
func (r *callSessionRecorder) CallStarted(channelID, starterID uuid.UUID) {
	now := time.Now()
	msg := &domain.Message{
		ID:                 uuid.New(),
		ChannelID:          channelID,
		UserID:             starterID,
		Content:            "",
		Kind:               "call",
		CallStartedAt:      &now,
		CallParticipantIDs: []uuid.UUID{starterID},
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	ok, err := r.messageRepo.CreateCall(msg)
	if err != nil {
		slog.Error("callsession: failed to create call message", "channel_id", channelID, "error", err)
		return
	}
	if !ok {
		return
	}

	r.broadcast(channelID, "chat_message", msg)
}

// ParticipantJoined implements ws.CallSessionRecorder. No broadcast — the
// participant list is only surfaced to clients once, in the message_update
// CallEnded (or the presence worker's sweep) already sends when the call
// closes (design doc «Live-обновление»: the active placard never
// live-updates its participant list).
func (r *callSessionRecorder) ParticipantJoined(channelID, userID uuid.UUID) {
	if err := r.messageRepo.AddCallParticipant(channelID, userID); err != nil {
		slog.Error("callsession: failed to add call participant", "channel_id", channelID, "user_id", userID, "error", err)
	}
}

// CallEnded implements ws.CallSessionRecorder. Idempotent: EndCall closes at
// most one open row; ok=false (no broadcast) if there was nothing to close.
func (r *callSessionRecorder) CallEnded(channelID uuid.UUID) {
	msg, ok, err := r.messageRepo.EndCall(channelID)
	if err != nil {
		slog.Error("callsession: failed to end call message", "channel_id", channelID, "error", err)
		return
	}
	if !ok {
		return
	}

	r.broadcast(channelID, "message_update", msg)
}

// SweepCalls implements presence.CallSweeper — see that interface's doc
// comment (Task 7) for why this exists separately from CallStarted/
// CallEnded.
func (r *callSessionRecorder) SweepCalls(activeChannelIDs []uuid.UUID) {
	if err := r.messageRepo.TouchCalls(activeChannelIDs); err != nil {
		slog.Error("callsession: failed to touch active calls", "error", err)
	}

	closed, err := r.messageRepo.CloseCallsMissingFrom(activeChannelIDs, 15*time.Second)
	if err != nil {
		slog.Error("callsession: failed to close missing calls", "error", err)
		return
	}
	for _, msg := range closed {
		r.broadcast(msg.ChannelID, "message_update", msg)
	}
}

func (r *callSessionRecorder) broadcast(channelID uuid.UUID, msgType string, msg *domain.Message) {
	payload, err := json.Marshal(msg)
	if err != nil {
		slog.Error("callsession: failed to marshal call message", "channel_id", channelID, "error", err)
		return
	}
	r.hub.SendToChannel(channelID, &ws.Message{Type: msgType, Payload: payload})
}
