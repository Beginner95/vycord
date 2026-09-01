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

type otpRepository struct {
	db *pgxpool.Pool
}

func NewOTPRepository(db *pgxpool.Pool) domain.OTPRepository {
	return &otpRepository{db: db}
}

func (r *otpRepository) Create(c *domain.OTPCode) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO otp_codes (id, user_id, purpose, code_hash, attempts, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := r.db.Exec(ctx, query, c.ID, c.UserID, c.Purpose, c.CodeHash, c.Attempts, c.CreatedAt, c.ExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to create otp code: %w", err)
	}
	return nil
}

// GetActive берёт самый свежий живой код. ORDER BY created_at DESC LIMIT 1 —
// страховка на случай, если InvalidateActive не отработал: выдаём последний,
// а не произвольный.
func (r *otpRepository) GetActive(userID uuid.UUID, p domain.OTPPurpose) (*domain.OTPCode, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, user_id, purpose, code_hash, attempts, created_at, expires_at, consumed_at, invalidated_at
		FROM otp_codes
		WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`
	c := &domain.OTPCode{}
	err := r.db.QueryRow(ctx, query, userID, p).Scan(
		&c.ID, &c.UserID, &c.Purpose, &c.CodeHash, &c.Attempts,
		&c.CreatedAt, &c.ExpiresAt, &c.ConsumedAt, &c.InvalidatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrOTPNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get active otp code: %w", err)
	}
	return c, nil
}

// IncrementAttempts — проверка остатка и расход слота одним UPDATE, а не
// чтением с последующей записью: условие attempts < $2 живёт в самом WHERE,
// поэтому из N параллельных попыток строку успевают задеть ровно maxAttempts
// штук, сколько бы запросов ни пришло одновременно. Условия по consumed_at и
// invalidated_at здесь не лишние: мёртвый код не должен тратить слоты и, что
// важнее, не должен отвечать «попытка засчитана» после того, как параллельный
// запрос его погасил.
func (r *otpRepository) IncrementAttempts(id uuid.UUID, maxAttempts int) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var attempts int
	err := r.db.QueryRow(ctx,
		`UPDATE otp_codes SET attempts = attempts + 1
		 WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL AND invalidated_at IS NULL
		 RETURNING attempts`, id, maxAttempts,
	).Scan(&attempts)
	// Ноль строк здесь означает не «нет такой строки», а «попыток не
	// осталось либо код уже мёртв». Юзкейс различает это по сентинелу и
	// отвечает ErrOTPAttemptsExceeded, как и в Consume.
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrOTPNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("failed to increment otp attempts: %w", err)
	}
	return attempts, nil
}

// Consume гасит код ровно один раз. Условие consumed_at IS NULL в WHERE и
// проверка RowsAffected — единственное, что мешает двум одновременным
// verify с верным кодом выдать две сессии.
func (r *otpRepository) Consume(id uuid.UUID, at time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx,
		`UPDATE otp_codes SET consumed_at = $1
		 WHERE id = $2 AND consumed_at IS NULL AND invalidated_at IS NULL`, at, id)
	if err != nil {
		return fmt.Errorf("failed to consume otp code: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrOTPNotFound
	}
	return nil
}

func (r *otpRepository) InvalidateActive(userID uuid.UUID, p domain.OTPPurpose) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx,
		`UPDATE otp_codes SET invalidated_at = now()
		 WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
		userID, p)
	if err != nil {
		return fmt.Errorf("failed to invalidate otp codes: %w", err)
	}
	return nil
}

// CountIssuedSince считает ВСЕ выпущенные коды за окно, включая погашенные и
// аннулированные: часовой лимит ограничивает отправку писем, а не количество
// живых кодов.
func (r *otpRepository) CountIssuedSince(userID uuid.UUID, p domain.OTPPurpose, since time.Time) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var count int
	err := r.db.QueryRow(ctx,
		`SELECT count(*) FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND created_at >= $3`,
		userID, p, since,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count otp codes: %w", err)
	}
	return count, nil
}

func (r *otpRepository) LastIssuedAt(userID uuid.UUID, p domain.OTPPurpose) (*time.Time, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var last *time.Time
	err := r.db.QueryRow(ctx,
		`SELECT max(created_at) FROM otp_codes WHERE user_id = $1 AND purpose = $2`,
		userID, p,
	).Scan(&last)
	if err != nil {
		return nil, fmt.Errorf("failed to get last otp issue time: %w", err)
	}
	return last, nil
}

func (r *otpRepository) DeleteExpiredBefore(t time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx, `DELETE FROM otp_codes WHERE expires_at < $1`, t)
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired otp codes: %w", err)
	}
	return tag.RowsAffected(), nil
}
