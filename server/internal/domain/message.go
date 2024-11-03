package domain

import (
	"time"

	"github.com/google/uuid"
)

type Message struct {
	ID        uuid.UUID  `json:"id"`
	ChannelID uuid.UUID  `json:"channel_id"`
	UserID    uuid.UUID  `json:"user_id"`
	Content   string     `json:"content"`
	Attachments []string `json:"attachments,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type MessageRepository interface {
	Create(msg *Message) error
	GetByID(id uuid.UUID) (*Message, error)
	GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*Message, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
}
