package postgres_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

// NewStickerRepository требует *pgxpool.Pool — проверить можно только на этапе
// связывания. Здесь тест только на то, что конструктор существует и возвращает
// доменный интерфейс (компиляционная проверка).
func TestNewStickerRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.StickerRepository = postgres.NewStickerRepository
	assert.True(t, true)
}
