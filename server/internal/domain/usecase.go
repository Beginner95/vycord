package domain

import "github.com/google/uuid"

type AuthUseCase interface {
	Register(username, email, password string) (*User, string, error)
	Login(email, password string) (*User, string, error)
	ValidateToken(tokenString string) (*User, error)
}

type UserUseCase interface {
	GetByID(id uuid.UUID) (*User, error)
	Search(query string, limit int) ([]*User, error)
	UpdateStatus(id uuid.UUID, status UserStatus) error
	GetOnlineUserIDs() []uuid.UUID
	UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error
	UpdateAvatar(id uuid.UUID, data []byte) (*User, error)
	RemoveAvatar(id uuid.UUID) (*User, error)
}

// ChannelAccessChecker — минимальный срез ServerUseCase для мест, которым
// важно только «есть ли доступ», а не весь набор операций над сервером
// (WS-хаб, выдача voice-токенов для SFU).
type ChannelAccessChecker interface {
	// CheckChannelAccess возвращает канал, если userID может его видеть и
	// использовать: публичный канал требует членства в сервере
	// (PermViewChannels), приватный — дополнительно Channel.CanAccess.
	CheckChannelAccess(channelID, userID uuid.UUID) (*Channel, error)
	// GetChannelAudience возвращает ID пользователей, которым можно
	// адресовать реалтайм-события приватного канала (войс-ростер и т.п.).
	// nil означает «канал публичный, шли всем подключённым».
	GetChannelAudience(channelID uuid.UUID) ([]uuid.UUID, error)
}

type ServerUseCase interface {
	ChannelAccessChecker
	CreateServer(name string, ownerID uuid.UUID) (*Server, error)
	GetServer(id uuid.UUID) (*Server, error)
	GetUserServers(userID uuid.UUID) ([]*Server, error)
	JoinServer(serverID, userID uuid.UUID) error
	LeaveServer(serverID, userID uuid.UUID) error
	SearchServers(query string, limit int) ([]*Server, error)
	CreateChannel(serverID, userID uuid.UUID, name string, channelType ChannelType, isPrivate bool) (*Channel, error)
	GetChannels(serverID, userID uuid.UUID) ([]*Channel, error)
	GetMembers(serverID, userID uuid.UUID) ([]*MemberWithUser, error)
	UpdateServer(serverID, userID uuid.UUID, name string) (*Server, error)
	DeleteServer(serverID, userID uuid.UUID) error
	UpdateChannel(serverID, channelID, userID uuid.UUID, name string, isPrivate bool) (*Channel, error)
	DeleteChannel(serverID, channelID, userID uuid.UUID) error
	UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*Server, error)
	RemoveServerIcon(serverID, userID uuid.UUID) (*Server, error)
	InviteToChannel(serverID, channelID, inviterID, targetUserID uuid.UUID) error
	RemoveFromChannel(serverID, channelID, removerID, targetUserID uuid.UUID) error
	GetChannelMembers(serverID, channelID, userID uuid.UUID) ([]*ChannelMemberWithUser, error)
}

type MessageUseCase interface {
	CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
	GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
	SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*MessageWithAuthor, int, error)
	GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*Message, error)
	UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*Message, error)
	DeleteMessage(channelID, messageID, userID uuid.UUID) error
}

type TURNUseCase interface {
	// GetCredentials returns ephemeral TURN credentials for the user, or
	// (nil, nil) when no TURN server is configured.
	GetCredentials(userID uuid.UUID) (*TURNCredentials, error)
}

type VoiceTokenUseCase interface {
	// IssueToken mints a short-lived JWT scoped to a single SFU room after
	// verifying userID may access channelID (server membership, and — for
	// private channels — CanAccess). Requires channelID to be a voice channel.
	IssueToken(channelID, userID uuid.UUID) (string, error)
}

type PermissionUseCase interface {
	// Resolve возвращает эффективные права пользователя на сервере.
	// Не-участник получает нулевой набор, а не ошибку.
	Resolve(serverID, userID uuid.UUID) (PermissionSet, error)
}

type RoleUseCase interface {
	ListRoles(serverID, userID uuid.UUID) ([]*Role, error)
	CreateRole(serverID, actorID uuid.UUID, name string, color, position int, perms Permission) (*Role, error)
	UpdateRole(serverID, roleID, actorID uuid.UUID, patch RolePatch) (*Role, error)
	DeleteRole(serverID, roleID, actorID uuid.UUID) error
	AssignRole(serverID, targetUserID, roleID, actorID uuid.UUID) error
	UnassignRole(serverID, targetUserID, roleID, actorID uuid.UUID) error
}
