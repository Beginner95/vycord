package domain

import (
	"time"

	"github.com/google/uuid"
)

// Role — кастомная роль конкретного сервера.
type Role struct {
	ID       uuid.UUID `json:"id"`
	ServerID uuid.UUID `json:"server_id"`
	Name     string    `json:"name"`
	// Color — 0xRRGGBB, 0 означает «без цвета».
	Color int `json:"color"`
	// Position — больше значит выше в иерархии. У @everyone всегда 0.
	Position    int        `json:"position"`
	Permissions Permission `json:"permissions"`
	// IsDefault помечает роль @everyone: она подразумевается для каждого
	// участника и не хранится в member_roles.
	IsDefault bool      `json:"is_default"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RolePatch — частичное обновление роли. nil-поле означает «не менять».
// server_id и is_default не изменяемы и в патче отсутствуют намеренно.
type RolePatch struct {
	Name        *string
	Color       *int
	Position    *int
	Permissions *Permission
}

type RoleRepository interface {
	ListByServer(serverID uuid.UUID) ([]*Role, error)
	GetByID(id uuid.UUID) (*Role, error)
	Create(role *Role) error
	Update(id uuid.UUID, updates map[string]interface{}) error
	Delete(id uuid.UUID) error
	// ResolveMemberPermissions возвращает объединение прав дефолтной роли
	// сервера и всех ролей, назначенных пользователю, вместе с позицией самой
	// высокой из них. Если ролей нет вовсе — (0, -1, nil).
	ResolveMemberPermissions(serverID, userID uuid.UUID) (Permission, int, error)
	// AssignToMember идемпотентен: повторное назначение не возвращает ошибку.
	AssignToMember(serverID, userID, roleID uuid.UUID) error
	UnassignFromMember(serverID, userID, roleID uuid.UUID) error
}
