package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServerPort             string
	JWTSecret              string
	JWTExpiration          time.Duration
	RefreshTokenExpiration time.Duration
	PostgresHost           string
	PostgresUser           string
	PostgresPass           string
	PostgresDB             string
	PostgresPort           string
	RedisHost              string
	RedisPort              string
	ClientURL              string
	TURNSecret             string
	TURNURLs               []string
	TURNTTL                time.Duration
	UploadDir              string
	// SFUInternalURL/SFUInternalSecret configure the voice-presence
	// reconciliation worker (VYC-78 step 4): base URL of the SFU's internal
	// HTTP API and the shared secret /presence requires (see
	// httpapi.RequireInternalSecret on the SFU side). Either left empty
	// disables the worker entirely rather than blocking API startup —
	// presence reconciliation is a correctness safety net, not core
	// functionality.
	SFUInternalURL    string
	SFUInternalSecret string
	// AttachmentLinkTTL — срок жизни подписанной ссылки на вложение.
	// Неделя: достаточно долго, чтобы открытая вкладка не теряла картинки,
	// и достаточно коротко, чтобы утёкшая ссылка не жила вечно.
	AttachmentLinkTTL time.Duration
	// MaxUploadBytes — предохранитель на сырое тело запроса загрузки
	// (env MAX_UPLOAD_BYTES, в байтах). Это НЕ лимит размера файла — тот
	// живёт в таблице plans и проверяется QuotaUseCase. Это значение обязано
	// быть не меньше max_file_bytes самого щедрого тарифа, иначе платный
	// тариф не заработает: запрос обрубит этот предохранитель раньше, чем
	// дело дойдёт до проверки по плану. См. также client_max_body_size в
	// nginx — тот же инвариант действует и для него.
	MaxUploadBytes int64
	// SMTP-транспорт для писем с OTP-кодами. SMTPHost и SMTPFrom
	// обязательны: без них регистрация не работает вообще, и молчаливый
	// старт с нерабочей почтой хуже, чем отказ подняться.
	SMTPHost     string
	SMTPPort     string
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	SMTPFromName string
	// OTPSecret — ключ HMAC, которым хешируются коды в otp_codes.
	// Отдельный от JWTSecret намеренно: ротация одного секрета не должна
	// инвалидировать другую подсистему.
	OTPSecret string
	// OTPTTL и лимиты. 4-значный код держится не на своей энтропии
	// (10 000 вариантов), а на этих ограничениях: 3 попытки на код и не
	// более 5 кодов в час дают максимум 15 попыток в час на аккаунт.
	// Увеличение любого из двух последних чисел прямо ухудшает стойкость.
	OTPTTL            time.Duration
	OTPMaxAttempts    int
	OTPResendCooldown time.Duration
	OTPMaxPerHour     int
	// UnverifiedUserTTL — через сколько уборщик удаляет так и не
	// подтверждённую регистрацию. Без этого брошенные записи навсегда
	// удерживают username и email через UNIQUE-ограничения.
	UnverifiedUserTTL time.Duration
}

func New() (*Config, error) {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET environment variable is required")
	}
	smtpHost := getEnv("SMTP_HOST", "")
	if smtpHost == "" {
		return nil, fmt.Errorf("SMTP_HOST environment variable is required")
	}
	smtpFrom := getEnv("SMTP_FROM", "")
	if smtpFrom == "" {
		return nil, fmt.Errorf("SMTP_FROM environment variable is required")
	}
	otpSecret := getEnv("OTP_SECRET", "")
	if otpSecret == "" {
		return nil, fmt.Errorf("OTP_SECRET environment variable is required")
	}

	cfg := &Config{
		ServerPort:             getEnv("SERVER_PORT", "8080"),
		JWTSecret:              jwtSecret,
		JWTExpiration:          parseDuration(getEnv("JWT_EXPIRATION", "15m")),
		RefreshTokenExpiration: parseDuration(getEnv("REFRESH_TOKEN_EXPIRATION", "720h")),
		PostgresHost:           getEnv("POSTGRES_HOST", "localhost"),
		PostgresUser:           getEnv("POSTGRES_USER", "vycord"),
		PostgresPass:           getEnv("POSTGRES_PASSWORD", "vycord_secret"),
		PostgresDB:             getEnv("POSTGRES_DB", "vycord"),
		PostgresPort:           getEnv("POSTGRES_PORT", "5432"),
		RedisHost:              getEnv("REDIS_HOST", "localhost"),
		RedisPort:              getEnv("REDIS_PORT", "6379"),
		ClientURL:              getEnv("CLIENT_URL", "http://localhost:3000"),
		TURNSecret:             getEnv("TURN_SECRET", ""),
		TURNURLs:               splitList(getEnv("TURN_URLS", "")),
		TURNTTL:                parseDuration(getEnv("TURN_CREDENTIAL_TTL", "12h")),
		UploadDir:              getEnv("UPLOAD_DIR", "./uploads"),
		SFUInternalURL:         getEnv("SFU_INTERNAL_URL", ""),
		SFUInternalSecret:      getEnv("SFU_INTERNAL_SECRET", ""),
		AttachmentLinkTTL:      parseDuration(getEnv("ATTACHMENT_LINK_TTL", "168h")),
		MaxUploadBytes:         getEnvInt64("MAX_UPLOAD_BYTES", 30<<20),
		SMTPHost:               smtpHost,
		SMTPPort:               getEnv("SMTP_PORT", "587"),
		SMTPUsername:           getEnv("SMTP_USERNAME", ""),
		SMTPPassword:           getEnv("SMTP_PASSWORD", ""),
		SMTPFrom:               smtpFrom,
		SMTPFromName:           getEnv("SMTP_FROM_NAME", "VYCORD"),
		OTPSecret:              otpSecret,
		OTPTTL:                 parseDurationMin(getEnv("OTP_TTL", ""), 5*time.Minute, time.Minute),
		OTPMaxAttempts:         getEnvIntMin("OTP_MAX_ATTEMPTS", 3, 1),
		OTPResendCooldown:      parseDurationMin(getEnv("OTP_RESEND_COOLDOWN", ""), time.Minute, 5*time.Second),
		OTPMaxPerHour:          getEnvIntMin("OTP_MAX_PER_HOUR", 5, 1),
		UnverifiedUserTTL:      parseDurationMin(getEnv("UNVERIFIED_USER_TTL", ""), 168*time.Hour, time.Hour),
	}

	return cfg, nil
}

// splitList parses a comma-separated env value into a slice, skipping empty items.
func splitList(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func (c *Config) ServerAddr() string {
	return fmt.Sprintf(":%s", c.ServerPort)
}

func (c *Config) PostgresDSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=disable",
		c.PostgresUser,
		c.PostgresPass,
		c.PostgresHost,
		c.PostgresPort,
		c.PostgresDB,
	)
}

func (c *Config) RedisAddr() string {
	return fmt.Sprintf("%s:%s", c.RedisHost, c.RedisPort)
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// getEnvInt64 читает целочисленную настройку из окружения. Невалидное
// значение — не повод падать при старте (это предохранитель, а не секрет
// вроде JWT_SECRET), поэтому тихо откатываемся на fallback.
func getEnvInt64(key string, fallback int64) int64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return v
}

func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}

// getEnvIntMin читает целочисленный лимит, откатываясь к fallback и на
// неразбираемом значении, и на значении ниже min. Ноль попыток или ноль
// кодов в час превратили бы фичу в неработающую, а не в более строгую.
func getEnvIntMin(key string, fallback, min int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < min {
		return fallback
	}
	return v
}

// parseDurationMin — как parseDuration, но с нижней границей. Отдельная
// функция, а не правка parseDuration: у той свой контракт (откат на 24 часа),
// на который завязаны остальные настройки.
func parseDurationMin(s string, fallback, min time.Duration) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil || d < min {
		return fallback
	}
	return d
}
