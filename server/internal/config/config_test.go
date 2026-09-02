package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/config"
)

// setRequiredEnv ставит все переменные, без которых config.New() не стартует.
// Обязательные значения пустыми строками сбрасывать нельзя — getEnv трактует
// пустое как «не задано», поэтому здесь именно осмысленные заглушки.
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("SMTP_HOST", "localhost")
	t.Setenv("SMTP_FROM", "noreply@example.com")
	t.Setenv("OTP_SECRET", "otp-test-secret")
}

func TestAttachmentDefaults(t *testing.T) {
	setRequiredEnv(t)

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, 7*24*time.Hour, cfg.AttachmentLinkTTL)
	// Предохранитель на сырое тело запроса; настоящий лимит файла живёт в
	// тарифном плане и проверяется QuotaUseCase.
	assert.Equal(t, int64(30<<20), cfg.MaxUploadBytes)
}

func TestAttachmentLinkTTLOverridable(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("ATTACHMENT_LINK_TTL", "1h")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, time.Hour, cfg.AttachmentLinkTTL)
}

func TestMaxUploadBytesOverridable(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("MAX_UPLOAD_BYTES", "104857600") // 100 MiB — гипотетический щедрый тариф

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, int64(104857600), cfg.MaxUploadBytes)
}

func TestMaxUploadBytesInvalidFallsBackToDefault(t *testing.T) {
	// Невалидное значение — не повод падать при старте (это предохранитель,
	// а не обязательный секрет вроде JWT_SECRET).
	setRequiredEnv(t)
	t.Setenv("MAX_UPLOAD_BYTES", "not-a-number")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, int64(30<<20), cfg.MaxUploadBytes)
}

func TestOTPDefaults(t *testing.T) {
	setRequiredEnv(t)

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, 5*time.Minute, cfg.OTPTTL)
	assert.Equal(t, 3, cfg.OTPMaxAttempts)
	assert.Equal(t, time.Minute, cfg.OTPResendCooldown)
	assert.Equal(t, 5, cfg.OTPMaxPerHour)
	assert.Equal(t, 168*time.Hour, cfg.UnverifiedUserTTL)
	assert.Equal(t, "587", cfg.SMTPPort)
	assert.Equal(t, "VYCORD", cfg.SMTPFromName)
}

func TestOTPOverridable(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("OTP_TTL", "3m")
	t.Setenv("OTP_MAX_ATTEMPTS", "5")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, 3*time.Minute, cfg.OTPTTL)
	assert.Equal(t, 5, cfg.OTPMaxAttempts)
}

// Слишком короткий TTL и нулевые лимиты откатываются к умолчаниям: это
// предохранители, а не секреты, и падать из-за опечатки в них незачем.
func TestOTPInvalidValuesFallBackToDefaults(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("OTP_TTL", "5s")
	t.Setenv("OTP_MAX_ATTEMPTS", "0")
	t.Setenv("OTP_MAX_PER_HOUR", "не число")

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, 5*time.Minute, cfg.OTPTTL)
	assert.Equal(t, 3, cfg.OTPMaxAttempts)
	assert.Equal(t, 5, cfg.OTPMaxPerHour)
}

func TestSMTPHostRequired(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("SMTP_HOST", "")

	_, err := config.New()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "SMTP_HOST")
}

func TestSMTPFromRequired(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("SMTP_FROM", "")

	_, err := config.New()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "SMTP_FROM")
}

func TestOTPSecretRequired(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("OTP_SECRET", "")

	_, err := config.New()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "OTP_SECRET")
}
