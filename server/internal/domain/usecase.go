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

type ServerUseCase interface {
	CreateServer(name string, ownerID uuid.UUID) (*Server, error)
	GetServer(id uuid.UUID) (*Server, error)
	GetUserServers(userID uuid.UUID) ([]*Server, error)
	JoinServer(serverID, userID uuid.UUID) error
	LeaveServer(serverID, userID uuid.UUID) error
	SearchServers(query string, limit int) ([]*Server, error)
	CreateChannel(serverID uuid.UUID, name string, channelType ChannelType) (*Channel, error)
	GetChannels(serverID uuid.UUID) ([]*Channel, error)
	GetMembers(serverID, userID uuid.UUID) ([]*MemberWithUser, error)
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
