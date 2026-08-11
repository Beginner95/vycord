package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type refreshTokenRepository struct {
	db *pgxpool.Pool
}

func NewRefreshTokenRepository(db *pgxpool.Pool) domain.RefreshTokenRepository {
	return &refreshTokenRepository{db: db}
}

func (r *refreshTokenRepository) Create(t *domain.RefreshToken) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := r.db.Exec(ctx, query, t.ID, t.UserID, t.FamilyID, t.TokenHash, t.CreatedAt, t.ExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to create refresh token: %w", err)
	}
	return nil
}

func (r *refreshTokenRepository) GetByHash(hash []byte) (*domain.RefreshToken, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, user_id, family_id, token_hash, created_at, expires_at, revoked_at, replaced_by
		FROM refresh_tokens
		WHERE token_hash = $1
	`
	t := &domain.RefreshToken{}
	err := r.db.QueryRow(ctx, query, hash).Scan(
		&t.ID, &t.UserID, &t.FamilyID, &t.TokenHash, &t.CreatedAt, &t.ExpiresAt, &t.RevokedAt, &t.ReplacedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrRefreshTokenNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get refresh token: %w", err)
	}
	return t, nil
}

func (r *refreshTokenRepository) MarkRotated(id, replacedBy uuid.UUID, revokedAt time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `UPDATE refresh_tokens SET revoked_at = $1, replaced_by = $2 WHERE id = $3`
	tag, err := r.db.Exec(ctx, query, revokedAt, replacedBy, id)
	if err != nil {
		return fmt.Errorf("failed to mark refresh token rotated: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("refresh token %s: %w", id, domain.ErrRefreshTokenNotFound)
	}
	return nil
}

func (r *refreshTokenRepository) RevokeFamily(familyID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`
	_, err := r.db.Exec(ctx, query, familyID)
	if err != nil {
		return fmt.Errorf("failed to revoke refresh token family: %w", err)
	}
	return nil
}
