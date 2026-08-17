package migrations

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Migration represents a single database migration
type Migration struct {
	Version     string
	Description string
	UpSQL       string
	DownSQL     string
}

// MigrationRunner handles running migrations for a service
type MigrationRunner struct {
	db          *sql.DB
	serviceName string
	migrations  []Migration
}

// NewMigrationRunner creates a new migration runner
func NewMigrationRunner(db *sql.DB, serviceName string) *MigrationRunner {
	return &MigrationRunner{
		db:          db,
		serviceName: serviceName,
		migrations:  make([]Migration, 0),
	}
}

// EnsureMigrationTable creates the migration tracking table
func (r *MigrationRunner) EnsureMigrationTable() error {
	_, err := r.db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			service VARCHAR(255) NOT NULL,
			description VARCHAR(500),
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			checksum VARCHAR(64)
		)
	`)
	return err
}

// AddMigration registers a migration
func (r *MigrationRunner) AddMigration(version, description, upSQL, downSQL string) {
	r.migrations = append(r.migrations, Migration{
		Version:     version,
		Description: description,
		UpSQL:       upSQL,
		DownSQL:     downSQL,
	})
}

// LoadFromDirectory loads .sql migration files from a directory
func (r *MigrationRunner) LoadFromDirectory(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("reading migration directory: %w", err)
	}

	migrationFiles := make(map[string]map[string]string) // version -> {up, down}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		name := entry.Name()
		parts := strings.SplitN(name, "_", 2)
		if len(parts) < 2 {
			continue
		}
		version := parts[0]
		rest := parts[1]

		if _, ok := migrationFiles[version]; !ok {
			migrationFiles[version] = make(map[string]string)
		}

		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("reading %s: %w", name, err)
		}

		if strings.HasSuffix(rest, ".up.sql") {
			migrationFiles[version]["up"] = string(content)
			migrationFiles[version]["desc"] = strings.TrimSuffix(rest, ".up.sql")
		} else if strings.HasSuffix(rest, ".down.sql") {
			migrationFiles[version]["down"] = string(content)
		}
	}

	for version, files := range migrationFiles {
		r.AddMigration(version, files["desc"], files["up"], files["down"])
	}

	sort.Slice(r.migrations, func(i, j int) bool {
		return r.migrations[i].Version < r.migrations[j].Version
	})

	return nil
}

// MigrateUp runs all pending migrations
func (r *MigrationRunner) MigrateUp() (int, error) {
	if err := r.EnsureMigrationTable(); err != nil {
		return 0, fmt.Errorf("ensuring migration table: %w", err)
	}

	applied, err := r.getAppliedVersions()
	if err != nil {
		return 0, err
	}

	count := 0
	for _, m := range r.migrations {
		if applied[m.Version] {
			continue
		}

		tx, err := r.db.Begin()
		if err != nil {
			return count, fmt.Errorf("beginning transaction for %s: %w", m.Version, err)
		}

		if _, err := tx.Exec(m.UpSQL); err != nil {
			_ = tx.Rollback()
			return count, fmt.Errorf("executing migration %s: %w", m.Version, err)
		}

		if _, err := tx.Exec(
			"INSERT INTO schema_migrations (version, service, description) VALUES ($1, $2, $3)",
			m.Version, r.serviceName, m.Description,
		); err != nil {
			_ = tx.Rollback()
			return count, fmt.Errorf("recording migration %s: %w", m.Version, err)
		}

		if err := tx.Commit(); err != nil {
			return count, fmt.Errorf("committing migration %s: %w", m.Version, err)
		}

		count++
	}

	return count, nil
}

// MigrateDown rolls back the last n migrations
func (r *MigrationRunner) MigrateDown(n int) (int, error) {
	applied, err := r.getAppliedVersions()
	if err != nil {
		return 0, err
	}

	// Get applied migrations in reverse order
	var toRollback []Migration
	for i := len(r.migrations) - 1; i >= 0; i-- {
		if applied[r.migrations[i].Version] {
			toRollback = append(toRollback, r.migrations[i])
		}
		if len(toRollback) >= n {
			break
		}
	}

	count := 0
	for _, m := range toRollback {
		tx, err := r.db.Begin()
		if err != nil {
			return count, err
		}

		if _, err := tx.Exec(m.DownSQL); err != nil {
			_ = tx.Rollback()
			return count, fmt.Errorf("rolling back %s: %w", m.Version, err)
		}

		if _, err := tx.Exec(
			"DELETE FROM schema_migrations WHERE version = $1 AND service = $2",
			m.Version, r.serviceName,
		); err != nil {
			_ = tx.Rollback()
			return count, err
		}

		if err := tx.Commit(); err != nil {
			return count, err
		}

		count++
	}

	return count, nil
}

// Status returns the current migration status
func (r *MigrationRunner) Status() ([]MigrationStatus, error) {
	applied, err := r.getAppliedVersions()
	if err != nil {
		return nil, err
	}

	status := make([]MigrationStatus, 0, len(r.migrations))
	for _, m := range r.migrations {
		status = append(status, MigrationStatus{
			Version:     m.Version,
			Description: m.Description,
			Applied:     applied[m.Version],
		})
	}
	return status, nil
}

// MigrationStatus represents the status of a migration
type MigrationStatus struct {
	Version     string
	Description string
	Applied     bool
}

// GenerateMigration creates a new migration file pair
func GenerateMigration(dir, name string) (string, string, error) {
	version := time.Now().Format("20060102150405")
	upFile := filepath.Join(dir, fmt.Sprintf("%s_%s.up.sql", version, name))
	downFile := filepath.Join(dir, fmt.Sprintf("%s_%s.down.sql", version, name))

	_ = os.MkdirAll(dir, 0755)

	if err := os.WriteFile(upFile, []byte("-- Migration up\n"), 0644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(downFile, []byte("-- Migration down\n"), 0644); err != nil {
		return "", "", err
	}

	return upFile, downFile, nil
}

func (r *MigrationRunner) getAppliedVersions() (map[string]bool, error) {
	result := make(map[string]bool)

	rows, err := r.db.Query(
		"SELECT version FROM schema_migrations WHERE service = $1",
		r.serviceName,
	)
	if err != nil {
		return result, nil
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		result[version] = true
	}

	return result, rows.Err()
}
