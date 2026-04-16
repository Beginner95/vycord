package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type callRepository struct {
	db *pgxpool.Pool
}

func NewCallRepository(db *pgxpool.Pool) domain.CallRepository {
	return &callRepository{db: db}
}

func (r *callRepository) Create(call *domain.Call) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO calls (id, caller_id, receiver_id, status, started_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		call.ID,
		call.CallerID,
		call.ReceiverID,
		call.Status,
		call.StartedAt,
	).Scan(&call.ID)

	if err != nil {
		return fmt.Errorf("failed to create call: %w", err)
	}

	return nil
}

func (r *callRepository) GetByID(id uuid.UUID) (*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, caller_id, receiver_id, status, started_at, ended_at
		FROM calls
		WHERE id = $1
	`

	call := &domain.Call{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&call.ID,
		&call.CallerID,
		&call.ReceiverID,
		&call.Status,
		&call.StartedAt,
		&call.EndedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("call not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get call: %w", err)
	}

	return call, nil
}

func (r *callRepository) GetActiveByUser(userID uuid.UUID) (*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, caller_id, receiver_id, status, started_at, ended_at
		FROM calls
		WHERE (caller_id = $1 OR receiver_id = $1)
		  AND status IN ('ringing', 'active')
		ORDER BY started_at DESC
		LIMIT 1
	`

	call := &domain.Call{}
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&call.ID,
		&call.CallerID,
		&call.ReceiverID,
		&call.Status,
		&call.StartedAt,
		&call.EndedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil // No active call
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get active call: %w", err)
	}

	return call, nil
}

func (r *callRepository) UpdateStatus(id uuid.UUID, status domain.CallStatus) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := "UPDATE calls SET status = $1 WHERE id = $2"
	_, err := r.db.Exec(ctx, query, status, id)
	if err != nil {
		return fmt.Errorf("failed to update call status: %w", err)
	}

	return nil
}

func (r *callRepository) EndAllActiveByUser(userID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		UPDATE calls
		SET status = 'ended', ended_at = NOW()
		WHERE (caller_id = $1 OR receiver_id = $1)
		  AND status IN ('ringing', 'active')
	`
	_, err := r.db.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to end stale calls: %w", err)
	}
	return nil
}

func (r *callRepository) SetEndTime(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := "UPDATE calls SET ended_at = NOW() WHERE id = $1"
	_, err := r.db.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to set call end time: %w", err)
	}

	return nil
}
