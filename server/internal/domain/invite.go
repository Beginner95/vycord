package domain

import (
	"time"

	"github.com/google/uuid"
)

type Invite struct {
	Code      string     `json:"code"`
	ServerID  uuid.UUID  `json:"server_id"`
	CreatedBy uuid.UUID  `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	MaxUses   *int       `json:"max_uses,omitempty"`
	Uses      int        `json:"uses"`
}

// InvitePreview — то, что видно по коду до вступления: сервер, который
// пользователь ещё не открыл никаким иным путём, поэтому здесь только
// минимум, нужный чтобы решить «вступать или нет».
type InvitePreview struct {
	ServerID    uuid.UUID `json:"server_id"`
	ServerName  string    `json:"server_name"`
	IconURL     *string   `json:"icon_url,omitempty"`
	MemberCount int       `json:"member_count"`
}

type InviteRepository interface {
	Create(invite *Invite) error
	GetByCode(code string) (*Invite, error)
	ListByServer(serverID uuid.UUID) ([]*Invite, error)
	IncrementUses(code string) error
	Delete(code string) error
}
