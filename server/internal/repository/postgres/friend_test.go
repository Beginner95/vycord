package postgres_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

// Конструктор требует *pgxpool.Pool — проверить можно только на этапе
// связывания. Тест на то, что он существует и отдаёт доменный интерфейс.
func TestNewFriendRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.FriendRepository = postgres.NewFriendRepository
	assert.True(t, true)
}
