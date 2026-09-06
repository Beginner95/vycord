package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type blockRepository struct {
	db *pgxpool.Pool
}

func NewBlockRepository(db *pgxpool.Pool) domain.BlockRepository {
	return &blockRepository{db: db}
}

func (r *blockRepository) List(blockerID uuid.UUID) ([]*domain.UserBrief, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT u.id, u.username, u.avatar_url
		FROM user_blocks b
		JOIN users u ON u.id = b.blocked_id
		WHERE b.blocker_id = $1
		ORDER BY u.username
	`
	rows, err := r.db.Query(ctx, query, blockerID)
	if err != nil {
		return nil, fmt.Errorf("failed to list blocks: %w", err)
	}
	defer rows.Close()

	blocked := make([]*domain.UserBrief, 0)
	for rows.Next() {
		u := &domain.UserBrief{}
		if err := rows.Scan(&u.UserID, &u.Username, &u.AvatarURL); err != nil {
			return nil, fmt.Errorf("failed to scan blocked user: %w", err)
		}
		blocked = append(blocked, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate blocks: %w", err)
	}
	return blocked, nil
}

// Block — единственное место в этой фазе, где транзакция действительно
// нужна: удаление дружбы и вставка блокировки обязаны примениться вместе.
// Блокировка, оставившая человека в друзьях, всплыла бы в любом списке.
func (r *blockRepository) Block(blockerID, blockedID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin block tx: %w", err)
	}
	// Rollback после успешного Commit — no-op (pgx возвращает
	// ErrTxClosed, который здесь намеренно игнорируется).
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		DELETE FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2)
		   OR (requester_id = $2 AND addressee_id = $1)
	`, blockerID, blockedID)
	if err != nil {
		return fmt.Errorf("failed to drop friendship on block: %w", err)
	}

	// Идемпотентность: повторная блокировка — не ошибка.
	_, err = tx.Exec(ctx, `
		INSERT INTO user_blocks (blocker_id, blocked_id)
		VALUES ($1, $2)
		ON CONFLICT (blocker_id, blocked_id) DO NOTHING
	`, blockerID, blockedID)
	if err != nil {
		return fmt.Errorf("failed to insert block: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit block: %w", err)
	}
	return nil
}

func (r *blockRepository) Unblock(blockerID, blockedID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Разблокировка идемпотентна: снятие несуществующей блокировки —
	// не ошибка, а желаемое состояние, которое уже достигнуто.
	_, err := r.db.Exec(ctx, `
		DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
	`, blockerID, blockedID)
	if err != nil {
		return fmt.Errorf("failed to unblock: %w", err)
	}
	return nil
}

func (r *blockRepository) IsBlockedEither(a, b uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT EXISTS (
			SELECT 1 FROM user_blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
			   OR (blocker_id = $2 AND blocked_id = $1)
		)
	`
	var exists bool
	if err := r.db.QueryRow(ctx, query, a, b).Scan(&exists); err != nil {
		return false, fmt.Errorf("failed to check block: %w", err)
	}
	return exists, nil
}
