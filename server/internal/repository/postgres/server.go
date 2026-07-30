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
		INSERT INTO servers (id, name, icon_url, owner_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		server.ID,
		server.Name,
		server.IconURL,
		server.OwnerID,
		server.CreatedAt,
		server.UpdatedAt,
	).Scan(&server.ID)

	if err != nil {
		return fmt.Errorf("failed to create server: %w", err)
	}

	return nil
}

func (r *serverRepository) GetByID(id uuid.UUID) (*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, created_at, updated_at
		FROM servers
		WHERE id = $1
	`

	server := &domain.Server{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&server.ID,
		&server.Name,
		&server.IconURL,
		&server.OwnerID,
		&server.CreatedAt,
		&server.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("server not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}

	return server, nil
}

func (r *serverRepository) GetByOwner(ownerID uuid.UUID) ([]*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, created_at, updated_at
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
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt); err != nil {
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
		SELECT s.id, s.name, s.icon_url, s.owner_id, s.created_at, s.updated_at
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
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, s)
	}

	return servers, nil
}

var allowedServerColumns = map[string]string{
	"name":     "name",
	"icon_url": "icon_url",
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
		INSERT INTO server_members (server_id, user_id, role, joined_at)
		VALUES ($1, $2, 'member', NOW())
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
		SELECT s.id, s.name, s.icon_url, s.owner_id, s.created_at, s.updated_at
		FROM servers s
		WHERE s.name ILIKE $1
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
		if err := rows.Scan(&s.ID, &s.Name, &s.IconURL, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, s)
	}

	return servers, nil
}

func (r *serverRepository) GetMembersWithUsers(serverID uuid.UUID) ([]*domain.MemberWithUser, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT u.id, u.username, u.avatar_url, m.role, m.joined_at
		FROM server_members m
		INNER JOIN users u ON u.id = m.user_id
		WHERE m.server_id = $1

		UNION ALL

		SELECT u.id, u.username, u.avatar_url, 'owner', s.created_at
		FROM servers s
		INNER JOIN users u ON u.id = s.owner_id
		WHERE s.id = $1

		ORDER BY joined_at ASC
	`

	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to query members: %w", err)
	}
	defer rows.Close()

	var members []*domain.MemberWithUser
	for rows.Next() {
		m := &domain.MemberWithUser{}
		if err := rows.Scan(&m.UserID, &m.Username, &m.AvatarURL, &m.Role, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("failed to scan member: %w", err)
		}
		members = append(members, m)
	}

	return members, nil
}

func (r *serverRepository) GetMemberRole(serverID, userID uuid.UUID) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var ownerID uuid.UUID
	err := r.db.QueryRow(ctx, `SELECT owner_id FROM servers WHERE id = $1`, serverID).Scan(&ownerID)
	if err != nil {
		return "", fmt.Errorf("failed to get server owner: %w", err)
	}
	if ownerID == userID {
		return "owner", nil
	}

	var role string
	err = r.db.QueryRow(ctx, `SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, serverID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to get member role: %w", err)
	}
	return role, nil
}
