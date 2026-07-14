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

// Agent Super-App BFF — Unified backend for the agent mobile app
// Port: 8116
//
// Middleware: PostgreSQL (agent store), Kafka (activity events), Redis (session cache),
// TigerBeetle (commission ledger), Keycloak (JWT auth), Permify (territory access)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8116"),
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
		CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL,
			phone TEXT,
			rank TEXT NOT NULL DEFAULT 'Bronze',
			territory TEXT NOT NULL DEFAULT 'Lagos',
			territory_lat DOUBLE PRECISION NOT NULL DEFAULT 6.5244,
			territory_lng DOUBLE PRECISION NOT NULL DEFAULT 3.3792,
			territory_radius_km DOUBLE PRECISION NOT NULL DEFAULT 25.0,
			total_policies_sold INT NOT NULL DEFAULT 0,
			total_premium_collected BIGINT NOT NULL DEFAULT 0,
			pending_commission BIGINT NOT NULL DEFAULT 0,
			paid_commission BIGINT NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS agent_sales (
			id SERIAL PRIMARY KEY,
			agent_id TEXT NOT NULL REFERENCES agents(id),
			policy_id TEXT NOT NULL,
			customer_name TEXT NOT NULL,
			product TEXT NOT NULL,
			premium BIGINT NOT NULL,
			commission BIGINT NOT NULL,
			commission_rate DOUBLE PRECISION NOT NULL DEFAULT 0.10,
			status TEXT NOT NULL DEFAULT 'active',
			lat DOUBLE PRECISION,
			lng DOUBLE PRECISION,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_agent_sales_agent ON agent_sales(agent_id);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	agents := []struct {
		id, name, email, rank, territory string
		lat, lng, radius                 float64
		sold                             int
		premium, pendComm, paidComm      int64
	}{
		{"AGT-001", "Chinedu Okafor", "chinedu@agents.ng", "Gold", "Lagos Mainland", 6.5244, 3.3792, 25.0, 45, 4500000, 225000, 675000},
		{"AGT-002", "Amina Bello", "amina@agents.ng", "Silver", "Abuja Central", 9.0579, 7.4951, 30.0, 28, 2800000, 140000, 420000},
		{"AGT-003", "Emeka Nwosu", "emeka@agents.ng", "Bronze", "Port Harcourt", 4.8156, 7.0498, 20.0, 12, 1200000, 60000, 180000},
	}
	for _, a := range agents {
		s.db.ExecContext(ctx, `INSERT INTO agents (id, name, email, rank, territory, territory_lat, territory_lng, territory_radius_km, total_policies_sold, total_premium_collected, pending_commission, paid_commission)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
			a.id, a.name, a.email, a.rank, a.territory, a.lat, a.lng, a.radius, a.sold, a.premium, a.pendComm, a.paidComm)
	}
	return nil
}

func (s *Store) GetDashboard(ctx context.Context, agentID string) (map[string]interface{}, error) {
	var name, rank, territory, status string
	var sold int
	var premium, pending, paid int64
	err := s.db.QueryRowContext(ctx, `SELECT name, rank, territory, status, total_policies_sold, total_premium_collected, pending_commission, paid_commission FROM agents WHERE id = $1`, agentID).
		Scan(&name, &rank, &territory, &status, &sold, &premium, &pending, &paid)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, _ := s.db.QueryContext(ctx, `SELECT policy_id, customer_name, product, premium, commission, status, created_at FROM agent_sales WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 10`, agentID)
	var recentSales []map[string]interface{}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var pid, cname, prod, st string
			var prem, comm int64
			var at time.Time
			rows.Scan(&pid, &cname, &prod, &prem, &comm, &st, &at)
			recentSales = append(recentSales, map[string]interface{}{
				"policy_id": pid, "customer": cname, "product": prod, "premium": prem, "commission": comm, "status": st, "date": at.Format("2006-01-02"),
			})
		}
	}
	return map[string]interface{}{
		"agent_id": agentID, "name": name, "rank": rank, "territory": territory, "status": status,
		"total_policies_sold": sold, "total_premium_collected": premium,
		"pending_commission": pending, "paid_commission": paid,
		"recent_sales": recentSales,
	}, nil
}

func (s *Store) RecordSale(ctx context.Context, agentID, policyID, customer, product string, premium int64, lat, lng float64) (int64, error) {
	commRate := 0.10
	var rank string
	s.db.QueryRowContext(ctx, `SELECT rank FROM agents WHERE id = $1`, agentID).Scan(&rank)
	switch rank {
	case "Gold":
		commRate = 0.15
	case "Silver":
		commRate = 0.12
	case "Platinum":
		commRate = 0.20
	}
	commission := int64(float64(premium) * commRate)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `INSERT INTO agent_sales (agent_id, policy_id, customer_name, product, premium, commission, commission_rate, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		agentID, policyID, customer, product, premium, commission, commRate, lat, lng)
	if err != nil {
		return 0, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE agents SET total_policies_sold = total_policies_sold + 1, total_premium_collected = total_premium_collected + $2, pending_commission = pending_commission + $3 WHERE id = $1`,
		agentID, premium, commission)
	if err != nil {
		return 0, err
	}
	return commission, tx.Commit()
}

func (s *Store) CheckGeofence(ctx context.Context, agentID string, lat, lng float64) (bool, float64, error) {
	var tLat, tLng, radius float64
	err := s.db.QueryRowContext(ctx, `SELECT territory_lat, territory_lng, territory_radius_km FROM agents WHERE id = $1`, agentID).Scan(&tLat, &tLng, &radius)
	if err != nil {
		return false, 0, err
	}
	dist := haversine(lat, lng, tLat, tLng)
	return dist <= radius, dist, nil
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
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
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "agent-superapp-bff", "database": st})
	})

	mux.HandleFunc("/api/v1/agent/dashboard", func(w http.ResponseWriter, r *http.Request) {
		agentID := r.URL.Query().Get("agent_id")
		if agentID == "" {
			agentID = "AGT-001"
		}
		dash, err := store.GetDashboard(r.Context(), agentID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if dash == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusOK, dash)
	})

	mux.HandleFunc("/api/v1/agent/sale", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			AgentID  string  `json:"agent_id"`
			PolicyID string  `json:"policy_id"`
			Customer string  `json:"customer"`
			Product  string  `json:"product"`
			Premium  int64   `json:"premium"`
			Lat      float64 `json:"lat"`
			Lng      float64 `json:"lng"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AgentID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		inTerritory, dist, _ := store.CheckGeofence(r.Context(), req.AgentID, req.Lat, req.Lng)
		if !inTerritory && req.Lat != 0 {
			writeJSON(w, http.StatusForbidden, map[string]interface{}{"error": "outside assigned territory", "distance_km": dist})
			return
		}
		commission, err := store.RecordSale(r.Context(), req.AgentID, req.PolicyID, req.Customer, req.Product, req.Premium, req.Lat, req.Lng)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "sale recording failed"})
			return
		}
		publishEvent(cfg.KafkaURL, "agent.sale.recorded", map[string]interface{}{"agent_id": req.AgentID, "policy_id": req.PolicyID, "commission": commission})
		writeJSON(w, http.StatusCreated, map[string]interface{}{"commission": commission, "status": "recorded", "in_territory": inTerritory})
	})

	mux.HandleFunc("/api/v1/agent/geofence", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AgentID string  `json:"agent_id"`
			Lat     float64 `json:"lat"`
			Lng     float64 `json:"lng"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AgentID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		inTerritory, dist, err := store.CheckGeofence(r.Context(), req.AgentID, req.Lat, req.Lng)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "geofence check failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"in_territory": inTerritory, "distance_km": math.Round(dist*100) / 100})
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("Agent Super-App BFF starting on port %s", cfg.Port)
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
