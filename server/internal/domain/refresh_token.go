package domain

import (
	"time"

	"github.com/google/uuid"
)

type RefreshToken struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	FamilyID   uuid.UUID
	TokenHash  []byte
	CreatedAt  time.Time
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	ReplacedBy *uuid.UUID
}

type RefreshTokenRepository interface {
	Create(t *RefreshToken) error
	GetByHash(hash []byte) (*RefreshToken, error)
	// GetByID достаёт токен по первичному ключу. Нужен, чтобы проверить
	// живость преемника при выдаче grace-окна ротации: старый токен можно
	// обслужить как ретрай потерянного ответа только если его преемник ещё
	// не отозван. Иначе логаут (RevokeFamily трогает лишь строки с
	// revoked_at IS NULL и потому не задевает уже ротированный токен) можно
	// было бы откатить, предъявив предыдущий токен внутри grace-окна.
	// Возвращает ErrRefreshTokenNotFound, если строки нет.
	GetByID(id uuid.UUID) (*RefreshToken, error)
	// MarkRotated помечает токен id использованным (revoked_at = revokedAt)
	// и записывает id его преемника.
	MarkRotated(id, replacedBy uuid.UUID, revokedAt time.Time) error
	// RevokeFamily отзывает все ещё активные токены семьи — используется
	// и при явном логауте, и при обнаружении reuse украденного токена.
	RevokeFamily(familyID uuid.UUID) error
}
