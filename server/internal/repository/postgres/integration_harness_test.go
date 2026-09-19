package postgres_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// openIntegrationDB creates a throwaway database on the server VYCORD_TEST_DSN
// points at, applies every migration's Up section in version order (exactly as
// cmd/migrate does: split on ";"), and drops the database when the test ends.
// Skips when VYCORD_TEST_DSN is unset, so plain `go test ./...` stays hermetic.
func openIntegrationDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	adminDSN := os.Getenv("VYCORD_TEST_DSN")
	if adminDSN == "" {
		t.Skip("VYCORD_TEST_DSN not set — skipping Postgres integration test")
	}
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminDSN)
	require.NoError(t, err)
	name := "vycord_it_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	_, err = admin.Exec(ctx, "CREATE DATABASE "+name)
	require.NoError(t, err)

	cfg, err := pgxpool.ParseConfig(adminDSN)
	require.NoError(t, err)
	cfg.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)

	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = admin.Close(context.Background())
	})

	for _, v := range migrationVersions(t) {
		applyMigrationSection(t, pool, v, "up")
	}
	return pool
}

func migrationsDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations")
}

func migrationVersions(t *testing.T) []int {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(migrationsDir(), "*.up.sql"))
	require.NoError(t, err)
	var versions []int
	for _, f := range files {
		prefix, _, _ := strings.Cut(filepath.Base(f), "_")
		v, err := strconv.Atoi(prefix)
		require.NoError(t, err, f)
		versions = append(versions, v)
	}
	sort.Ints(versions)
	return versions
}

// applyMigrationSection runs one migration file's Up or Down section.
func applyMigrationSection(t *testing.T, pool *pgxpool.Pool, version int, direction string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(migrationsDir(), fmt.Sprintf("%03d_*.%s.sql", version, direction)))
	require.NoError(t, err)
	require.Len(t, matches, 1, "migration %03d %s", version, direction)

	raw, err := os.ReadFile(matches[0])
	require.NoError(t, err)
	content := string(raw)

	marker := "-- +migrate Up"
	if direction == "down" {
		marker = "-- +migrate Down"
	}
	idx := strings.Index(content, marker)
	require.GreaterOrEqual(t, idx, 0, "%s: missing %q", matches[0], marker)
	content = content[idx+len(marker):]
	if direction == "up" {
		if d := strings.Index(content, "-- +migrate Down"); d >= 0 {
			content = content[:d]
		}
	}

	for _, stmt := range strings.Split(content, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		_, err := pool.Exec(context.Background(), stmt)
		require.NoError(t, err, "migration %03d %s, statement:\n%s", version, direction, stmt)
	}
}
