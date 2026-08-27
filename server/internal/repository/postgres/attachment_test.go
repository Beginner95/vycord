package postgres_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

// Конструкторы требуют *pgxpool.Pool — проверить можно только на этапе
// связывания. Тест на то, что они существуют и отдают доменный интерфейс.
func TestNewAttachmentRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.AttachmentRepository = postgres.NewAttachmentRepository
	assert.True(t, true)
}

func TestNewPlanRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.PlanRepository = postgres.NewPlanRepository
	assert.True(t, true)
}
