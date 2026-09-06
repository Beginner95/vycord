package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type userRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) domain.UserRepository {
	return &userRepository{db: db}
}

func (r *userRepository) Create(user *domain.User) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO users (id, username, email, password_hash, avatar_url, status, created_at, updated_at, email_verified_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		user.ID,
		user.Username,
		user.Email,
		user.Password,
		user.AvatarURL,
		user.Status,
		user.CreatedAt,
		user.UpdatedAt,
		user.EmailVerifiedAt,
	).Scan(&user.ID)

	if err != nil {
		// users_username_key — единственное ограничение, реально достижимое
		// через этот путь: identifier-first уже проверяет GetByUsername и
		// сериализует одноимённые email через Consume до Create (см.
		// otpUseCase.VerifyCode), так что users_email_key сюда не долетает.
		// Проверяем его тоже — задаром и без нового обработчика в handler'е,
		// раз ErrEmailTaken уже существует как сентинел.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if strings.Contains(pgErr.ConstraintName, "username") {
				return domain.ErrUsernameTaken
			}
			if strings.Contains(pgErr.ConstraintName, "email") {
				return domain.ErrEmailTaken
			}
		}
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (r *userRepository) GetByID(id uuid.UUID) (*domain.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, username, email, password_hash, avatar_url, status,
		       last_server_id, last_channel_id, created_at, updated_at, email_verified_at,
		       last_seen_at, show_last_seen, allow_friend_requests, allow_dm_from
		FROM users
		WHERE id = $1
	`

	user := &domain.User{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.Password,
		&user.AvatarURL,
		&user.Status,
		&user.LastServerID,
		&user.LastChannelID,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.EmailVerifiedAt,
		&user.LastSeenAt,
		&user.ShowLastSeen,
		&user.AllowFriendRequests,
		&user.AllowDMFrom,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

func (r *userRepository) GetByEmail(email string) (*domain.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, username, email, password_hash, avatar_url, status, created_at, updated_at, email_verified_at,
		       last_seen_at, show_last_seen, allow_friend_requests, allow_dm_from
		FROM users
		WHERE email = $1
	`

	user := &domain.User{}
	err := r.db.QueryRow(ctx, query, email).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.Password,
		&user.AvatarURL,
		&user.Status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.EmailVerifiedAt,
		&user.LastSeenAt,
		&user.ShowLastSeen,
		&user.AllowFriendRequests,
		&user.AllowDMFrom,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

func (r *userRepository) GetByUsername(username string) (*domain.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, username, email, password_hash, avatar_url, status, created_at, updated_at, email_verified_at,
		       last_seen_at, show_last_seen, allow_friend_requests, allow_dm_from
		FROM users
		WHERE username = $1
	`

	user := &domain.User{}
	err := r.db.QueryRow(ctx, query, username).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.Password,
		&user.AvatarURL,
		&user.Status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.EmailVerifiedAt,
		&user.LastSeenAt,
		&user.ShowLastSeen,
		&user.AllowFriendRequests,
		&user.AllowDMFrom,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return user, nil
}

// allowedUpdateColumns maps accepted input keys to literal SQL column names.
// The SQL column name (map value) is always a developer-controlled string —
// never user input - so it is safe to interpolate into the query.
var allowedUpdateColumns = map[string]string{
	"status":          "status",
	"avatar_url":      "avatar_url",
	"last_server_id":  "last_server_id",
	"last_channel_id": "last_channel_id",
	"username":        "username",
	"password":        "password_hash",
	"show_last_seen":  "show_last_seen",
}

func (r *userRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range updates {
		colName, ok := allowedUpdateColumns[key]
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
		"UPDATE users SET %s WHERE id = $%d",
		strings.Join(setClauses, ", "),
		argIdx+1,
	)
	args = append(args, id)

	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

func (r *userRepository) Search(query string, limit, offset int) ([]*domain.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Не выбираем allow_friend_requests/allow_dm_from: результаты поиска —
	// это никогда "я сам", а domain.User больше не сериализует эти поля
	// напрямую (json:"-"), так что читать их здесь незачем.
	sqlQuery := `
		SELECT id, username, email, avatar_url, status, created_at, updated_at
		FROM users
		WHERE username ILIKE $1
		ORDER BY username
		LIMIT $2 OFFSET $3
	`

	searchPattern := "%" + query + "%"
	rows, err := r.db.Query(ctx, sqlQuery, searchPattern, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to search users: %w", err)
	}
	defer rows.Close()

	var users []*domain.User
	for rows.Next() {
		user := &domain.User{}
		err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.Email,
			&user.AvatarURL,
			&user.Status,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, user)
	}

	return users, nil
}

func (r *userRepository) UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		UPDATE users
		SET last_server_id = $1, last_channel_id = $2, updated_at = $3
		WHERE id = $4
	`
	_, err := r.db.Exec(ctx, query, serverID, channelID, time.Now(), id)
	if err != nil {
		return fmt.Errorf("failed to update last visited: %w", err)
	}
	return nil
}

func (r *userRepository) MarkEmailVerified(id uuid.UUID, at time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx,
		`UPDATE users SET email_verified_at = $1, updated_at = $1 WHERE id = $2`, at, id)
	if err != nil {
		return fmt.Errorf("failed to mark email verified: %w", err)
	}
	return nil
}

func (r *userRepository) UpdateLastSeen(id uuid.UUID, at time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx,
		`UPDATE users SET last_seen_at = $1, updated_at = $1 WHERE id = $2`, at, id)
	if err != nil {
		return fmt.Errorf("failed to update last seen: %w", err)
	}
	return nil
}

func (r *userRepository) UpdatePrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// COALESCE вместо динамической сборки SET: nil-параметр оставляет
	// колонку как есть, запрос остаётся одним статическим текстом.
	query := `
		UPDATE users
		SET show_last_seen        = COALESCE($2, show_last_seen),
		    allow_friend_requests = COALESCE($3, allow_friend_requests),
		    allow_dm_from         = COALESCE($4, allow_dm_from),
		    updated_at            = NOW()
		WHERE id = $1
	`
	_, err := r.db.Exec(ctx, query, id, showLastSeen, friendRequests, dmFrom)
	if err != nil {
		return fmt.Errorf("failed to update privacy: %w", err)
	}
	return nil
}

func (r *userRepository) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT id,
		       CASE WHEN show_last_seen THEN last_seen_at ELSE NULL END,
		       show_last_seen
		FROM users WHERE id = ANY($1)
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to get last seen batch: %w", err)
	}
	defer rows.Close()

	result := make(map[uuid.UUID]domain.LastSeenInfo, len(ids))
	for rows.Next() {
		var id uuid.UUID
		var info domain.LastSeenInfo
		if err := rows.Scan(&id, &info.LastSeenAt, &info.Visible); err != nil {
			return nil, fmt.Errorf("failed to scan last seen row: %w", err)
		}
		result[id] = info
	}
	return result, nil
}

func (r *userRepository) DeleteUnverifiedBefore(t time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx,
		`DELETE FROM users WHERE email_verified_at IS NULL AND created_at < $1`, t)
	if err != nil {
		return 0, fmt.Errorf("failed to delete unverified users: %w", err)
	}
	return tag.RowsAffected(), nil
}
