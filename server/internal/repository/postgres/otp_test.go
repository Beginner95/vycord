package postgres_test

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func TestNewOTPRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.OTPRepository = postgres.NewOTPRepository
	assert.True(t, true)
}
