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
	IsPrivate bool      `json:"is_private"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Channel struct {
	ID        uuid.UUID   `json:"id"`
	ServerID  uuid.UUID   `json:"server_id"`
	Name      string      `json:"name"`
	Type      ChannelType `json:"type"`
	Position  int         `json:"position"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

type ChannelType string

const (
	ChannelTypeText  ChannelType = "text"
	ChannelTypeVoice ChannelType = "voice"
)

type Member struct {
	ServerID uuid.UUID `json:"server_id"`
	UserID   uuid.UUID `json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
}

// MemberWithUser — участник сервера с данными профиля, для списка участников
// (эндпоинт GET /servers/{id}/members) и для автокомплита упоминаний на клиенте.
// Roles — идентификаторы назначенных ролей без @everyone: она подразумевается
// для каждого участника и в member_roles не хранится.
type MemberWithUser struct {
	UserID    uuid.UUID   `json:"user_id"`
	Username  string      `json:"username"`
	AvatarURL *string     `json:"avatar_url,omitempty"`
	Roles     []uuid.UUID `json:"roles"`
	JoinedAt  time.Time   `json:"joined_at"`
}

type ServerRepository interface {
	Create(server *Server) error
	GetByID(id uuid.UUID) (*Server, error)
	// GetByName возвращает сервер с таким именем без учёта регистра.
	// ErrServerNotFound — если сервер с таким именем не существует.
	GetByName(name string) (*Server, error)
	GetByOwner(ownerID uuid.UUID) ([]*Server, error)
	GetByMember(userID uuid.UUID) ([]*Server, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
	// Search ищет только публичные серверы — приватные не участвуют в
	// discovery ни для кого, включая собственных участников (см. дизайн-спеку).
	Search(query string, limit, offset int) ([]*Server, error)
	AddMember(serverID, userID uuid.UUID) error
	RemoveMember(serverID, userID uuid.UUID) error
	IsMember(serverID, userID uuid.UUID) (bool, error)
	// GetMembersWithUsers возвращает всех участников сервера (включая владельца,
	// который с миграции 009 хранится обычной строкой в server_members) вместе
	// с данными профиля.
	GetMembersWithUsers(serverID uuid.UUID) ([]*MemberWithUser, error)
}

type ChannelRepository interface {
	Create(channel *Channel) error
	GetByID(id uuid.UUID) (*Channel, error)
	GetByServerID(serverID uuid.UUID) ([]*Channel, error)
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
	// DeleteIfNotLast deletes the channel only if it is not the last remaining
	// channel of its server, atomically. Returns false (no error) if it was
	// the last channel and nothing was deleted.
	DeleteIfNotLast(id, serverID uuid.UUID) (bool, error)
}
