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

type stickerRepository struct {
	db *pgxpool.Pool
}

func NewStickerRepository(db *pgxpool.Pool) domain.StickerRepository {
	return &stickerRepository{db: db}
}

func (r *stickerRepository) Create(s *domain.Sticker) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO stickers (id, server_id, name, image_url, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	err := r.db.QueryRow(ctx, query, s.ID, s.ServerID, s.Name, s.ImageURL, s.CreatedBy, s.CreatedAt).Scan(&s.ID)
	if err != nil {
		return fmt.Errorf("failed to create sticker: %w", err)
	}
	return nil
}

func (r *stickerRepository) GetByID(id uuid.UUID) (*domain.Sticker, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT id, server_id, name, image_url, created_by, created_at FROM stickers WHERE id = $1`
	s := &domain.Sticker{}
	err := r.db.QueryRow(ctx, query, id).Scan(&s.ID, &s.ServerID, &s.Name, &s.ImageURL, &s.CreatedBy, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("sticker %s: %w", id, domain.ErrStickerNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sticker: %w", err)
	}
	return s, nil
}

func (r *stickerRepository) ListByServer(serverID uuid.UUID) ([]*domain.Sticker, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT id, server_id, name, image_url, created_by, created_at FROM stickers WHERE server_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to list stickers: %w", err)
	}
	defer rows.Close()

	var stickers []*domain.Sticker
	for rows.Next() {
		s := &domain.Sticker{}
		if err := rows.Scan(&s.ID, &s.ServerID, &s.Name, &s.ImageURL, &s.CreatedBy, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan sticker: %w", err)
		}
		stickers = append(stickers, s)
	}
	return stickers, nil
}

func (r *stickerRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `DELETE FROM stickers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete sticker: %w", err)
	}
	return nil
}
