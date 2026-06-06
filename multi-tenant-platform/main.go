package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Multi-Tenant Platform — white-label insurance platform for multiple insurers
// Business Rules:
// - Tenant isolation: Separate schemas per tenant, shared infrastructure
// - Branding: Custom logo, colors, domain per tenant
// - Feature flags: Per-tenant feature enablement
// - Data residency: Tenant data never crosses boundaries
// - Billing: Per-policy or monthly subscription model
// - Onboarding: Self-service tenant provisioning in < 24 hours

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func main() {
	initKafka()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "multi-tenant-platform"})
	})
	r.Get("/api/v1/tenants", listTenants)
	r.Post("/api/v1/tenants", createTenant)
	r.Get("/api/v1/tenants/{id}/config", getTenantConfig)

	port := os.Getenv("PORT")
	if port == "" { port = "8133" }
	log.Printf("Multi-Tenant Platform starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listTenants(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenants": []map[string]interface{}{
			{"id": "TEN-001", "name": "A&G Insurance", "domain": "ag.insureportal.ng", "status": "active", "policies": 12000},
			{"id": "TEN-002", "name": "Leadway Assurance", "domain": "leadway.insureportal.ng", "status": "active", "policies": 8500},
		},
	})
}

func createTenant(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenant_id": "TEN-" + time.Now().Format("20060102"), "status": "provisioning",
		"estimated_ready": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"isolation": "schema_per_tenant",
	})
}

func getTenantConfig(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenant_id": chi.URLParam(r, "id"),
		"branding": map[string]string{"primary_color": "#1a365d", "logo_url": "/assets/logo.png"},
		"features": []string{"claims", "policies", "agents", "reports", "microinsurance"},
		"billing_model": "per_policy", "data_residency": "NG",
	})
}
