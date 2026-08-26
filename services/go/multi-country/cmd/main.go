package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Multi-Country Expansion — Pan-African regulatory configuration engine
// Port: 8117
//
// Middleware: PostgreSQL (country config store), Kafka (expansion events),
// Redis (config cache), Keycloak (JWT auth)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8117"),
		DatabaseURL: envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:    envOr("KAFKA_REST_URL", "http://kafka-rest:8082"),
		Environment: envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type Store struct{ db *sql.DB }

func NewStore(ctx context.Context, url string) (*Store, error) {
	db, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	s := &Store{db: db}
	return s, s.migrate(ctx)
}

func (s *Store) migrate(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS countries (
			code TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			currency TEXT NOT NULL,
			timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
			regulator TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'planned',
			languages TEXT[] NOT NULL DEFAULT '{en}',
			vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0.075,
			min_capital BIGINT NOT NULL DEFAULT 0,
			payment_providers TEXT[] NOT NULL DEFAULT '{}',
			kyc_requirements TEXT[] NOT NULL DEFAULT '{}',
			launched_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS country_products (
			id SERIAL PRIMARY KEY,
			country_code TEXT NOT NULL REFERENCES countries(code),
			product_type TEXT NOT NULL,
			name TEXT NOT NULL,
			regulatory_class TEXT NOT NULL,
			min_premium BIGINT NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_cp_country ON country_products(country_code);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	countries := []struct {
		code, name, currency, tz, regulator, status string
		vat                                         float64
		minCap                                      int64
	}{
		{"NG", "Nigeria", "NGN", "Africa/Lagos", "NAICOM", "active", 0.075, 3000000000},
		{"GH", "Ghana", "GHS", "Africa/Accra", "NIC", "planned", 0.125, 500000000},
		{"KE", "Kenya", "KES", "Africa/Nairobi", "IRA", "planned", 0.16, 300000000},
		{"ZA", "South Africa", "ZAR", "Africa/Johannesburg", "FSCA", "planned", 0.15, 10000000000},
		{"EG", "Egypt", "EGP", "Africa/Cairo", "FRA", "planned", 0.14, 60000000000},
	}
	for _, c := range countries {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO countries (code, name, currency, timezone, regulator, status, vat_rate, min_capital)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO UPDATE SET status=$6`,
			c.code, c.name, c.currency, c.tz, c.regulator, c.status, c.vat, c.minCap)
	}
	return nil
}

func (s *Store) ListCountries(ctx context.Context, status string) ([]map[string]interface{}, error) {
	q := `SELECT code, name, currency, timezone, regulator, status, vat_rate, min_capital FROM countries WHERE 1=1`
	args := []interface{}{}
	if status != "" {
		q += ` AND status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY name`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var code, name, currency, tz, reg, st string
		var vat float64
		var minCap int64
		_ = rows.Scan(&code, &name, &currency, &tz, &reg, &st, &vat, &minCap)
		result = append(result, map[string]interface{}{
			"code": code, "name": name, "currency": currency, "timezone": tz,
			"regulator": reg, "status": st, "vat_rate": vat, "min_capital": minCap,
		})
	}
	return result, nil
}

func (s *Store) GetCountry(ctx context.Context, code string) (map[string]interface{}, error) {
	var name, currency, tz, reg, st string
	var vat float64
	var minCap int64
	err := s.db.QueryRowContext(ctx, `SELECT name, currency, timezone, regulator, status, vat_rate, min_capital FROM countries WHERE code = $1`, code).
		Scan(&name, &currency, &tz, &reg, &st, &vat, &minCap)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"code": code, "name": name, "currency": currency, "timezone": tz,
		"regulator": reg, "status": st, "vat_rate": vat, "min_capital": minCap,
	}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if code != http.StatusOK {
		w.WriteHeader(code)
	}
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := NewStore(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	defer func() { _ = store.Close() }()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		dbErr := store.db.PingContext(r.Context())
		st := "connected"
		if dbErr != nil {
			st = "disconnected"
		}
		countries, _ := store.ListCountries(r.Context(), "")
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "multi-country", "database": st, "countries_count": len(countries)})
	})
	mux.HandleFunc("/api/v1/countries", func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		countries, err := store.ListCountries(r.Context(), status)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if countries == nil {
			countries = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"countries": countries, "total": len(countries)})
	})
	mux.HandleFunc("/api/v1/countries/", func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Path[len("/api/v1/countries/"):]
		if code == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "country code required"})
			return
		}
		c, err := store.GetCountry(r.Context(), code)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if c == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "country not found"})
			return
		}
		writeJSON(w, http.StatusOK, c)
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Multi-Country starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	shutdownCtx, c := context.WithTimeout(ctx, 30*time.Second)
	defer c()
	_ = server.Shutdown(shutdownCtx)
}
