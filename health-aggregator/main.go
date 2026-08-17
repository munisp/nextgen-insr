package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

type ServiceHealth struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Status   string `json:"status"`
	Database string `json:"database,omitempty"`
	Latency  string `json:"latency"`
	Error    string `json:"error,omitempty"`
}

type AggregatedHealth struct {
	Status    string          `json:"status"`
	Timestamp string          `json:"timestamp"`
	Total     int             `json:"total"`
	Healthy   int             `json:"healthy"`
	Unhealthy int             `json:"unhealthy"`
	Services  []ServiceHealth `json:"services"`
}

var services = []struct {
	Name string
	Port int
}{
	{"claims-adjudication-engine", 8091},
	{"underwriting-engine", 8092},
	{"fraud-detection-engine", 8093},
	{"policy-management", 8094},
	{"premium-collection", 8095},
	{"agent-network-platform", 8096},
	{"kyc-kyb-system", 8097},
	{"notification-service", 8101},
	{"agent-commission-management", 8103},
	{"reconciliation-engine", 8105},
	{"microinsurance-engine", 8107},
	{"audit-trail-system", 8109},
	{"enhanced-kyc-kyb", 8111},
	{"gamification-service", 8113},
	{"multi-tenant-platform", 8115},
}

func checkService(name string, port int, client *http.Client) ServiceHealth {
	url := fmt.Sprintf("http://localhost:%d/health", port)
	start := time.Now()

	resp, err := client.Get(url)
	latency := time.Since(start)

	result := ServiceHealth{
		Name:    name,
		URL:     url,
		Latency: latency.String(),
	}

	if err != nil {
		result.Status = "unhealthy"
		result.Error = err.Error()
		return result
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		result.Status = "unhealthy"
		result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
		return result
	}

	var healthResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&healthResp); err == nil {
		if db, ok := healthResp["database"].(string); ok {
			result.Database = db
		}
	}

	result.Status = "healthy"
	return result
}

func handleAggregatedHealth(w http.ResponseWriter, r *http.Request) {
	client := &http.Client{Timeout: 5 * time.Second}

	var wg sync.WaitGroup
	results := make([]ServiceHealth, len(services))

	for i, svc := range services {
		wg.Add(1)
		go func(idx int, name string, port int) {
			defer wg.Done()
			results[idx] = checkService(name, port, client)
		}(i, svc.Name, svc.Port)
	}

	wg.Wait()

	healthy := 0
	unhealthy := 0
	for _, r := range results {
		if r.Status == "healthy" {
			healthy++
		} else {
			unhealthy++
		}
	}

	status := "healthy"
	if unhealthy > 0 {
		status = "degraded"
	}
	if healthy == 0 {
		status = "unhealthy"
	}

	agg := AggregatedHealth{
		Status:    status,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Total:     len(services),
		Healthy:   healthy,
		Unhealthy: unhealthy,
		Services:  results,
	}

	w.Header().Set("Content-Type", "application/json")
	if status == "unhealthy" {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(agg)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "health-aggregator",
	})
}

func handleReady(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/aggregate", handleAggregatedHealth)

	port := ":8200"
	log.Printf(`{"level":"info","msg":"service starting","service":"health-aggregator","port":"%s"}`, port)

	srv := &http.Server{
		Addr:         port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf(`{"level":"info","msg":"shutting down gracefully","service":"health-aggregator"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Printf(`{"level":"info","msg":"server stopped","service":"health-aggregator"}`)
}
