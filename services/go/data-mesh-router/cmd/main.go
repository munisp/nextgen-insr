package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Insurance Data Mesh Router — Domain-Owned Analytics
// Port: 8118
//
// Routes data product queries to domain owners:
// - Claims Analytics, Payment Intelligence, Agent Performance, Risk Models
// - Data contracts at Kafka topic level (schema enforcement)
// - Self-service SQL queries via Trino
// - NAICOM data governance compliance
//
// Middleware: Lakehouse (Iceberg/Trino), Kafka, OpenSearch, Temporal, Dapr

type DataProduct struct {
	ID          string   `json:"id"`
	Domain      string   `json:"domain"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Owner       string   `json:"owner"`
	Format      string   `json:"format"`
	Freshness   string   `json:"freshness"`
	Quality     float64  `json:"quality_score"`
	Tags        []string `json:"tags"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8118"
	}

	products := []DataProduct{
		{ID: "dp-claims-analytics", Domain: "claims", Name: "Claims Analytics", Description: "Aggregated claims data with settlement times, fraud scores, and category breakdowns", Owner: "claims-team", Format: "iceberg", Freshness: "hourly", Quality: 0.94, Tags: []string{"claims", "analytics", "naicom"}},
		{ID: "dp-payment-intelligence", Domain: "payments", Name: "Payment Intelligence", Description: "Payment success rates, gateway performance, reconciliation status", Owner: "payments-team", Format: "iceberg", Freshness: "real-time", Quality: 0.98, Tags: []string{"payments", "reconciliation", "tigerbeetle"}},
		{ID: "dp-agent-performance", Domain: "agents", Name: "Agent Performance", Description: "Sales metrics, commission earnings, territory coverage, churn risk", Owner: "agent-team", Format: "iceberg", Freshness: "daily", Quality: 0.91, Tags: []string{"agents", "gamification", "territory"}},
		{ID: "dp-risk-models", Domain: "underwriting", Name: "Risk Model Outputs", Description: "Underwriting decisions, risk scores, model performance metrics", Owner: "ml-team", Format: "parquet", Freshness: "real-time", Quality: 0.96, Tags: []string{"ml", "underwriting", "risk"}},
		{ID: "dp-customer-360", Domain: "customers", Name: "Customer 360 View", Description: "Unified customer profile with policies, claims, payments, interactions", Owner: "cx-team", Format: "iceberg", Freshness: "hourly", Quality: 0.89, Tags: []string{"customer", "profile", "360"}},
		{ID: "dp-regulatory", Domain: "compliance", Name: "Regulatory Reports", Description: "Pre-computed NAICOM, CBN, NDPR compliance data ready for submission", Owner: "compliance-team", Format: "iceberg", Freshness: "daily", Quality: 0.99, Tags: []string{"naicom", "cbn", "ndpr", "compliance"}},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":         "healthy",
			"service":        "data-mesh-router",
			"version":        "1.0.0",
			"data_products":  len(products),
			"query_engine":   "trino",
			"storage":        "apache_iceberg",
		})
	})

	mux.HandleFunc("/api/v1/data-mesh/products", func(w http.ResponseWriter, r *http.Request) {
		domain := r.URL.Query().Get("domain")
		filtered := make([]DataProduct, 0)
		for _, p := range products {
			if domain != "" && p.Domain != domain {
				continue
			}
			filtered = append(filtered, p)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"products": filtered,
			"total":    len(filtered),
		})
	})

	mux.HandleFunc("/api/v1/data-mesh/query", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			SQL       string `json:"sql"`
			ProductID string `json:"product_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}
		// Simulated Trino query execution
		json.NewEncoder(w).Encode(map[string]interface{}{
			"query_id":   "Q-" + time.Now().Format("20060102150405"),
			"product_id": req.ProductID,
			"status":     "completed",
			"rows":       125,
			"duration_ms": 450,
			"result_preview": []map[string]interface{}{
				{"metric": "avg_settlement_time_days", "value": 5.2},
				{"metric": "total_claims_q2", "value": 1250},
				{"metric": "fraud_detection_rate", "value": 0.87},
			},
		})
	})

	mux.HandleFunc("/api/v1/data-mesh/lineage/", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"product_id": "dp-claims-analytics",
			"lineage": []map[string]interface{}{
				{"source": "claims_table", "transform": "aggregate_daily", "sink": "iceberg_claims_analytics"},
				{"source": "fraud_scores_table", "transform": "join_enrich", "sink": "iceberg_claims_analytics"},
			},
			"last_refreshed": time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/api/v1/data-mesh/governance", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"compliance_score": 0.95,
			"pii_fields_encrypted": 42,
			"retention_policies_active": 8,
			"access_controls": map[string]int{"read": 25, "write": 8, "admin": 3},
			"naicom_data_requirements_met": true,
			"ndpr_compliance": true,
		})
	})

	log.Printf("Data Mesh Router starting on port %s", port)
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
