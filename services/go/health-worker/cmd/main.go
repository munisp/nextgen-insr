// Package main implements the Insurance Platform Health Probe Worker (Go)
//
// Probes all insurance platform services every 30s, writes results to PostgreSQL,
// raises SLA breach events for critical service failures.
// Port: 8102 | Language: Go

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

type ServiceTarget struct {
	Name     string
	Host     string
	Port     string
	Protocol string
	Path     string
	Critical bool
}

type HealthStatus struct {
	Service    string    `json:"service"`
	Status     string    `json:"status"`
	LatencyMs  int64     `json:"latency_ms"`
	Error      string    `json:"error,omitempty"`
	HTTPStatus int       `json:"http_status,omitempty"`
	Critical   bool      `json:"critical"`
	CheckedAt  time.Time `json:"checked_at"`
}

type PlatformHealth struct {
	Overall       string         `json:"overall"`
	Services      []HealthStatus `json:"services"`
	CheckedAt     time.Time      `json:"checked_at"`
	HealthyCount  int            `json:"healthy_count"`
	DegradedCount int            `json:"degraded_count"`
	DownCount     int            `json:"down_count"`
}

var (
	db         *sql.DB
	lastHealth *PlatformHealth
	services   []ServiceTarget
)

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func defaultServices() []ServiceTarget {
	return []ServiceTarget{
		{Name: "postgresql", Host: "postgres", Port: "5432", Protocol: "tcp", Critical: true},
		{Name: "redis", Host: "redis", Port: "6379", Protocol: "tcp", Critical: true},
		{Name: "temporal", Host: "temporal", Port: "7233", Protocol: "tcp", Critical: true},
		{Name: "keycloak", Host: "keycloak", Port: "8080", Protocol: "http", Path: "/health/ready", Critical: true},
		{Name: "tigerbeetle", Host: "tigerbeetle", Port: "3000", Protocol: "tcp", Critical: true},
		{Name: "fluvio-sc", Host: "fluvio-sc", Port: "9003", Protocol: "tcp", Critical: false},
		{Name: "ollama", Host: "ollama", Port: "11434", Protocol: "http", Path: "/api/tags", Critical: false},
		{Name: "permify", Host: "permify", Port: "3476", Protocol: "tcp", Critical: false},
		{Name: "minio", Host: "minio", Port: "9000", Protocol: "http", Path: "/minio/health/live", Critical: false},
		{Name: "tb-sidecar", Host: "insureportal-tb-sidecar", Port: "7070", Protocol: "http", Path: "/health", Critical: true},
		{Name: "fraud-gate", Host: "insureportal-fraud-gate", Port: "8090", Protocol: "http", Path: "/health", Critical: false},
		{Name: "ml-fraud", Host: "insureportal-ml-fraud", Port: "8000", Protocol: "http", Path: "/health", Critical: false},
		{Name: "kyc-service", Host: "insureportal-kyc", Port: "8001", Protocol: "http", Path: "/health", Critical: false},
		{Name: "actuarial", Host: "insureportal-actuarial", Port: "8002", Protocol: "http", Path: "/health", Critical: false},
		{Name: "payment-gateway", Host: "insureportal-payment-gateway", Port: "8100", Protocol: "http", Path: "/health", Critical: true},
	}
}

func parseServicesEnv(v string) []ServiceTarget {
	svcs := []ServiceTarget{}
	for _, entry := range strings.Split(v, ",") {
		parts := strings.Split(strings.TrimSpace(entry), ":")
		if len(parts) >= 2 {
			svc := ServiceTarget{Name: parts[0], Host: parts[0], Port: parts[1], Protocol: "tcp"}
			svcs = append(svcs, svc)
		}
	}
	return svcs
}

func probeTCP(host, port string) (int64, error) {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 5*time.Second)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return lat, err
	}
	conn.Close()
	return lat, nil
}

func probeHTTP(host, port, path, proto string) (int64, int, error) {
	start := time.Now()
	url := fmt.Sprintf("%s://%s:%s%s", proto, host, port, path)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return lat, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return lat, resp.StatusCode, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return lat, resp.StatusCode, nil
}

func probeService(svc ServiceTarget) HealthStatus {
	s := HealthStatus{Service: svc.Name, Critical: svc.Critical, CheckedAt: time.Now()}
	var lat int64
	var err error
	var code int
	switch svc.Protocol {
	case "http", "https":
		lat, code, err = probeHTTP(svc.Host, svc.Port, svc.Path, svc.Protocol)
		s.HTTPStatus = code
	default:
		lat, err = probeTCP(svc.Host, svc.Port)
	}
	s.LatencyMs = lat
	if err != nil {
		s.Status = "down"
		s.Error = err.Error()
	} else if lat > 5000 {
		s.Status = "degraded"
	} else {
		s.Status = "healthy"
	}
	return s
}

func runHealthCheck(ctx context.Context) *PlatformHealth {
	type res struct {
		idx int
		s   HealthStatus
	}
	ch := make(chan res, len(services))
	for i, svc := range services {
		go func(idx int, s ServiceTarget) { ch <- res{idx, probeService(s)} }(i, svc)
	}
	collected := make([]HealthStatus, len(services))
	for range services {
		r := <-ch
		collected[r.idx] = r.s
	}

	healthy, degraded, down := 0, 0, 0
	criticalDown := false
	for _, s := range collected {
		switch s.Status {
		case "healthy":
			healthy++
		case "degraded":
			degraded++
		case "down":
			down++
			if s.Critical {
				criticalDown = true
			}
		}
	}

	overall := "healthy"
	if criticalDown {
		overall = "critical"
	} else if down > 0 || degraded > 0 {
		overall = "degraded"
	}

	health := &PlatformHealth{
		Overall: overall, Services: collected, CheckedAt: time.Now(),
		HealthyCount: healthy, DegradedCount: degraded, DownCount: down,
	}
	lastHealth = health

	if db != nil {
		for _, s := range collected {
			errMsg := s.Error
			_, _ = db.ExecContext(ctx,
				`INSERT INTO platform_health_checks (service_name,status,latency_ms,error_message,http_status,is_critical,checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				s.Service, s.Status, s.LatencyMs, errMsg, s.HTTPStatus, s.Critical, s.CheckedAt)
		}
		for _, s := range collected {
			if s.Status == "down" && s.Critical {
				_, _ = db.ExecContext(ctx,
					`INSERT INTO sla_breaches (service_name,breach_type,severity,detected_at,status) VALUES ($1,'service_down','critical',$2,'open') ON CONFLICT DO NOTHING`,
					s.Service, s.CheckedAt)
			}
		}
	}
	log.Printf("[HealthWorker] overall=%s healthy=%d degraded=%d down=%d", overall, healthy, degraded, down)
	return health
}

func main() {
	port := getEnv("PORT", "8102")
	dsn := getEnv("POSTGRES_DSN", "postgresql://insureportal:insureportal_dev@localhost:5432/insureportal")
	intervalStr := getEnv("PROBE_INTERVAL", "30s")
	interval, _ := time.ParseDuration(intervalStr)
	if interval == 0 {
		interval = 30 * time.Second
	}

	if v := os.Getenv("SERVICES_TO_PROBE"); v != "" {
		services = parseServicesEnv(v)
	} else {
		services = defaultServices()
	}

	log.Printf("[HealthWorker] Starting on port %s, probing %d services every %s", port, len(services), interval)

	var err error
	db, err = sql.Open("postgres", dsn)
	if err == nil {
		if pingErr := db.Ping(); pingErr != nil {
			log.Printf("[HealthWorker] DB unavailable: %v", pingErr)
			db = nil
		} else {
			defer db.Close()
			_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS platform_health_checks (
				id SERIAL PRIMARY KEY, service_name VARCHAR(64), status VARCHAR(20),
				latency_ms BIGINT, error_message TEXT, http_status INT,
				is_critical BOOLEAN DEFAULT false, checked_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "insureportal-health-worker"})
	})
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		if lastHealth == nil {
			http.Error(w, "no data", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if lastHealth.Overall == "critical" {
			w.WriteHeader(503)
		}
		json.NewEncoder(w).Encode(lastHealth)
	})
	mux.HandleFunc("/probe", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", 405)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		h := runHealthCheck(ctx)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(h)
	})

	server := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		time.Sleep(5 * time.Second)
		runHealthCheck(ctx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				runHealthCheck(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
		sCtx, sCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer sCancel()
		server.Shutdown(sCtx)
	}()

	log.Printf("[HealthWorker] Listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[HealthWorker] Fatal: %v", err)
	}
}
