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
	// EmailVerifiedAt — nil означает «почта не подтверждена». Такой
	// пользователь существует, но не может ни войти по паролю, ни получить
	// токены: сессия выдаётся только после ввода кода с почты.
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
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
	// MarkEmailVerified проставляет email_verified_at. Отдельный метод, а не
	// Update с картой: колонка не входит в whitelist произвольных обновлений
	// и меняться должна ровно в одном сценарии.
	MarkEmailVerified(id uuid.UUID, at time.Time) error
	// DeleteUnverifiedBefore удаляет так и не подтверждённые регистрации
	// старше t и возвращает их количество. Нужен уборщику: иначе брошенные
	// записи навсегда удерживают username и email через UNIQUE.
	DeleteUnverifiedBefore(t time.Time) (int64, error)
}
