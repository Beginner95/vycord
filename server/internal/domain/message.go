package domain

import (
	"time"

	"github.com/google/uuid"
)

type Message struct {
	ID        uuid.UUID `json:"id"`
	ChannelID uuid.UUID `json:"channel_id"`
	// UserID is nil for a message written by a call guest; then GuestID/Guest
	// are set instead. Exactly one of UserID and GuestID is non-nil —
	// messages_author_check (migration 025). Compare authors only through
	// IsAuthoredBy: a nil UserID must never match anyone.
	UserID      *uuid.UUID    `json:"user_id"`
	GuestID     *uuid.UUID    `json:"-"`
	Guest       *MessageGuest `json:"guest,omitempty"`
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
	// CallParticipantIDs accumulates every user who was ever present in the
	// call (VYC-88 — docs/superpowers/specs/2026-09-03-call-participants-design.md),
	// starter included, in join order. Written to incrementally over the
	// call's life (CreateCall seeds it with the starter; AddCallParticipant
	// appends everyone else) but only meaningful to the client once
	// CallEndedAt is set — the active placard ignores it by design (no
	// live-updating participant list).
	CallParticipantIDs []uuid.UUID `json:"call_participant_ids,omitempty"`
	// CallGuestCount — число гостей, которых впускали в этот звонок (только
	// для Kind == "call"). Плашка звонка показывает «и N гостей».
	CallGuestCount int       `json:"call_guest_count,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// MessageGuest — автор-гость сообщения, как его видят участники канала.
type MessageGuest struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
}

// IsAuthoredBy сообщает, что сообщение написал пользователь userID. Сообщение
// гостя не принадлежит никакому пользователю.
func (m *Message) IsAuthoredBy(userID uuid.UUID) bool {
	return m.UserID != nil && *m.UserID == userID
}

// MessageWithAuthor — сообщение с именем автора (юзернейм или имя гостя): результаты поиска
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

	// CreateGuest inserts a message authored by a call guest (user_id NULL,
	// guest_id set) — guest-call-link spec, section 3.
	CreateGuest(msg *Message) error
	// ListForGuest returns kind='user' messages of channelID created at or
	// after since (the guest's admission moment), strictly after `after` when
	// it is non-nil, oldest first, at most limit. This is the guest's entire
	// read window: nothing before admission is ever visible.
	ListForGuest(channelID uuid.UUID, since time.Time, after *Message, limit int) ([]*GuestChatMessage, error)

	// Звонки в канале (VYC-87 — docs/superpowers/specs/2026-09-03-call-events-in-chat-design.md).
	// CreateCall/EndCall are called from the WS hub's transition points
	// (via usecase.callSessionRecorder). Both are idempotent: CreateCall's
	// second argument to bool reports whether it actually inserted (false
	// means idx_messages_active_call was already held by another open call
	// in the channel — the caller's job is to no-op silently, not error);
	// EndCall's bool reports whether there was an open call to close.
	CreateCall(msg *Message) (bool, error)
	EndCall(channelID uuid.UUID) (*Message, bool, error)

	// AddCallParticipant adds userID to channelID's currently-open call, if
	// any (VYC-88 spec). Idempotent no-op (nil error) when there is no open
	// call in the channel — it may have closed between the hub reading its
	// state and this call landing — or when userID is already recorded.
	AddCallParticipant(channelID, userID uuid.UUID) error

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

// GuestChatAuthor — автор сообщения в том виде, в каком его видит гость.
// Kind: "user" или "guest". Гостю отдаются только имя и аватар участника —
// ни ролей, ни списка участников сервера, ни истории он не получает.
type GuestChatAuthor struct {
	Kind        string     `json:"kind"`
	UserID      *uuid.UUID `json:"user_id,omitempty"`
	Username    string     `json:"username,omitempty"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	GuestID     *uuid.UUID `json:"guest_id,omitempty"`
	DisplayName string     `json:"display_name,omitempty"`
}

// GuestChatMessage — сообщение канала в гостевом формате: только текст,
// без вложений, стикеров и реакций.
type GuestChatMessage struct {
	ID        uuid.UUID       `json:"id"`
	Content   string          `json:"content"`
	CreatedAt time.Time       `json:"created_at"`
	Author    GuestChatAuthor `json:"author"`
}
