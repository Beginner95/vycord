// migrate/main.go — Simple SQL migration runner using pgx
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: migrate <dsn> <up|down>")
		os.Exit(1)
	}

	dsn := os.Args[1]
	direction := os.Args[2]

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer conn.Close(ctx)

	// Create schema_migrations table
	_, err = conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INT PRIMARY KEY
		)
	`)
	if err != nil {
		log.Fatalf("Failed to create schema_migrations: %v", err)
	}

	migrationsDir := "migrations"
	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		log.Fatalf("Failed to read migrations directory: %v", err)
	}

	// Parse migration files
	type migrationFile struct {
		version   int
		direction string
		filename  string
	}

	var migrations []migrationFile
	for _, f := range files {
		if f.IsDir() {
			continue
		}
		name := f.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}

		var version int
		var dir string
		_, err := fmt.Sscanf(name, "%d_%s", &version, &dir)
		if err != nil {
			continue
		}

		if strings.HasSuffix(name, ".up.sql") {
			migrations = append(migrations, migrationFile{version: version, direction: "up", filename: name})
		} else if strings.HasSuffix(name, ".down.sql") {
			migrations = append(migrations, migrationFile{version: version, direction: "down", filename: name})
		}
	}

	// Get applied migrations
	rows, err := conn.Query(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		log.Fatalf("Failed to query applied migrations: %v", err)
	}

	applied := make(map[int]bool)
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			log.Fatalf("Failed to scan version: %v", err)
		}
		applied[v] = true
	}

	if direction == "up" {
		// Sort migrations by version ascending
		sort.Slice(migrations, func(i, j int) bool {
			return migrations[i].version < migrations[j].version
		})

		for _, m := range migrations {
			if m.direction != "up" {
				continue
			}
			if applied[m.version] {
				fmt.Printf("Skipping migration %d (already applied)\n", m.version)
				continue
			}

			fmt.Printf("Applying migration %d: %s\n", m.version, m.filename)
			sql, err := os.ReadFile(filepath.Join(migrationsDir, m.filename))
			if err != nil {
				log.Fatalf("Failed to read migration file: %v", err)
			}

			sqlContent := string(sql)

			// Extract only the relevant section (up or down)
			var content string
			if m.direction == "up" {
				upIdx := strings.Index(sqlContent, "-- +migrate Up")
				downIdx := strings.Index(sqlContent, "-- +migrate Down")
				if upIdx == -1 {
					log.Fatalf("Migration %d: missing '-- +migrate Up' directive", m.version)
				}
				startIdx := upIdx + len("-- +migrate Up")
				endIdx := len(sqlContent)
				if downIdx != -1 && downIdx > upIdx {
					endIdx = downIdx
				}
				content = sqlContent[startIdx:endIdx]
			} else {
				downIdx := strings.Index(sqlContent, "-- +migrate Down")
				if downIdx == -1 {
					log.Fatalf("Migration %d: missing '-- +migrate Down' directive", m.version)
				}
				startIdx := downIdx + len("-- +migrate Down")
				content = sqlContent[startIdx:]
			}

			content = strings.TrimSpace(content)

			// Use a transaction for each migration
			tx, err := conn.Begin(ctx)
			if err != nil {
				log.Fatalf("Failed to begin transaction for migration %d: %v", m.version, err)
			}

			// Split on semicolons and execute each statement separately
			statements := strings.Split(content, ";")
			for _, stmt := range statements {
				stmt = strings.TrimSpace(stmt)
				if stmt == "" {
					continue
				}
				_, execErr := tx.Exec(ctx, stmt)
				if execErr != nil {
					_ = tx.Rollback(ctx)
					log.Fatalf("Failed to apply migration %d: %v\nStatement: %s", m.version, execErr, stmt)
				}
			}

			_, recErr := tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", m.version)
			if recErr != nil {
				_ = tx.Rollback(ctx)
				log.Fatalf("Failed to record migration %d: %v", m.version, recErr)
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				log.Fatalf("Failed to commit migration %d: %v", m.version, commitErr)
			}

			fmt.Printf("Migration %d applied successfully\n", m.version)
		}
	} else {
		// Sort migrations by version descending
		sort.Slice(migrations, func(i, j int) bool {
			return migrations[i].version > migrations[j].version
		})

		for _, m := range migrations {
			if m.direction != "down" {
				continue
			}
			if !applied[m.version] {
				fmt.Printf("Skipping migration %d (not applied)\n", m.version)
				continue
			}

			fmt.Printf("Reverting migration %d: %s\n", m.version, m.filename)
			sql, err := os.ReadFile(filepath.Join(migrationsDir, m.filename))
			if err != nil {
				log.Fatalf("Failed to read migration file: %v", err)
			}

			sqlContent := string(sql)

			// Extract only the "-- +migrate Down" section, mirroring the
			// extraction done for "up" above. Without this, both the Up and
			// Down sections of the file were concatenated and executed
			// together, which for files that DROP then CREATE the same
			// object (or vice versa) silently undid the revert.
			downIdx := strings.Index(sqlContent, "-- +migrate Down")
			if downIdx == -1 {
				log.Fatalf("Migration %d: missing '-- +migrate Down' directive", m.version)
			}
			content := sqlContent[downIdx+len("-- +migrate Down"):]

			tx, err := conn.Begin(ctx)
			if err != nil {
				log.Fatalf("Failed to begin transaction for migration %d: %v", m.version, err)
			}

			statements := strings.Split(content, ";")
			success := true
			for _, stmt := range statements {
				stmt = strings.TrimSpace(stmt)
				if stmt == "" {
					continue
				}
				_, err = tx.Exec(ctx, stmt)
				if err != nil {
					tx.Rollback(ctx)
					success = false
					log.Fatalf("Failed to revert migration %d: %v\nStatement: %s", m.version, err, stmt)
				}
			}

			if success {
				_, err = tx.Exec(ctx, "DELETE FROM schema_migrations WHERE version = $1", m.version)
				if err != nil {
					tx.Rollback(ctx)
					log.Fatalf("Failed to remove migration record %d: %v", m.version, err)
				}
				if err := tx.Commit(ctx); err != nil {
					log.Fatalf("Failed to commit migration revert %d: %v", m.version, err)
				}
			}

			fmt.Printf("Migration %d reverted successfully\n", m.version)
		}
	}

	fmt.Println("All migrations completed.")
}
