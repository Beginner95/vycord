package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type channelRepository struct {
	db *pgxpool.Pool
}

func NewChannelRepository(db *pgxpool.Pool) domain.ChannelRepository {
	return &channelRepository{db: db}
}

func (r *channelRepository) Create(channel *domain.Channel) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO channels (id, server_id, name, type, position, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		channel.ID,
		channel.ServerID,
		channel.Name,
		channel.Type,
		channel.Position,
		channel.CreatedAt,
		channel.UpdatedAt,
	).Scan(&channel.ID)

	if err != nil {
		return fmt.Errorf("failed to create channel: %w", err)
	}

	return nil
}

func (r *channelRepository) GetByID(id uuid.UUID) (*domain.Channel, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, server_id, name, type, position, created_at, updated_at
		FROM channels
		WHERE id = $1
	`

	channel := &domain.Channel{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&channel.ID,
		&channel.ServerID,
		&channel.Name,
		&channel.Type,
		&channel.Position,
		&channel.CreatedAt,
		&channel.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("channel %s: %w", id, domain.ErrChannelNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get channel: %w", err)
	}

	return channel, nil
}

func (r *channelRepository) GetByServerID(serverID uuid.UUID) ([]*domain.Channel, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, server_id, name, type, position, created_at, updated_at
		FROM channels
		WHERE server_id = $1
		ORDER BY position ASC
	`

	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to query channels: %w", err)
	}
	defer rows.Close()

	var channels []*domain.Channel
	for rows.Next() {
		c := &domain.Channel{}
		if err := rows.Scan(&c.ID, &c.ServerID, &c.Name, &c.Type, &c.Position, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan channel: %w", err)
		}
		channels = append(channels, c)
	}

	return channels, nil
}

var allowedChannelColumns = map[string]string{
	"name":     "name",
	"position": "position",
}

func (r *channelRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range updates {
		colName, ok := allowedChannelColumns[key]
		if !ok {
			continue
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", colName, argIdx))
		args = append(args, value)
		argIdx++
	}

	if len(setClauses) == 0 {
		return fmt.Errorf("no valid columns to update")
	}

	setClauses = append(setClauses, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, time.Now())

	query := fmt.Sprintf(
		"UPDATE channels SET %s WHERE id = $%d",
		strings.Join(setClauses, ", "),
		argIdx+1,
	)
	args = append(args, id)

	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update channel: %w", err)
	}

	return nil
}

func (r *channelRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := "DELETE FROM channels WHERE id = $1"
	_, err := r.db.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete channel: %w", err)
	}

	return nil
}

// DeleteIfNotLast deletes the channel in a single atomic statement, only if
// the server has more than one channel — closes the race window between a
// separate count-check and delete.
func (r *channelRepository) DeleteIfNotLast(id, serverID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		DELETE FROM channels
		WHERE id = $1
		AND (SELECT COUNT(*) FROM channels WHERE server_id = $2) > 1
	`
	tag, err := r.db.Exec(ctx, query, id, serverID)
	if err != nil {
		return false, fmt.Errorf("failed to delete channel: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
