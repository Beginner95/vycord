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

type roleRepository struct {
	db *pgxpool.Pool
}

func NewRoleRepository(db *pgxpool.Pool) domain.RoleRepository {
	return &roleRepository{db: db}
}

const roleColumns = `id, server_id, name, color, position, permissions, is_default, created_at, updated_at`

func scanRole(row pgx.Row) (*domain.Role, error) {
	r := &domain.Role{}
	err := row.Scan(&r.ID, &r.ServerID, &r.Name, &r.Color, &r.Position, &r.Permissions, &r.IsDefault, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (r *roleRepository) ListByServer(serverID uuid.UUID) ([]*domain.Role, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT `+roleColumns+` FROM roles WHERE server_id = $1 ORDER BY position DESC, id`, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to list roles: %w", err)
	}
	defer rows.Close()

	roles := make([]*domain.Role, 0)
	for rows.Next() {
		role, err := scanRole(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (r *roleRepository) GetByID(id uuid.UUID) (*domain.Role, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	role, err := scanRole(r.db.QueryRow(ctx, `SELECT `+roleColumns+` FROM roles WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("role %s: %w", id, domain.ErrRoleNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get role: %w", err)
	}
	return role, nil
}

func (r *roleRepository) Create(role *domain.Role) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		INSERT INTO roles (id, server_id, name, color, position, permissions, is_default, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, role.ID, role.ServerID, role.Name, role.Color, role.Position, role.Permissions, role.IsDefault, role.CreatedAt, role.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create role: %w", err)
	}
	return nil
}

// Update принимает whitelist-ключи name, color, position, permissions.
// Ключи собираются в SQL вручную, поэтому набор допустимых имён закрыт.
func (r *roleRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	allowed := map[string]bool{"name": true, "color": true, "position": true, "permissions": true}
	setClauses := make([]string, 0, len(updates)+1)
	args := make([]interface{}, 0, len(updates)+1)
	i := 1
	for column, value := range updates {
		if !allowed[column] {
			return fmt.Errorf("role update: unsupported column %q", column)
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", column, i))
		args = append(args, value)
		i++
	}
	setClauses = append(setClauses, "updated_at = NOW()")
	args = append(args, id)

	query := fmt.Sprintf(`UPDATE roles SET %s WHERE id = $%d`, strings.Join(setClauses, ", "), i)
	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("role %s: %w", id, domain.ErrRoleNotFound)
	}
	return nil
}

func (r *roleRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx, `DELETE FROM roles WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete role: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("role %s: %w", id, domain.ErrRoleNotFound)
	}
	return nil
}

// ResolveMemberPermissions объединяет права дефолтной роли сервера (@everyone
// применяется неявно, без записи в member_roles) и всех назначенных ролей.
func (r *roleRepository) ResolveMemberPermissions(serverID, userID uuid.UUID) (domain.Permission, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var bits int64
	var position int
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(bit_or(r.permissions), 0), COALESCE(max(r.position), -1)
		FROM roles r
		WHERE r.server_id = $1
		  AND (r.is_default OR r.id IN (
		        SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2))
	`, serverID, userID).Scan(&bits, &position)
	if err != nil {
		return 0, -1, fmt.Errorf("failed to resolve member permissions: %w", err)
	}
	return domain.Permission(bits), position, nil
}

func (r *roleRepository) AssignToMember(serverID, userID, roleID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		INSERT INTO member_roles (server_id, user_id, role_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (server_id, user_id, role_id) DO NOTHING
	`, serverID, userID, roleID)
	if err != nil {
		return fmt.Errorf("failed to assign role: %w", err)
	}
	return nil
}

func (r *roleRepository) UnassignFromMember(serverID, userID, roleID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3
	`, serverID, userID, roleID)
	if err != nil {
		return fmt.Errorf("failed to unassign role: %w", err)
	}
	return nil
}
