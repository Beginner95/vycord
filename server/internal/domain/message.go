package domain

import (
	"time"

	"github.com/google/uuid"
)

type Message struct {
	ID          uuid.UUID  `json:"id"`
	ChannelID   uuid.UUID  `json:"channel_id"`
	UserID      uuid.UUID  `json:"user_id"`
	Content     string     `json:"content"`
	Attachments []string   `json:"attachments,omitempty"`
	StickerID   *uuid.UUID `json:"sticker_id,omitempty"`
	Sticker     *Sticker   `json:"sticker,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
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
}
