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

type planRepository struct {
	db *pgxpool.Pool
}

func NewPlanRepository(db *pgxpool.Pool) domain.PlanRepository {
	return &planRepository{db: db}
}

// GetByUserID отдаёт план пользователя одним join'ом. Пользователь без плана
// невозможен: колонка NOT NULL DEFAULT 'free'.
func (r *planRepository) GetByUserID(userID uuid.UUID) (*domain.Plan, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT p.code, p.max_file_bytes, p.retention_days, p.max_total_bytes
		FROM users u
		JOIN plans p ON p.code = u.plan_code
		WHERE u.id = $1
	`
	p := &domain.Plan{}
	err := r.db.QueryRow(ctx, query, userID).Scan(&p.Code, &p.MaxFileBytes, &p.RetentionDays, &p.MaxTotalBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		// Доменной ошибки "пользователь не найден" в проекте нет — репозиторий
		// пользователей тоже возвращает обычную ошибку. Держим тот же стиль.
		return nil, fmt.Errorf("plan for user %s: user not found", userID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get plan: %w", err)
	}
	return p, nil
}
