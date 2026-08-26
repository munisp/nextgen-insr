package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

// NHIA Integration Service — National Health Insurance Authority
// Port: 8120
//
// Backing: PostgreSQL (beneficiary/employer/preauth store — REAL).
// HONEST CONTRACT: no NHIA adjudication API is integrated in-tree, so
// pre-authorizations are recorded as "pending" with zero approved amount —
// they are NEVER auto-approved by this service. Approval requires a real
// adjudication leg that does not exist here.

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	JWTSecret   string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8120"),
		DatabaseURL: envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:    envOr("KAFKA_REST_URL", "http://kafka-rest:8082"),
		JWTSecret:   envOr("JWT_SECRET", ""),
		Environment: envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ── Database Layer ──────────────────────────────────────────────────────────

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
		CREATE TABLE IF NOT EXISTS nhia_beneficiaries (
			id TEXT PRIMARY KEY,
			nhia_pin TEXT UNIQUE NOT NULL,
			full_name TEXT NOT NULL,
			bvn TEXT NOT NULL,
			date_of_birth TEXT,
			relationship TEXT NOT NULL DEFAULT 'principal',
			status TEXT NOT NULL DEFAULT 'active',
			plan_type TEXT NOT NULL DEFAULT 'standard',
			employer_id TEXT,
			enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS nhia_employers (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			employee_count INT NOT NULL DEFAULT 0,
			monthly_amount BIGINT NOT NULL DEFAULT 0,
			frequency TEXT NOT NULL DEFAULT 'monthly',
			last_paid_at TEXT,
			status TEXT NOT NULL DEFAULT 'current',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS nhia_preauth (
			id TEXT PRIMARY KEY,
			beneficiary_id TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			procedure_name TEXT NOT NULL,
			diagnosis_code TEXT,
			estimated_cost BIGINT NOT NULL,
			approved_amount BIGINT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			valid_until TIMESTAMPTZ NOT NULL,
			conditions TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_nhia_ben_status ON nhia_beneficiaries(status);
		CREATE INDEX IF NOT EXISTS idx_nhia_emp_status ON nhia_employers(status);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	bens := []struct {
		id, pin, name, bvn, rel, plan string
	}{
		{"BEN-001", "NHIA-2024-001", "Adamu Ibrahim", "22345678901", "principal", "standard"},
		{"BEN-002", "NHIA-2024-002", "Fatima Ibrahim", "22345678902", "spouse", "standard"},
		{"BEN-003", "NHIA-2024-003", "Yusuf Ibrahim", "22345678903", "child", "standard"},
	}
	for _, b := range bens {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO nhia_beneficiaries (id, nhia_pin, full_name, bvn, relationship, status, plan_type, enrolled_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,'active',$6,NOW(),NOW()+INTERVAL '1 year') ON CONFLICT (id) DO NOTHING`,
			b.id, b.pin, b.name, b.bvn, b.rel, b.plan)
	}
	emps := []struct {
		id, name string
		count    int
		amount   int64
		status   string
	}{
		{"EMP-001", "TechCorp Nigeria", 150, 750000, "current"},
		{"EMP-002", "Lagos Trading Co", 45, 225000, "overdue"},
	}
	for _, e := range emps {
		_, _ = s.db.ExecContext(ctx, `INSERT INTO nhia_employers (id, name, employee_count, monthly_amount, status, last_paid_at)
			VALUES ($1,$2,$3,$4,$5,'2026-05-01') ON CONFLICT (id) DO NOTHING`, e.id, e.name, e.count, e.amount, e.status)
	}
	return nil
}

func (s *Store) ListBeneficiaries(ctx context.Context, status string) ([]map[string]interface{}, error) {
	q := `SELECT id, nhia_pin, full_name, bvn, relationship, status, plan_type, enrolled_at, expires_at FROM nhia_beneficiaries WHERE 1=1`
	args := []interface{}{}
	if status != "" {
		q += ` AND status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY full_name`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, pin, name, bvn, rel, st, plan string
		var enrolled, expires time.Time
		_ = rows.Scan(&id, &pin, &name, &bvn, &rel, &st, &plan, &enrolled, &expires)
		result = append(result, map[string]interface{}{
			"id": id, "nhia_pin": pin, "full_name": name, "bvn": bvn,
			"relationship": rel, "status": st, "plan_type": plan,
			"enrolled_at": enrolled.Format(time.RFC3339), "expires_at": expires.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (s *Store) Enroll(ctx context.Context, name, bvn, dob, rel, plan, empID string) (string, error) {
	if len(bvn) < 4 {
		return "", fmt.Errorf("bvn must be at least 4 characters")
	}
	pin := fmt.Sprintf("NHIA-%d-%s", time.Now().Year(), bvn[len(bvn)-4:])
	id := "BEN-" + randomHex(6)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nhia_beneficiaries (id, nhia_pin, full_name, bvn, date_of_birth, relationship, plan_type, employer_id, enrolled_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()+INTERVAL '1 year')`, id, pin, name, bvn, dob, rel, plan, empID)
	if err != nil {
		return "", err
	}
	return pin, nil
}

// CreatePreAuth records a pre-authorization REQUEST. No NHIA adjudication
// API is integrated, so the request is always "pending" with zero approved
// amount — it is never auto-approved by this service.
func (s *Store) CreatePreAuth(ctx context.Context, benID, provID, proc, diag string, cost int64) (map[string]interface{}, error) {
	id := "AUTH-" + randomHex(8)
	validUntil := time.Now().AddDate(0, 0, 30)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nhia_preauth (id, beneficiary_id, provider_id, procedure_name, diagnosis_code, estimated_cost, approved_amount, status, valid_until, conditions)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, benID, provID, proc, diag, cost, 0, "pending", validUntil, "Awaiting adjudication — no NHIA adjudication endpoint is integrated with this service")
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"authorization_id": id, "status": "pending", "approved_amount": 0,
		"estimated_cost": cost,
		"valid_until":    validUntil.Format(time.RFC3339),
		"conditions":     "Awaiting adjudication — no NHIA adjudication endpoint is integrated with this service",
		"adjudication":   "unavailable: this pre-authorization has NOT been approved and authorizes no expenditure",
	}, nil
}

func (s *Store) ListEmployers(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, employee_count, monthly_amount, frequency, last_paid_at, status FROM nhia_employers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, freq, lastPaid, status string
		var count int
		var amount int64
		_ = rows.Scan(&id, &name, &count, &amount, &freq, &lastPaid, &status)
		result = append(result, map[string]interface{}{
			"employer_id": id, "employer_name": name, "employee_count": count,
			"monthly_amount": amount, "frequency": freq, "last_paid_at": lastPaid, "status": status,
		})
	}
	return result, nil
}

func (s *Store) Close() error { return s.db.Close() }

// ── Event Publisher ─────────────────────────────────────────────────────────

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

// randomHex returns n cryptographically random bytes hex-encoded (2n chars).
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// Fail loud rather than fall back to predictable ids.
		panic(fmt.Sprintf("crypto/rand unavailable: %v", err))
	}
	return hex.EncodeToString(b)
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
		log.Fatalf("Database connection failed: %v", err)
	}
	defer func() { _ = store.Close() }()

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		dbErr := store.db.PingContext(r.Context())
		dbStatus := "connected"
		if dbErr != nil {
			dbStatus = "disconnected"
		}
		bens, _ := store.ListBeneficiaries(r.Context(), "")
		emps, _ := store.ListEmployers(r.Context())
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": "healthy", "service": "nhia-integration", "version": "1.0.0",
			"database": dbStatus, "beneficiaries_count": len(bens), "employers_count": len(emps),
		})
	})

	mux.HandleFunc("/api/v1/nhia/enroll", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			EmployerID   string `json:"employer_id"`
			FullName     string `json:"full_name"`
			BVN          string `json:"bvn"`
			DateOfBirth  string `json:"date_of_birth"`
			Relationship string `json:"relationship"`
			PlanType     string `json:"plan_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if req.FullName == "" || req.BVN == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "full_name and bvn are required"})
			return
		}
		pin, err := store.Enroll(r.Context(), req.FullName, req.BVN, req.DateOfBirth, req.Relationship, req.PlanType, req.EmployerID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "enrollment failed"})
			log.Printf("Enroll error: %v", err)
			return
		}
		resp := map[string]interface{}{
			"nhia_pin": pin, "status": "active", "plan_type": req.PlanType,
			"enrolled_at": time.Now().Format(time.RFC3339),
			"expires_at":  time.Now().AddDate(1, 0, 0).Format(time.RFC3339),
			"message":     "Successfully enrolled in NHIA scheme",
		}
		// Honest eventing: surface publication failure instead of pretending.
		if err := publishEvent(cfg.KafkaURL, "nhia.enrollment.created", map[string]string{"nhia_pin": pin, "name": req.FullName}); err != nil {
			log.Printf("[Kafka] CRITICAL: nhia.enrollment.created not published: %v", err)
			resp["event_published"] = false
			resp["event_error"] = err.Error()
		} else {
			resp["event_published"] = true
		}
		writeJSON(w, http.StatusCreated, resp)
	})

	mux.HandleFunc("/api/v1/nhia/pre-authorize", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			BeneficiaryID string `json:"beneficiary_id"`
			ProviderID    string `json:"provider_id"`
			Procedure     string `json:"procedure"`
			DiagnosisCode string `json:"diagnosis_code"`
			EstimatedCost int64  `json:"estimated_cost"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if req.BeneficiaryID == "" || req.Procedure == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "beneficiary_id and procedure are required"})
			return
		}
		result, err := store.CreatePreAuth(r.Context(), req.BeneficiaryID, req.ProviderID, req.Procedure, req.DiagnosisCode, req.EstimatedCost)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "pre-authorization failed"})
			return
		}
		if err := publishEvent(cfg.KafkaURL, "nhia.preauth."+result["status"].(string), result); err != nil {
			log.Printf("[Kafka] CRITICAL: nhia.preauth event not published: %v", err)
			result["event_published"] = false
			result["event_error"] = err.Error()
		} else {
			result["event_published"] = true
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/api/v1/nhia/beneficiaries", func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		bens, err := store.ListBeneficiaries(r.Context(), status)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if bens == nil {
			bens = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"beneficiaries": bens, "total": len(bens)})
	})

	mux.HandleFunc("/api/v1/nhia/contributions", func(w http.ResponseWriter, r *http.Request) {
		emps, err := store.ListEmployers(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if emps == nil {
			emps = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"contributions": emps, "total": len(emps)})
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("NHIA Integration starting on port %s (env=%s)", cfg.Port, cfg.Environment)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	shutdownCtx, c := context.WithTimeout(ctx, 30*time.Second)
	defer c()
	_ = server.Shutdown(shutdownCtx)
}
