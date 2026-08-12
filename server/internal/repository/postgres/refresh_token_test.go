package postgres_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func TestNewRefreshTokenRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.RefreshTokenRepository = postgres.NewRefreshTokenRepository
	assert.True(t, true)
}
