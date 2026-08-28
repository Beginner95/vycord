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
}

func New() (*Config, error) {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET environment variable is required")
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
