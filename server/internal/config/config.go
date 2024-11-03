package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	ServerPort   string
	JWTSecret    string
	JWTExpiration time.Duration
	PostgresUser string
	PostgresPass string
	PostgresDB   string
	PostgresPort string
	RedisHost    string
	RedisPort    string
	ClientURL    string
}

func New() (*Config, error) {
	cfg := &Config{
		ServerPort:   getEnv("SERVER_PORT", "8080"),
		JWTSecret:    getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiration: parseDuration(getEnv("JWT_EXPIRATION", "24h")),
		PostgresUser: getEnv("POSTGRES_USER", "mydiscrod"),
		PostgresPass: getEnv("POSTGRES_PASSWORD", "mydiscrod_secret"),
		PostgresDB:   getEnv("POSTGRES_DB", "mydiscrod"),
		PostgresPort: getEnv("POSTGRES_PORT", "5432"),
		RedisHost:    getEnv("REDIS_HOST", "localhost"),
		RedisPort:    getEnv("REDIS_PORT", "6379"),
		ClientURL:    getEnv("CLIENT_URL", "http://localhost:3000"),
	}

	return cfg, nil
}

func (c *Config) ServerAddr() string {
	return fmt.Sprintf(":%s", c.ServerPort)
}

func (c *Config) PostgresDSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@localhost:%s/%s?sslmode=disable",
		c.PostgresUser,
		c.PostgresPass,
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

func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}
