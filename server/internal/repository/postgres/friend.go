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

type friendRepository struct {
	db *pgxpool.Pool
}

func NewFriendRepository(db *pgxpool.Pool) domain.FriendRepository {
	return &friendRepository{db: db}
}

func (r *friendRepository) GetFriends(userID uuid.UUID) ([]*domain.FriendProfile, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Дружба симметрична и лежит одной строкой, поэтому «другая сторона»
	// вычисляется CASE, а не двумя запросами с UNION.
	query := `
		SELECT u.id, u.username, u.avatar_url, f.accepted_at
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.requester_id = $1
		                            THEN f.addressee_id ELSE f.requester_id END
		WHERE (f.requester_id = $1 OR f.addressee_id = $1)
		  AND f.status = 'accepted'
		ORDER BY u.username
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get friends: %w", err)
	}
	defer rows.Close()

	friends := make([]*domain.FriendProfile, 0)
	for rows.Next() {
		p := &domain.FriendProfile{}
		if err := rows.Scan(&p.UserID, &p.Username, &p.AvatarURL, &p.FriendsSince); err != nil {
			return nil, fmt.Errorf("failed to scan friend: %w", err)
		}
		friends = append(friends, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate friends: %w", err)
	}
	return friends, nil
}

func (r *friendRepository) GetPending(userID uuid.UUID) ([]*domain.FriendRequest, []*domain.FriendRequest, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// is_incoming отделяет входящие от исходящих в одном проходе: два
	// запроса ради этого — лишний round-trip.
	query := `
		SELECT f.id, u.id, u.username, u.avatar_url, f.created_at,
		       (f.addressee_id = $1) AS is_incoming
		FROM friendships f
		JOIN users u ON u.id = CASE WHEN f.requester_id = $1
		                            THEN f.addressee_id ELSE f.requester_id END
		WHERE (f.requester_id = $1 OR f.addressee_id = $1)
		  AND f.status = 'pending'
		ORDER BY f.created_at DESC
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get pending requests: %w", err)
	}
	defer rows.Close()

	incoming := make([]*domain.FriendRequest, 0)
	outgoing := make([]*domain.FriendRequest, 0)
	for rows.Next() {
		req := &domain.FriendRequest{}
		var isIncoming bool
		if err := rows.Scan(&req.ID, &req.User.UserID, &req.User.Username,
			&req.User.AvatarURL, &req.CreatedAt, &isIncoming); err != nil {
			return nil, nil, fmt.Errorf("failed to scan request: %w", err)
		}
		if isIncoming {
			incoming = append(incoming, req)
		} else {
			outgoing = append(outgoing, req)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("failed to iterate requests: %w", err)
	}
	return incoming, outgoing, nil
}

func (r *friendRepository) GetByPair(a, b uuid.UUID) (*domain.Friendship, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, requester_id, addressee_id, status, created_at, accepted_at
		FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2)
		   OR (requester_id = $2 AND addressee_id = $1)
	`
	f := &domain.Friendship{}
	err := r.db.QueryRow(ctx, query, a, b).Scan(
		&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &f.AcceptedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrFriendshipNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get friendship: %w", err)
	}
	return f, nil
}

func (r *friendRepository) Create(f *domain.Friendship) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO friendships (id, requester_id, addressee_id, status, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := r.db.Exec(ctx, query, f.ID, f.RequesterID, f.AddresseeID, f.Status, f.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to create friendship: %w", err)
	}
	return nil
}

func (r *friendRepository) Accept(id, addresseeID uuid.UUID, at time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Условие внутри UPDATE — вся защита от гонки: принять можно только
	// СВОЮ и только ещё не принятую заявку. Отдельная транзакция не нужна.
	query := `
		UPDATE friendships
		SET status = 'accepted', accepted_at = $3
		WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
	`
	tag, err := r.db.Exec(ctx, query, id, addresseeID, at)
	if err != nil {
		return fmt.Errorf("failed to accept friendship: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrFriendshipNotFound
	}
	return nil
}

func (r *friendRepository) Delete(id, actorID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		DELETE FROM friendships
		WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
	`
	tag, err := r.db.Exec(ctx, query, id, actorID)
	if err != nil {
		return fmt.Errorf("failed to delete friendship: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrFriendshipNotFound
	}
	return nil
}

func (r *friendRepository) DeleteByPair(a, b uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		DELETE FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2)
		   OR (requester_id = $2 AND addressee_id = $1)
	`
	tag, err := r.db.Exec(ctx, query, a, b)
	if err != nil {
		return fmt.Errorf("failed to delete friendship: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrFriendshipNotFound
	}
	return nil
}

func (r *friendRepository) IsFriend(a, b uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT EXISTS (
			SELECT 1 FROM friendships
			WHERE status = 'accepted'
			  AND ((requester_id = $1 AND addressee_id = $2)
			    OR (requester_id = $2 AND addressee_id = $1))
		)
	`
	var exists bool
	if err := r.db.QueryRow(ctx, query, a, b).Scan(&exists); err != nil {
		return false, fmt.Errorf("failed to check friendship: %w", err)
	}
	return exists, nil
}
