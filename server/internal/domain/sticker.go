package domain

import (
	"time"

	"github.com/google/uuid"
)

// Sticker — серверный стикер: изображение, видимое всем участникам сервера.
type Sticker struct {
	ID        uuid.UUID `json:"id"`
	ServerID  uuid.UUID `json:"server_id"`
	Name      string    `json:"name"`
	ImageURL  string    `json:"image_url"`
	CreatedBy uuid.UUID `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// StickerRepository — доступ к стикерам сервера.
type StickerRepository interface {
	Create(s *Sticker) error
	GetByID(id uuid.UUID) (*Sticker, error)
	ListByServer(serverID uuid.UUID) ([]*Sticker, error)
	Delete(id uuid.UUID) error
}