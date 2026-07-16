package domain

import (
	"time"

	"github.com/google/uuid"
)

type Server struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	IconURL   *string   `json:"icon_url,omitempty"`
	OwnerID   uuid.UUID `json:"owner_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Channel struct {
	ID         uuid.UUID     `json:"id"`
	ServerID   uuid.UUID     `json:"server_id"`
	Name       string        `json:"name"`
	Type       ChannelType   `json:"type"`
	Position   int           `json:"position"`
	CreatedAt  time.Time     `json:"created_at"`
	UpdatedAt  time.Time     `json:"updated_at"`
}

type ChannelType string

const (
	ChannelTypeText     ChannelType = "text"
	ChannelTypeVoice    ChannelType = "voice"
)

type Member struct {
	ServerID uuid.UUID `json:"server_id"`
	UserID   uuid.UUID `json:"user_id"`
	Role     Role      `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

// MemberWithUser — участник сервера с данными профиля, для списка участников
// (эндпоинт GET /servers/{id}/members) и для автокомплита упоминаний на клиенте.
type MemberWithUser struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	Role      Role      `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
}

type ServerRepository interface {
	Create(server *Server) error
	GetByID(id uuid.UUID) (*Server, error)
	GetByOwner(ownerID uuid.UUID) ([]*Server, error)
	GetByMember(userID uuid.UUID) ([]*Server, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
	Search(query string, limit, offset int) ([]*Server, error)
	AddMember(serverID, userID uuid.UUID) error
	RemoveMember(serverID, userID uuid.UUID) error
	IsMember(serverID, userID uuid.UUID) (bool, error)
	// GetMembersWithUsers возвращает всех участников сервера (включая владельца,
	// который не хранится в server_members) вместе с данными профиля.
	GetMembersWithUsers(serverID uuid.UUID) ([]*MemberWithUser, error)
	// GetMemberRole возвращает роль пользователя в сервере (RoleOwner для владельца).
	// Если пользователь не владелец и не участник — возвращает "" без ошибки.
	GetMemberRole(serverID, userID uuid.UUID) (Role, error)
}

type ChannelRepository interface {
	Create(channel *Channel) error
	GetByID(id uuid.UUID) (*Channel, error)
	GetByServerID(serverID uuid.UUID) ([]*Channel, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
}
