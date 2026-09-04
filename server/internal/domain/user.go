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
	// LastSeenAt — момент последнего реального WS-дисконнекта. nil, если
	// пользователь ни разу не выходил в офлайн (включая свежую регистрацию).
	// json:"-": сериализация напрямую из domain.User обходила бы приватность
	// (show_last_seen) — только GetLastSeenBatch/domain.LastSeenInfo решает,
	// показывать ли значение.
	LastSeenAt *time.Time `json:"-"`
	// ShowLastSeen — приватность: false скрывает LastSeenAt от всех, кто
	// спрашивает через GetLastSeenBatch. По умолчанию true (миграция 023).
	ShowLastSeen bool `json:"show_last_seen"`
	// AllowFriendRequests — кто может слать заявку в друзья: everyone /
	// mutual_servers / none. Дефолт everyone (миграция 024).
	AllowFriendRequests PrivacyMode `json:"allow_friend_requests"`
	// AllowDMFrom — кто может писать в ЛС: everyone / mutual_servers /
	// friends. Дефолт friends (миграция 024) — самый строгий разумный
	// режим: переписка с друзьями им не ограничивается.
	AllowDMFrom PrivacyMode `json:"allow_dm_from"`
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
	// UpdateLastSeen проставляет last_seen_at. Отдельный метод, а не Update
	// с картой — тот же принцип, что уже применён к MarkEmailVerified: не
	// входит в whitelist произвольных обновлений, меняется ровно в одном
	// сценарии (дисконнект WS), клиент не может дёрнуть его напрямую.
	UpdateLastSeen(id uuid.UUID, at time.Time) error
	// GetLastSeenBatch возвращает last-seen-инфо для запрошенных id одним
	// запросом. Отсутствующие id просто не попадают в результат.
	GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]LastSeenInfo, error)
}

// LastSeenInfo — снимок «когда видели» с учётом приватности: Visible=false
// всегда идёт с LastSeenAt=nil, разворачивается репозиторием одним SQL
// CASE, не постфактум в Go.
type LastSeenInfo struct {
	LastSeenAt *time.Time
	Visible    bool
}
