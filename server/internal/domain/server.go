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
	ID        uuid.UUID   `json:"id"`
	ServerID  uuid.UUID   `json:"server_id"`
	Name      string      `json:"name"`
	Type      ChannelType `json:"type"`
	Position  int         `json:"position"`
	IsPrivate bool        `json:"is_private"`
	OwnerID   uuid.UUID   `json:"owner_id"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

// CanAccess сообщает, может ли userID видеть и использовать канал.
// Публичные каналы доступны всем (членство в сервере проверяется отдельно,
// через PermViewChannels — CanAccess её не подменяет). Для приватных —
// доступ есть у владельца канала, владельца сервера, администратора или
// явно приглашённого (isMember). isMember вызывающий проверяет только когда
// нужно — не на каждый вызов CanAccess.
func (c *Channel) CanAccess(userID uuid.UUID, ps PermissionSet, isMember bool) bool {
	if !c.IsPrivate {
		return true
	}
	return c.IsManagedBy(userID, ps) || isMember
}

// IsManagedBy сообщает, обладает ли userID управленческими правами над
// каналом: владелец канала, владелец сервера или администратор. В отличие
// от CanAccess не зависит от IsPrivate и не учитывает isMember — приглашённый
// участник видит приватный канал, но не управляет им (не может пригласить
// других или снова сделать канал приватным). Используется для гейта смены
// приватности и управления channel_members.
func (c *Channel) IsManagedBy(userID uuid.UUID, ps PermissionSet) bool {
	return c.OwnerID == userID || ps.IsOwner || ps.Has(PermAdministrator)
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

// ChannelMemberWithUser — приглашённый участник приватного канала вместе с
// данными профиля, для эндпоинта управления доступом к каналу.
type ChannelMemberWithUser struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	InvitedBy uuid.UUID `json:"invited_by"`
	InvitedAt time.Time `json:"invited_at"`
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
	// AddMember приглашает userID в приватный канал channelID. Идемпотентно.
	AddMember(channelID, userID, invitedBy uuid.UUID) error
	// RemoveMember убирает userID из приглашённых приватного канала.
	RemoveMember(channelID, userID uuid.UUID) error
	// RemoveAllMembers очищает список приглашённых — при переключении
	// приватный → публичный.
	RemoveAllMembers(channelID uuid.UUID) error
	IsMember(channelID, userID uuid.UUID) (bool, error)
	GetMembersWithUsers(channelID uuid.UUID) ([]*ChannelMemberWithUser, error)
}
