package domain

import (
	"time"

	"github.com/google/uuid"
)

type Message struct {
	ID          uuid.UUID     `json:"id"`
	ChannelID   uuid.UUID     `json:"channel_id"`
	UserID      uuid.UUID     `json:"user_id"`
	Content     string        `json:"content"`
	Kind        string        `json:"kind"`
	Attachments []*Attachment `json:"attachments,omitempty"`
	StickerID   *uuid.UUID    `json:"sticker_id,omitempty"`
	Sticker     *Sticker      `json:"sticker,omitempty"`
	// CallStartedAt/CallEndedAt are set only when Kind == "call" (enforced by
	// the messages_call_fields_check constraint). CallEndedAt == nil means
	// the call is still open. There is no CallLastSeenAt field here — it is
	// a server-internal reconciliation timestamp (presence self-healing,
	// see CloseCallsMissingFrom/CloseOrphanedCalls) that the client never
	// needs.
	CallStartedAt *time.Time `json:"call_started_at,omitempty"`
	CallEndedAt   *time.Time `json:"call_ended_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// MessageWithAuthor — сообщение с юзернеймом автора: результаты поиска
// отдаются сразу с именем, чтобы клиент не делал N запросов за авторами.
type MessageWithAuthor struct {
	Message
	Username string `json:"username"`
}

type MessageRepository interface {
	Create(msg *Message) error
	GetByID(id uuid.UUID) (*Message, error)
	GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*Message, error)
	Search(channelID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)
	GetAround(channelID, messageID uuid.UUID, limit int) ([]*Message, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error

	// Звонки в канале (VYC-87 — docs/superpowers/specs/2026-09-03-call-events-in-chat-design.md).
	// CreateCall/EndCall are called from the WS hub's transition points
	// (via usecase.callSessionRecorder). Both are idempotent: CreateCall's
	// second argument to bool reports whether it actually inserted (false
	// means idx_messages_active_call was already held by another open call
	// in the channel — the caller's job is to no-op silently, not error);
	// EndCall's bool reports whether there was an open call to close.
	CreateCall(msg *Message) (bool, error)
	EndCall(channelID uuid.UUID) (*Message, bool, error)

	// TouchCalls/CloseCallsMissingFrom are the presence worker's per-tick
	// self-healing pass, independent of hub state (see presence.CallSweeper).
	// channelIDs must always be a non-nil slice, even when empty — pgx
	// encodes a nil slice as SQL NULL, and `channel_id <> ALL(NULL)` matches
	// no rows, which would silently disable the close-on-empty-snapshot case
	// CloseCallsMissingFrom exists for.
	TouchCalls(channelIDs []uuid.UUID) error
	CloseCallsMissingFrom(channelIDs []uuid.UUID, minAge time.Duration) ([]*Message, error)

	// CloseOrphanedCalls closes every still-open call unconditionally. Called
	// once at API startup, before the hub accepts connections (main.go) —
	// a call that outlived a restart gets an honest duration instead of
	// "ongoing since yesterday".
	CloseOrphanedCalls() error
}
