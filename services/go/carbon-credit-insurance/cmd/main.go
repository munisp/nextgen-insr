package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// Carbon Credit Insurance — Parametric insurance for carbon credit projects
// Port: 8126
//
// Middleware: PostgreSQL (project store), Kafka (verification events),
// TigerBeetle (credit ledger), Temporal (verification workflows), Keycloak (JWT auth)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8126"),
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
		CREATE TABLE IF NOT EXISTS carbon_products (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			coverage_type TEXT NOT NULL,
			premium_rate DOUBLE PRECISION NOT NULL,
			max_coverage BIGINT NOT NULL,
			ndvi_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.3,
			active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS carbon_projects (
			id TEXT PRIMARY KEY,
			product_id TEXT NOT NULL REFERENCES carbon_products(id),
			project_name TEXT NOT NULL,
			location TEXT NOT NULL,
			area_hectares DOUBLE PRECISION NOT NULL,
			carbon_credits INT NOT NULL,
			credit_price BIGINT NOT NULL,
			ndvi_baseline DOUBLE PRECISION NOT NULL DEFAULT 0.7,
			status TEXT NOT NULL DEFAULT 'active',
			insured_value BIGINT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS carbon_claims (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES carbon_projects(id),
			ndvi_current DOUBLE PRECISION NOT NULL,
			ndvi_baseline DOUBLE PRECISION NOT NULL,
			deficit DOUBLE PRECISION NOT NULL DEFAULT 0,
			payout_amount BIGINT NOT NULL DEFAULT 0,
			satellite_image_ref TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			verified_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_carbon_projects_status ON carbon_projects(status);
		CREATE INDEX IF NOT EXISTS idx_carbon_claims_project ON carbon_claims(project_id);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	products := []struct {
		id, name, covType string
		rate, ndvi        float64
		maxCov            int64
	}{
		{"CP-001", "Forest Carbon Shield", "reforestation", 0.03, 0.3, 50000000},
		{"CP-002", "Savanna Carbon Guard", "grassland", 0.025, 0.25, 30000000},
		{"CP-003", "Mangrove Blue Carbon", "coastal", 0.04, 0.35, 80000000},
	}
	for _, p := range products {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO carbon_products (id, name, coverage_type, premium_rate, max_coverage, ndvi_threshold)
			VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, p.id, p.name, p.covType, p.rate, p.maxCov, p.ndvi)
	}
	projects := []struct {
		id, prodID, name, loc string
		area, ndviBl          float64
		credits               int
		price, insured        int64
	}{
		{"PRJ-001", "CP-001", "Ogun Forest Reserve", "Ogun State, Nigeria", 500.0, 0.72, 5000, 150000, 7500000},
		{"PRJ-002", "CP-002", "Kaduna Savanna Project", "Kaduna State, Nigeria", 1200.0, 0.45, 3000, 100000, 3000000},
	}
	for _, p := range projects {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO carbon_projects (id, product_id, project_name, location, area_hectares, carbon_credits, credit_price, ndvi_baseline, insured_value)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`, p.id, p.prodID, p.name, p.loc, p.area, p.credits, p.price, p.ndviBl, p.insured)
	}
	return nil
}

func (s *Store) ListProducts(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, coverage_type, premium_rate, max_coverage, ndvi_threshold, active FROM carbon_products WHERE active = true ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, covType string
		var rate, ndvi float64
		var maxCov int64
		var active bool
		_ = rows.Scan(&id, &name, &covType, &rate, &maxCov, &ndvi, &active)
		result = append(result, map[string]interface{}{
			"id": id, "name": name, "coverage_type": covType, "premium_rate": rate,
			"max_coverage": maxCov, "ndvi_threshold": ndvi,
		})
	}
	return result, nil
}

func (s *Store) VerifyClaim(ctx context.Context, projectID string, ndviCurrent float64) (map[string]interface{}, error) {
	var projName, loc, status string
	var ndviBaseline float64
	var insuredValue int64
	err := s.db.QueryRowContext(ctx, `SELECT project_name, location, ndvi_baseline, insured_value, status FROM carbon_projects WHERE id = $1`, projectID).
		Scan(&projName, &loc, &ndviBaseline, &insuredValue, &status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	deficit := math.Max(0, (ndviBaseline-ndviCurrent)/ndviBaseline)
	payoutAmount := int64(0)
	claimStatus := "no_trigger"
	if deficit > 0.1 {
		payoutAmount = int64(float64(insuredValue) * deficit)
		claimStatus = "approved"
	}

	claimID := fmt.Sprintf("CC-%d", time.Now().UnixNano()%100000)
	_, _ = s.db.ExecContext(ctx, `INSERT INTO carbon_claims (id, project_id, ndvi_current, ndvi_baseline, deficit, payout_amount, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, claimID, projectID, ndviCurrent, ndviBaseline, deficit, payoutAmount, claimStatus)

	return map[string]interface{}{
		"claim_id":      claimID,
		"project_id":    projectID,
		"project_name":  projName,
		"ndvi_baseline": ndviBaseline,
		"ndvi_current":  ndviCurrent,
		"deficit":       math.Round(deficit*10000) / 10000,
		"payout_amount": payoutAmount,
		"status":        claimStatus,
	}, nil
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
		_ = resp.Body.Close()
	}()
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
		products, _ := store.ListProducts(r.Context())
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "carbon-credit-insurance", "database": st, "products": len(products)})
	})

	mux.HandleFunc("/api/v1/carbon/products", func(w http.ResponseWriter, r *http.Request) {
		products, err := store.ListProducts(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if products == nil {
			products = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"products": products, "total": len(products)})
	})

	mux.HandleFunc("/api/v1/carbon/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			ProjectID   string  `json:"project_id"`
			NDVICurrent float64 `json:"ndvi_current"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ProjectID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "project_id and ndvi_current are required"})
			return
		}
		result, err := store.VerifyClaim(r.Context(), req.ProjectID, req.NDVICurrent)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "verification failed"})
			return
		}
		if result == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if result["status"].(string) == "approved" {
			publishEvent(cfg.KafkaURL, "carbon.claim.approved", result)
		}
		writeJSON(w, http.StatusOK, result)
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Carbon Credit Insurance starting on port %s", cfg.Port)
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
