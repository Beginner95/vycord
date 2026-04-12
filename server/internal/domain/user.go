package domain

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID            uuid.UUID  `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	Password      string     `json:"-"`
	AvatarURL     *string    `json:"avatar_url,omitempty"`
	Status        UserStatus `json:"status"`
	LastServerID  *uuid.UUID `json:"last_server_id,omitempty"`
	LastChannelID *uuid.UUID `json:"last_channel_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type UserStatus string

const (
	StatusOnline  UserStatus = "online"
	StatusIdle    UserStatus = "idle"
	StatusDND     UserStatus = "dnd"
	StatusOffline UserStatus = "offline"
)

type UserRepository interface {
	Create(user *User) error
	GetByID(id uuid.UUID) (*User, error)
	GetByEmail(email string) (*User, error)
	GetByUsername(username string) (*User, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Search(query string, limit, offset int) ([]*User, error)
	UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error
}
