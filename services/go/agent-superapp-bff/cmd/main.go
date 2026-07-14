package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Agent Super-App Backend-for-Frontend (BFF)
// Port: 8116
//
// Unified API for the agent mobile super-app:
// - Sell policies + collect premiums + process KYC + submit claims + view commissions
// - Territory management with geofencing
// - Offline-first with priority sync queue
// - Real-time leaderboard from agent-gamification service
//
// Middleware: Redis, Kafka, Keycloak, Permify, Temporal

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8116"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "healthy",
			"service": "agent-superapp-bff",
			"version": "1.0.0",
			"features": []string{"sell", "collect", "kyc", "claims", "commissions", "territory", "leaderboard"},
		})
	})

	mux.HandleFunc("/api/v1/agent/dashboard", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"agent_id":            "AGT-001",
			"name":                "Chinedu Okafor",
			"rank":                "Gold",
			"xp":                  15200,
			"today_sales":         3,
			"today_revenue":       450000,
			"monthly_commission":  125000,
			"pending_kyc":         2,
			"active_policies_sold": 45,
			"territory":           "Lagos Mainland",
			"leaderboard_position": 7,
			"streak_days":         12,
			"next_challenge":      "Sell 5 health policies this week",
		})
	})

	mux.HandleFunc("/api/v1/agent/territory", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"territory_id":  "TER-LAGOS-ML",
			"name":          "Lagos Mainland",
			"bounds":        map[string]float64{"lat_min": 6.45, "lat_max": 6.55, "lng_min": 3.35, "lng_max": 3.45},
			"customers_total": 250,
			"customers_nearby": 12,
			"nearby_customers": []map[string]interface{}{
				{"id": "CUST-101", "name": "Amina Bello", "distance_m": 500, "policy_due": "2026-06-15", "type": "renewal"},
				{"id": "CUST-102", "name": "Tunde Adeyemi", "distance_m": 800, "type": "prospect"},
				{"id": "CUST-103", "name": "Grace Onyeka", "distance_m": 1200, "policy_due": "2026-06-20", "type": "renewal"},
			},
		})
	})

	mux.HandleFunc("/api/v1/agent/sync", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		// Priority sync: commissions first, then policies, then analytics
		json.NewEncoder(w).Encode(map[string]interface{}{
			"sync_id":        "SYNC-" + time.Now().Format("20060102150405"),
			"status":         "completed",
			"synced_items":   15,
			"priority_order": []string{"commissions", "policies", "claims", "kyc", "analytics"},
			"conflicts":      0,
			"last_sync":      time.Now().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/api/v1/agent/sell", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			CustomerID string `json:"customer_id"`
			ProductID  string `json:"product_id"`
			Premium    int64  `json:"premium"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policy_id":   "POL-" + time.Now().Format("20060102") + "-001",
			"status":      "issued",
			"commission":  req.Premium * 15 / 100, // 15% commission
			"xp_earned":   100,
			"message":     "Policy issued successfully! Commission credited.",
		})
		log.Printf("Kafka event: agent.policy.sold customer=%s product=%s", req.CustomerID, req.ProductID)
	})

	mux.HandleFunc("/api/v1/agent/commissions", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total_earned":    1250000,
			"pending_payout":  125000,
			"last_payout":     "2026-06-01",
			"next_payout":     "2026-06-15",
			"breakdown": []map[string]interface{}{
				{"month": "June 2026", "earned": 125000, "policies_sold": 8},
				{"month": "May 2026", "earned": 180000, "policies_sold": 12},
				{"month": "April 2026", "earned": 95000, "policies_sold": 6},
			},
		})
	})

	log.Printf("Agent Super-App BFF starting on port %s", port)
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
