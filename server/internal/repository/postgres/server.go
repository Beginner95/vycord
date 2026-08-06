package postgres

import (
	"context"
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

type serverRepository struct {
	db *pgxpool.Pool
}

func NewServerRepository(db *pgxpool.Pool) domain.ServerRepository {
	return &serverRepository{db: db}
}

func (r *serverRepository) Create(server *domain.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO servers (id, name, icon_url, owner_id, is_private, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		server.ID,
		server.Name,
		server.IconURL,
		server.OwnerID,
		server.IsPrivate,
		server.CreatedAt,
		server.UpdatedAt,
	).Scan(&server.ID)

	if err != nil {
		if isUniqueNameViolation(err) {
			return domain.ErrServerNameTaken
		}
		return fmt.Errorf("failed to create server: %w", err)
	}

	return nil
}

func (r *serverRepository) GetByID(id uuid.UUID) (*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, is_private, created_at, updated_at
		FROM servers
		WHERE id = $1
	`

	server := &domain.Server{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&server.ID,
		&server.Name,
		&server.IconURL,
		&server.OwnerID,
		&server.IsPrivate,
		&server.CreatedAt,
		&server.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("server %s: %w", id, domain.ErrServerNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	return server, nil
}

func (r *serverRepository) GetByName(name string) (*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, is_private, created_at, updated_at
		FROM servers
		WHERE LOWER(name) = LOWER($1)
	`

	server := &domain.Server{}
	err := r.db.QueryRow(ctx, query, name).Scan(
		&server.ID,
		&server.Name,
		&server.IconURL,
		&server.OwnerID,
		&server.IsPrivate,
		&server.CreatedAt,
		&server.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("server name %s: %w", name, domain.ErrServerNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get server by name: %w", err)
	}

	return server, nil
}

// isUniqueNameViolation определяет, что ошибка — нарушение уникального
// индекса idx_servers_name_lower (CREATE UNIQUE INDEX ... LOWER(name)),
// который накатывается на проде вручную. Других уникальных ограничений
// в таблице servers нет, поэтому 23505 в Create/Update однозначно
// означает занятое имя.
func isUniqueNameViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (r *serverRepository) GetByOwner(ownerID uuid.UUID) ([]*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, is_private, created_at, updated_at
		FROM servers
		WHERE owner_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.db.Query(ctx, query, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to query servers: %w", err)
	}
	defer rows.Close()

	var servers []*domain.Server
	for rows.Next() {
		s := &domain.Server{}
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.IsPrivate, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, s)
	}

	return servers, nil
}

func (r *serverRepository) GetByMember(userID uuid.UUID) ([]*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT s.id, s.name, s.icon_url, s.owner_id, s.is_private, s.created_at, s.updated_at
		FROM servers s
		INNER JOIN server_members m ON s.id = m.server_id
		WHERE m.user_id = $1
		ORDER BY m.joined_at DESC
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query servers: %w", err)
	}
	defer rows.Close()

	var servers []*domain.Server
	for rows.Next() {
		s := &domain.Server{}
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.IsPrivate, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, s)
	}

	return servers, nil
}

var allowedServerColumns = map[string]string{
	"name":       "name",
	"icon_url":   "icon_url",
	"is_private": "is_private",
}

func (r *serverRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range updates {
		colName, ok := allowedServerColumns[key]
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
		"UPDATE servers SET %s WHERE id = $%d",
		strings.Join(setClauses, ", "),
		argIdx+1,
	)
	args = append(args, id)

	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		if isUniqueNameViolation(err) {
			return domain.ErrServerNameTaken
		}
		return fmt.Errorf("failed to update server: %w", err)
	}

	return nil
}

func (r *serverRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := "DELETE FROM servers WHERE id = $1"
	_, err := r.db.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete server: %w", err)
	}

	return nil
}

func (r *serverRepository) AddMember(serverID, userID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO server_members (server_id, user_id, joined_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (server_id, user_id) DO NOTHING
	`
	_, err := r.db.Exec(ctx, query, serverID, userID)
	if err != nil {
		return fmt.Errorf("failed to add member: %w", err)
	}
	return nil
}

func (r *serverRepository) RemoveMember(serverID, userID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`
	_, err := r.db.Exec(ctx, query, serverID, userID)
	if err != nil {
		return fmt.Errorf("failed to remove member: %w", err)
	}
	return nil
}

func (r *serverRepository) IsMember(serverID, userID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)`
	var exists bool
	err := r.db.QueryRow(ctx, query, serverID, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check membership: %w", err)
	}
	return exists, nil
}

func (r *serverRepository) Search(query string, limit, offset int) ([]*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	sqlQuery := `
		SELECT s.id, s.name, s.icon_url, s.owner_id, s.is_private, s.created_at, s.updated_at
		FROM servers s
		WHERE s.name ILIKE $1 AND s.is_private = false
		ORDER BY s.created_at DESC
		LIMIT $2 OFFSET $3
	`

	searchPattern := "%" + query + "%"
	rows, err := r.db.Query(ctx, sqlQuery, searchPattern, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to search servers: %w", err)
	}
	defer rows.Close()

	var servers []*domain.Server
	for rows.Next() {
		s := &domain.Server{}
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.IsPrivate, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, s)
	}

	return servers, nil
}

func (r *serverRepository) GetMembersWithUsers(serverID uuid.UUID) ([]*domain.MemberWithUser, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Владелец с миграции 009 хранится обычной строкой в server_members,
	// поэтому синтетический UNION больше не нужен.
	query := `
		SELECT u.id, u.username, u.avatar_url, m.joined_at,
		       COALESCE(array_agg(mr.role_id) FILTER (WHERE mr.role_id IS NOT NULL), '{}') AS role_ids
		FROM server_members m
		INNER JOIN users u ON u.id = m.user_id
		LEFT JOIN member_roles mr ON mr.server_id = m.server_id AND mr.user_id = m.user_id
		WHERE m.server_id = $1
		GROUP BY u.id, u.username, u.avatar_url, m.joined_at
		ORDER BY m.joined_at ASC
	`

	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to query members: %w", err)
	}
	defer rows.Close()

	var members []*domain.MemberWithUser
	for rows.Next() {
		m := &domain.MemberWithUser{}
		if err := rows.Scan(&m.UserID, &m.Username, &m.AvatarURL, &m.JoinedAt, &m.Roles); err != nil {
			return nil, fmt.Errorf("failed to scan member: %w", err)
		}
		members = append(members, m)
	}

	return members, rows.Err()
}
