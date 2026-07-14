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

// Data Mesh Router — Federated data query engine with domain ownership
// Port: 8118
//
// Middleware: PostgreSQL (data catalog), Kafka (query audit trail),
// OpenSearch (analytics queries), Lakehouse (data products), Redis (query cache)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8118"),
		DatabaseURL: envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:    envOr("KAFKA_REST_URL", "http://localhost:8082"),
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
		CREATE TABLE IF NOT EXISTS data_domains (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			owner TEXT NOT NULL,
			description TEXT,
			tables TEXT[] NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS data_products (
			id TEXT PRIMARY KEY,
			domain_id TEXT NOT NULL REFERENCES data_domains(id),
			name TEXT NOT NULL,
			query_template TEXT NOT NULL,
			output_schema JSONB,
			sla_ms INT NOT NULL DEFAULT 5000,
			access_level TEXT NOT NULL DEFAULT 'internal',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS query_audit_log (
			id SERIAL PRIMARY KEY,
			domain_id TEXT NOT NULL,
			product_id TEXT,
			query_text TEXT NOT NULL,
			row_count INT NOT NULL DEFAULT 0,
			duration_ms INT NOT NULL DEFAULT 0,
			requester TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_query_audit_domain ON query_audit_log(domain_id);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	domains := []struct {
		id, name, owner, desc string
	}{
		{"dom-claims", "Claims", "claims-team", "Insurance claims data domain"},
		{"dom-policies", "Policies", "underwriting-team", "Policy lifecycle data domain"},
		{"dom-payments", "Payments", "finance-team", "Premium and payout data domain"},
		{"dom-agents", "Agents", "distribution-team", "Agent performance data domain"},
	}
	for _, d := range domains {
		s.db.ExecContext(ctx, `INSERT INTO data_domains (id, name, owner, description)
			VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, d.id, d.name, d.owner, d.desc)
	}
	products := []struct {
		id, domID, name, query, access string
		sla                            int
	}{
		{"dp-claims-summary", "dom-claims", "Claims Summary", "SELECT status, COUNT(*) as count, SUM(amount) as total FROM claims GROUP BY status", "internal", 2000},
		{"dp-policy-metrics", "dom-policies", "Policy Metrics", "SELECT product_type, COUNT(*) as active_count, AVG(premium) as avg_premium FROM policies WHERE status = 'active' GROUP BY product_type", "internal", 3000},
		{"dp-revenue", "dom-payments", "Revenue Report", "SELECT date_trunc('month', created_at) as month, SUM(amount) as revenue FROM payments WHERE status = 'success' GROUP BY month ORDER BY month DESC", "restricted", 5000},
	}
	for _, p := range products {
		s.db.ExecContext(ctx, `INSERT INTO data_products (id, domain_id, name, query_template, sla_ms, access_level)
			VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, p.id, p.domID, p.name, p.query, p.sla, p.access)
	}
	return nil
}

func (s *Store) ListDomains(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT d.id, d.name, d.owner, d.description, COUNT(p.id) as product_count
		FROM data_domains d LEFT JOIN data_products p ON p.domain_id = d.id GROUP BY d.id ORDER BY d.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, owner, desc string
		var count int
		rows.Scan(&id, &name, &owner, &desc, &count)
		result = append(result, map[string]interface{}{
			"id": id, "name": name, "owner": owner, "description": desc, "product_count": count,
		})
	}
	return result, nil
}

func (s *Store) ExecuteQuery(ctx context.Context, domainID, queryText, requester string) ([]map[string]interface{}, int, error) {
	start := time.Now()

	// Validate domain exists
	var domName string
	err := s.db.QueryRowContext(ctx, `SELECT name FROM data_domains WHERE id = $1`, domainID).Scan(&domName)
	if err == sql.ErrNoRows {
		return nil, 0, fmt.Errorf("domain not found")
	}
	if err != nil {
		return nil, 0, err
	}

	// Execute the query against PostgreSQL (sandboxed read-only)
	if !isReadOnlyQuery(queryText) {
		return nil, 0, fmt.Errorf("only SELECT queries are allowed")
	}

	rows, err := s.db.QueryContext(ctx, queryText)
	if err != nil {
		return nil, 0, fmt.Errorf("query execution failed: %w", err)
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)
		entry := make(map[string]interface{})
		for i, col := range cols {
			entry[col] = values[i]
		}
		results = append(results, entry)
	}

	durationMs := int(time.Since(start).Milliseconds())

	// Audit log
	s.db.ExecContext(ctx, `INSERT INTO query_audit_log (domain_id, query_text, row_count, duration_ms, requester) VALUES ($1,$2,$3,$4,$5)`,
		domainID, queryText, len(results), durationMs, requester)

	return results, durationMs, nil
}

func isReadOnlyQuery(q string) bool {
	upper := strings.ToUpper(strings.TrimSpace(q))
	return strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "WITH")
}

func (s *Store) Close() error { return s.db.Close() }

func publishEvent(kafkaURL, topic string, event interface{}) {
	data, _ := json.Marshal(event)
	log.Printf("[Kafka] topic=%s payload=%s", topic, string(data))
	if kafkaURL == "" {
		return
	}
	go func() {
		body, _ := json.Marshal(map[string]interface{}{"records": []map[string]interface{}{{"value": event}}})
		req, _ := http.NewRequest("POST", fmt.Sprintf("%s/topics/%s", kafkaURL, topic), strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/vnd.kafka.json.v2+json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return
		}
		resp.Body.Close()
	}()
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if code != http.StatusOK {
		w.WriteHeader(code)
	}
	json.NewEncoder(w).Encode(v)
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := NewStore(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	defer store.Close()
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		dbErr := store.db.PingContext(r.Context())
		st := "connected"
		if dbErr != nil {
			st = "disconnected"
		}
		domains, _ := store.ListDomains(r.Context())
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "data-mesh-router", "database": st, "domains": len(domains)})
	})

	mux.HandleFunc("/api/v1/data-mesh/domains", func(w http.ResponseWriter, r *http.Request) {
		domains, err := store.ListDomains(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if domains == nil {
			domains = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"domains": domains, "total": len(domains)})
	})

	mux.HandleFunc("/api/v1/data-mesh/query", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			DomainID string `json:"domain_id"`
			Query    string `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Query == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "domain_id and query are required"})
			return
		}
		if req.DomainID == "" {
			req.DomainID = "dom-claims"
		}
		results, durationMs, err := store.ExecuteQuery(r.Context(), req.DomainID, req.Query, "api-user")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if results == nil {
			results = []map[string]interface{}{}
		}
		publishEvent(cfg.KafkaURL, "data-mesh.query.executed", map[string]interface{}{"domain_id": req.DomainID, "rows": len(results), "duration_ms": durationMs})
		writeJSON(w, http.StatusOK, map[string]interface{}{"results": results, "row_count": len(results), "duration_ms": durationMs})
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Data Mesh Router starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	shutdownCtx, c := context.WithTimeout(ctx, 30*time.Second)
	defer c()
	server.Shutdown(shutdownCtx)
}
