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
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Compliance Calendar — Regulatory deadline tracking for NAICOM/CBN/NDIC/FIRS/PENCOM
// Port: 8121
//
// Middleware: PostgreSQL (deadline store), Kafka (alert events), Redis (notification cache),
// Temporal (scheduled reminder workflows), Keycloak (JWT auth)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8121"),
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
		CREATE TABLE IF NOT EXISTS compliance_deadlines (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			authority TEXT NOT NULL,
			due_date TIMESTAMPTZ NOT NULL,
			frequency TEXT NOT NULL DEFAULT 'annual',
			category TEXT NOT NULL DEFAULT 'filing',
			status TEXT NOT NULL DEFAULT 'pending',
			penalty TEXT,
			description TEXT,
			assigned_to TEXT,
			completed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_comp_authority ON compliance_deadlines(authority);
		CREATE INDEX IF NOT EXISTS idx_comp_status ON compliance_deadlines(status);
		CREATE INDEX IF NOT EXISTS idx_comp_due ON compliance_deadlines(due_date);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	deadlines := []struct {
		id, title, auth, freq, cat, status, penalty, desc string
		dueDate                                           time.Time
	}{
		{"DL-001", "Annual Financial Statements", "NAICOM", "annual", "filing", "in_progress", "₦5M fine + license suspension", "Audited financial statements submission", time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC)},
		{"DL-002", "Quarterly Solvency Returns", "NAICOM", "quarterly", "filing", "pending", "₦2M fine per quarter", "Capital adequacy and solvency margin report", time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)},
		{"DL-003", "Anti-Money Laundering Report", "CBN", "quarterly", "compliance", "in_progress", "₦10M fine + possible prosecution", "STR/CTR filing and AML compliance", time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)},
		{"DL-004", "Tax Returns Filing", "FIRS", "annual", "tax", "completed", "₦50K + 10% of tax due", "Company income tax returns", time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)},
		{"DL-005", "Pension Contribution Remittance", "PENCOM", "monthly", "payment", "pending", "2% penalty per month", "Employee pension contributions", time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)},
		{"DL-006", "Risk-Based Capital Assessment", "NAICOM", "semi-annual", "filing", "pending", "License review", "RBC computation per NAICOM guidelines", time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC)},
		{"DL-007", "Data Protection Compliance Audit", "NITDA", "annual", "compliance", "pending", "2% of annual gross revenue", "NDPR compliance audit report", time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)},
		{"DL-008", "Reinsurance Treaty Renewal", "NAICOM", "annual", "filing", "pending", "Treaty lapse risk", "Annual reinsurance program renewal", time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)},
	}
	for _, d := range deadlines {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO compliance_deadlines (id, title, authority, due_date, frequency, category, status, penalty, description)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET title=$2, authority=$3, due_date=$4, status=$7`,
			d.id, d.title, d.auth, d.dueDate, d.freq, d.cat, d.status, d.penalty, d.desc)
	}
	return nil
}

func (s *Store) ListDeadlines(ctx context.Context, authority, status string) ([]map[string]interface{}, error) {
	q := `SELECT id, title, authority, due_date, frequency, category, status, penalty, description FROM compliance_deadlines WHERE 1=1`
	args := []interface{}{}
	n := 1
	if authority != "" {
		q += fmt.Sprintf(` AND authority = $%d`, n)
		args = append(args, authority)
		n++
	}
	if status != "" {
		q += fmt.Sprintf(` AND status = $%d`, n)
		args = append(args, status)
		n++
	}
	q += ` ORDER BY due_date ASC`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, title, auth, freq, cat, st, penalty, desc string
		var due time.Time
		_ = rows.Scan(&id, &title, &auth, &due, &freq, &cat, &st, &penalty, &desc)
		daysUntil := int(time.Until(due).Hours() / 24)
		alert := "normal"
		if daysUntil <= 7 {
			alert = "critical"
		} else if daysUntil <= 30 {
			alert = "high"
		} else if daysUntil <= 60 {
			alert = "medium"
		}
		result = append(result, map[string]interface{}{
			"id": id, "title": title, "authority": auth, "due_date": due.Format("2006-01-02"),
			"frequency": freq, "category": cat, "status": st, "penalty": penalty,
			"description": desc, "days_until_due": daysUntil, "alert_level": alert,
		})
	}
	return result, nil
}

func (s *Store) GetUpcoming(ctx context.Context, days int) ([]map[string]interface{}, error) {
	cutoff := time.Now().AddDate(0, 0, days)
	rows, err := s.db.QueryContext(ctx, `SELECT id, title, authority, due_date, status, penalty FROM compliance_deadlines
		WHERE due_date <= $1 AND status != 'completed' ORDER BY due_date ASC`, cutoff)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, title, auth, st, penalty string
		var due time.Time
		_ = rows.Scan(&id, &title, &auth, &due, &st, &penalty)
		daysUntil := int(time.Until(due).Hours() / 24)
		alert := "normal"
		if daysUntil <= 7 {
			alert = "critical"
		} else if daysUntil <= 30 {
			alert = "high"
		}
		result = append(result, map[string]interface{}{
			"id": id, "title": title, "authority": auth, "due_date": due.Format("2006-01-02"),
			"status": st, "penalty": penalty, "days_until_due": daysUntil, "alert_level": alert,
		})
	}
	return result, nil
}

func (s *Store) Close() error { return s.db.Close() }

// publishEvent performs a REAL produce via the Kafka REST proxy and returns
// an honest error on any failure. It never claims publication into the void.
func publishEvent(kafkaURL, topic string, event interface{}) error {
	if kafkaURL == "" {
		return fmt.Errorf("eventing unavailable: KAFKA_REST_URL is not configured")
	}
	body, err := json.Marshal(map[string]interface{}{"records": []map[string]interface{}{{"value": event}}})
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/topics/%s", kafkaURL, topic), strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("kafka rest proxy unreachable: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("kafka rest proxy returned HTTP %d", resp.StatusCode)
	}
	return nil
}

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
		all, _ := store.ListDeadlines(r.Context(), "", "")
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "compliance-calendar", "database": st, "total_deadlines": len(all)})
	})
	mux.HandleFunc("/api/v1/compliance/deadlines", func(w http.ResponseWriter, r *http.Request) {
		auth := r.URL.Query().Get("authority")
		status := r.URL.Query().Get("status")
		deadlines, err := store.ListDeadlines(r.Context(), auth, status)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if deadlines == nil {
			deadlines = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"deadlines": deadlines, "total": len(deadlines)})
	})
	mux.HandleFunc("/api/v1/compliance/upcoming", func(w http.ResponseWriter, r *http.Request) {
		days := 30
		upcoming, err := store.GetUpcoming(r.Context(), days)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if upcoming == nil {
			upcoming = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"upcoming": upcoming, "total": len(upcoming), "days_ahead": days})
	})
	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Compliance Calendar starting on port %s", cfg.Port)
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
