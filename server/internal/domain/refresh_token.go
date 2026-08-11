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
	// MarkRotated помечает токен id использованным (revoked_at = revokedAt)
	// и записывает id его преемника.
	MarkRotated(id, replacedBy uuid.UUID, revokedAt time.Time) error
	// RevokeFamily отзывает все ещё активные токены семьи — используется
	// и при явном логауте, и при обнаружении reuse украденного токена.
	RevokeFamily(familyID uuid.UUID) error
}
