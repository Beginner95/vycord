package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	ServerPort    string
	JWTSecret     string
	JWTExpiration time.Duration
	PostgresHost  string
	PostgresUser  string
	PostgresPass  string
	PostgresDB    string
	PostgresPort  string
	RedisHost     string
	RedisPort     string
	ClientURL     string
}

func New() (*Config, error) {
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET environment variable is required")
	}

	cfg := &Config{
		ServerPort:    getEnv("SERVER_PORT", "8080"),
		JWTSecret:     jwtSecret,
		JWTExpiration: parseDuration(getEnv("JWT_EXPIRATION", "24h")),
		PostgresHost:  getEnv("POSTGRES_HOST", "localhost"),
		PostgresUser:  getEnv("POSTGRES_USER", "vycord"),
		PostgresPass:  getEnv("POSTGRES_PASSWORD", "vycord_secret"),
		PostgresDB:    getEnv("POSTGRES_DB", "vycord"),
		PostgresPort:  getEnv("POSTGRES_PORT", "5432"),
		RedisHost:     getEnv("REDIS_HOST", "localhost"),
		RedisPort:     getEnv("REDIS_PORT", "6379"),
		ClientURL:     getEnv("CLIENT_URL", "http://localhost:3000"),
	}

	return cfg, nil
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

func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}
