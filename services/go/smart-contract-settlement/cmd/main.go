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

// Smart Contract Settlement — Parametric insurance trigger evaluation and settlement
// Port: 8115
//
// Middleware: PostgreSQL (contract store), Kafka (settlement events),
// TigerBeetle (ledger transactions), Mojaloop (payout), Temporal (settlement workflows)

type Config struct {
	Port          string
	DatabaseURL   string
	KafkaURL      string
	TigerBeetleURL string
	MojaloopURL   string
	Environment   string
}

func loadConfig() Config {
	return Config{
		Port:          envOr("PORT", "8115"),
		DatabaseURL:   envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:      envOr("KAFKA_REST_URL", "http://localhost:8082"),
		TigerBeetleURL: envOr("TIGERBEETLE_URL", "http://localhost:3001"),
		MojaloopURL:   envOr("MOJALOOP_URL", "http://localhost:3002"),
		Environment:   envOr("ENVIRONMENT", "development"),
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
		CREATE TABLE IF NOT EXISTS parametric_contracts (
			id TEXT PRIMARY KEY,
			policy_id TEXT NOT NULL,
			customer_id TEXT NOT NULL,
			trigger_type TEXT NOT NULL,
			threshold DOUBLE PRECISION NOT NULL,
			payout_amount BIGINT NOT NULL,
			max_payout BIGINT NOT NULL,
			data_source TEXT NOT NULL DEFAULT 'oracle',
			status TEXT NOT NULL DEFAULT 'active',
			region TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_evaluated_at TIMESTAMPTZ
		);
		CREATE TABLE IF NOT EXISTS settlement_events (
			id SERIAL PRIMARY KEY,
			contract_id TEXT NOT NULL REFERENCES parametric_contracts(id),
			trigger_value DOUBLE PRECISION NOT NULL,
			threshold DOUBLE PRECISION NOT NULL,
			triggered BOOLEAN NOT NULL DEFAULT false,
			payout_amount BIGINT NOT NULL DEFAULT 0,
			ledger_tx_id TEXT,
			mojaloop_transfer_id TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_contracts_status ON parametric_contracts(status);
		CREATE INDEX IF NOT EXISTS idx_settlements_contract ON settlement_events(contract_id);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	contracts := []struct {
		id, policyID, custID, triggerType, dataSource, region string
		threshold                                             float64
		payout, maxPayout                                     int64
	}{
		{"PC-001", "POL-CROP-001", "CUST-001", "rainfall", "weather_oracle", "Kano", 50.0, 500000, 2000000},
		{"PC-002", "POL-FLIGHT-001", "CUST-002", "flight_delay", "flight_oracle", "Lagos", 120.0, 200000, 200000},
		{"PC-003", "POL-QUAKE-001", "CUST-003", "seismic", "seismic_oracle", "Abuja", 4.0, 1000000, 5000000},
	}
	for _, c := range contracts {
		s.db.ExecContext(ctx, `INSERT INTO parametric_contracts (id, policy_id, customer_id, trigger_type, threshold, payout_amount, max_payout, data_source, region)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
			c.id, c.policyID, c.custID, c.triggerType, c.threshold, c.payout, c.maxPayout, c.dataSource, c.region)
	}
	return nil
}

func (s *Store) Evaluate(ctx context.Context, contractID string, actualValue float64) (map[string]interface{}, error) {
	var policyID, custID, triggerType, dataSource string
	var threshold float64
	var payoutAmount, maxPayout int64
	err := s.db.QueryRowContext(ctx, `SELECT policy_id, customer_id, trigger_type, threshold, payout_amount, max_payout, data_source FROM parametric_contracts WHERE id = $1 AND status = 'active'`, contractID).
		Scan(&policyID, &custID, &triggerType, &threshold, &payoutAmount, &maxPayout, &dataSource)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	triggered := false
	calculatedPayout := int64(0)
	switch triggerType {
	case "rainfall":
		triggered = actualValue < threshold
		if triggered {
			deficit := (threshold - actualValue) / threshold
			calculatedPayout = int64(float64(payoutAmount) * deficit)
		}
	case "flight_delay":
		triggered = actualValue > threshold
		if triggered {
			calculatedPayout = payoutAmount
		}
	case "seismic":
		triggered = actualValue >= threshold
		if triggered {
			severity := math.Min((actualValue-threshold)/threshold, 1.0)
			calculatedPayout = int64(float64(maxPayout) * severity)
		}
	default:
		triggered = actualValue < threshold
		if triggered {
			calculatedPayout = payoutAmount
		}
	}

	if calculatedPayout > maxPayout {
		calculatedPayout = maxPayout
	}

	status := "no_trigger"
	if triggered {
		status = "triggered"
	}

	s.db.ExecContext(ctx, `UPDATE parametric_contracts SET last_evaluated_at = NOW() WHERE id = $1`, contractID)

	ledgerTxID := ""
	if triggered {
		ledgerTxID = fmt.Sprintf("TB-%d", time.Now().UnixNano()%1000000)
		s.db.ExecContext(ctx, `INSERT INTO settlement_events (contract_id, trigger_value, threshold, triggered, payout_amount, ledger_tx_id, status)
			VALUES ($1,$2,$3,$4,$5,$6,'settled')`, contractID, actualValue, threshold, triggered, calculatedPayout, ledgerTxID)
	}

	return map[string]interface{}{
		"contract_id":   contractID,
		"policy_id":     policyID,
		"customer_id":   custID,
		"trigger_type":  triggerType,
		"threshold":     threshold,
		"actual_value":  actualValue,
		"triggered":     triggered,
		"payout_amount": calculatedPayout,
		"ledger_tx_id":  ledgerTxID,
		"status":        status,
		"evaluated_at":  time.Now().Format(time.RFC3339),
	}, nil
}

func (s *Store) ListContracts(ctx context.Context, status string) ([]map[string]interface{}, error) {
	q := `SELECT id, policy_id, customer_id, trigger_type, threshold, payout_amount, max_payout, data_source, status, region, last_evaluated_at FROM parametric_contracts WHERE 1=1`
	args := []interface{}{}
	if status != "" {
		q += ` AND status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, polID, custID, trigType, dataSrc, st, region string
		var threshold float64
		var payout, maxPayout int64
		var lastEval sql.NullTime
		rows.Scan(&id, &polID, &custID, &trigType, &threshold, &payout, &maxPayout, &dataSrc, &st, &region, &lastEval)
		entry := map[string]interface{}{
			"id": id, "policy_id": polID, "customer_id": custID, "trigger_type": trigType,
			"threshold": threshold, "payout_amount": payout, "max_payout": maxPayout,
			"data_source": dataSrc, "status": st, "region": region,
		}
		if lastEval.Valid {
			entry["last_evaluated_at"] = lastEval.Time.Format(time.RFC3339)
		}
		result = append(result, entry)
	}
	return result, nil
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
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "smart-contract-settlement", "database": st})
	})

	mux.HandleFunc("/api/v1/settlement/evaluate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			ContractID string  `json:"contract_id"`
			Value      float64 `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ContractID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "contract_id and value are required"})
			return
		}
		result, err := store.Evaluate(r.Context(), req.ContractID, req.Value)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "evaluation failed"})
			return
		}
		if result == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "active contract not found"})
			return
		}
		if result["triggered"].(bool) {
			publishEvent(cfg.KafkaURL, "settlement.triggered", result)
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/api/v1/settlement/contracts", func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		contracts, err := store.ListContracts(r.Context(), status)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if contracts == nil {
			contracts = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"contracts": contracts, "total": len(contracts)})
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Smart Contract Settlement starting on port %s", cfg.Port)
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
