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

type callRepository struct {
	db *pgxpool.Pool
}

func NewCallRepository(db *pgxpool.Pool) domain.CallRepository {
	return &callRepository{db: db}
}

const callColumns = `id, caller_id, receiver_id, status, started_at, accepted_at, ended_at`

func scanCall(row pgx.Row) (*domain.Call, error) {
	c := &domain.Call{}
	err := row.Scan(&c.ID, &c.CallerID, &c.ReceiverID, &c.Status, &c.StartedAt, &c.AcceptedAt, &c.EndedAt)
	return c, err
}

func (r *callRepository) Create(call *domain.Call) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := r.db.Exec(ctx,
		`INSERT INTO calls (id, caller_id, receiver_id, status, started_at) VALUES ($1, $2, $3, $4, $5)`,
		call.ID, call.CallerID, call.ReceiverID, call.Status, call.StartedAt)
	if err != nil {
		return fmt.Errorf("create call: %w", err)
	}
	return nil
}

func (r *callRepository) GetByID(id uuid.UUID) (*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := scanCall(r.db.QueryRow(ctx, `SELECT `+callColumns+` FROM calls WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrCallNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get call: %w", err)
	}
	return c, nil
}

func (r *callRepository) ListLiveByUser(userID uuid.UUID) ([]*domain.Call, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := r.db.Query(ctx, `
		SELECT `+callColumns+` FROM calls
		WHERE (caller_id = $1 OR receiver_id = $1) AND status IN ('ringing', 'active')
		ORDER BY started_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list live calls: %w", err)
	}
	defer rows.Close()
	var out []*domain.Call
	for rows.Next() {
		c, err := scanCall(rows)
		if err != nil {
			return nil, fmt.Errorf("scan live call: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *callRepository) Transition(id uuid.UUID, from []domain.CallStatus, to domain.CallStatus, at time.Time) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	fromStr := make([]string, len(from))
	for i, s := range from {
		fromStr[i] = string(s)
	}
	tag, err := r.db.Exec(ctx, `
		UPDATE calls SET
			status      = $2::varchar,
			accepted_at = CASE WHEN $2::varchar = 'active' THEN $4 ELSE accepted_at END,
			ended_at    = CASE WHEN $2::varchar IN ('ended', 'missed', 'rejected') THEN $4 ELSE ended_at END
		WHERE id = $1 AND status = ANY($3)`, id, string(to), fromStr, at)
	if err != nil {
		return false, fmt.Errorf("transition call: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *callRepository) CloseAllLive(at time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tag, err := r.db.Exec(ctx, `
		UPDATE calls SET
			status   = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'ended' END,
			ended_at = $1
		WHERE status IN ('ringing', 'active')`, at)
	if err != nil {
		return 0, fmt.Errorf("close live calls: %w", err)
	}
	return tag.RowsAffected(), nil
}

func (r *callRepository) Exists(id uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var ok bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE id = $1)`, id).Scan(&ok); err != nil {
		return false, fmt.Errorf("call exists: %w", err)
	}
	return ok, nil
}
