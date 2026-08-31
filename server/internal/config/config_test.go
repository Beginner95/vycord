package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/config"
)

func TestAttachmentDefaults(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, 7*24*time.Hour, cfg.AttachmentLinkTTL)
	// Предохранитель на сырое тело запроса; настоящий лимит файла живёт в
	// тарифном плане и проверяется QuotaUseCase.
	assert.Equal(t, int64(30<<20), cfg.MaxUploadBytes)
}

func TestAttachmentLinkTTLOverridable(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("ATTACHMENT_LINK_TTL", "1h")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, time.Hour, cfg.AttachmentLinkTTL)
}

func TestMaxUploadBytesOverridable(t *testing.T) {
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("MAX_UPLOAD_BYTES", "104857600") // 100 MiB — гипотетический щедрый тариф

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, int64(104857600), cfg.MaxUploadBytes)
}

func TestMaxUploadBytesInvalidFallsBackToDefault(t *testing.T) {
	// Невалидное значение — не повод падать при старте (это предохранитель,
	// а не обязательный секрет вроде JWT_SECRET).
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("MAX_UPLOAD_BYTES", "not-a-number")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, int64(30<<20), cfg.MaxUploadBytes)
}
