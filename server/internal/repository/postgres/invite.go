package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type inviteRepository struct {
	db *pgxpool.Pool
}

func NewInviteRepository(db *pgxpool.Pool) domain.InviteRepository {
	return &inviteRepository{db: db}
}

// inviteCodeAlphabet исключает визуально неоднозначные символы (0/O, 1/l/I) —
// код инвайта могут надиктовать или перепечатать вручную, не только кликнуть.
const inviteCodeAlphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const inviteCodeLength = 10

func generateInviteCode() (string, error) {
	b := make([]byte, inviteCodeLength)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(inviteCodeAlphabet))))
		if err != nil {
			return "", err
		}
		b[i] = inviteCodeAlphabet[n.Int64()]
	}
	return string(b), nil
}

func isUniqueCodeViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Create ретраит генерацию кода при коллизии уникальности — пространство
// кодов (58^10) делает коллизию аномалией, а не рутиной, но код проще
// перегенерировать, чем полагаться на их полное отсутствие.
func (r *inviteRepository) Create(invite *domain.Invite) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for attempt := 0; attempt < 5; attempt++ {
		if invite.Code == "" {
			code, err := generateInviteCode()
			if err != nil {
				return fmt.Errorf("generate invite code: %w", err)
			}
			invite.Code = code
		}

		query := `
			INSERT INTO invites (code, server_id, created_by, created_at, expires_at, max_uses, uses)
			VALUES ($1, $2, $3, $4, $5, $6, 0)
		`
		_, err := r.db.Exec(ctx, query, invite.Code, invite.ServerID, invite.CreatedBy, invite.CreatedAt, invite.ExpiresAt, invite.MaxUses)
		if err == nil {
			return nil
		}
		if isUniqueCodeViolation(err) {
			invite.Code = ""
			continue
		}
		return fmt.Errorf("failed to create invite: %w", err)
	}
	return fmt.Errorf("failed to generate a unique invite code after 5 attempts")
}

func (r *inviteRepository) GetByCode(code string) (*domain.Invite, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT code, server_id, created_by, created_at, expires_at, max_uses, uses
		FROM invites
		WHERE code = $1
	`
	inv := &domain.Invite{}
	err := r.db.QueryRow(ctx, query, code).Scan(
		&inv.Code, &inv.ServerID, &inv.CreatedBy, &inv.CreatedAt, &inv.ExpiresAt, &inv.MaxUses, &inv.Uses,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("invite %s: %w", code, domain.ErrInviteNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get invite: %w", err)
	}
	return inv, nil
}

func (r *inviteRepository) ListByServer(serverID uuid.UUID) ([]*domain.Invite, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT code, server_id, created_by, created_at, expires_at, max_uses, uses
		FROM invites
		WHERE server_id = $1
		ORDER BY created_at DESC
	`
	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to query invites: %w", err)
	}
	defer rows.Close()

	var invites []*domain.Invite
	for rows.Next() {
		inv := &domain.Invite{}
		if err := rows.Scan(&inv.Code, &inv.ServerID, &inv.CreatedBy, &inv.CreatedAt, &inv.ExpiresAt, &inv.MaxUses, &inv.Uses); err != nil {
			return nil, fmt.Errorf("failed to scan invite: %w", err)
		}
		invites = append(invites, inv)
	}
	return invites, nil
}

func (r *inviteRepository) IncrementUses(code string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `UPDATE invites SET uses = uses + 1 WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("failed to increment invite uses: %w", err)
	}
	return nil
}

func (r *inviteRepository) Delete(code string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `DELETE FROM invites WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("failed to delete invite: %w", err)
	}
	return nil
}
