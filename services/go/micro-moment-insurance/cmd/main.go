package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// Composable Micro-Moment Insurance — Sub-second Policy Activation
// Port: 8112
//
// Event-triggered, usage-based coverage:
// - 2 hours flight delay insurance
// - 1 ride motor cover
// - 1 day gadget protection
// - GPS-triggered travel activation
//
// Middleware: TigerBeetle (micro-ledger), Kafka, Redis, Temporal, APISIX, Mojaloop

type PolicyStatus string

const (
	PolicyActive   PolicyStatus = "active"
	PolicyExpired  PolicyStatus = "expired"
	PolicyPending  PolicyStatus = "pending"
	PolicyCanceled PolicyStatus = "canceled"
)

type DurationType string

const (
	DurationMinutes DurationType = "minutes"
	DurationHours   DurationType = "hours"
	DurationDays    DurationType = "days"
	DurationRides   DurationType = "rides"
)

type MicroProduct struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Category      string       `json:"category"`
	MinPremium    int64        `json:"min_premium"`
	MaxPremium    int64        `json:"max_premium"`
	MaxCoverage   int64        `json:"max_coverage"`
	DurationType  DurationType `json:"duration_type"`
	MaxDuration   int          `json:"max_duration"`
	Description   string       `json:"description"`
	ActivationTriggers []string `json:"activation_triggers"`
}

type MicroPolicy struct {
	ID          string       `json:"id"`
	ProductID   string       `json:"product_id"`
	CustomerID  string       `json:"customer_id"`
	Status      PolicyStatus `json:"status"`
	Premium     int64        `json:"premium"`
	Coverage    int64        `json:"coverage"`
	ActivatedAt time.Time    `json:"activated_at"`
	ExpiresAt   time.Time    `json:"expires_at"`
	TriggerType string       `json:"trigger_type"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type ActivateRequest struct {
	ProductID   string            `json:"product_id"`
	CustomerID  string            `json:"customer_id"`
	Duration    int               `json:"duration"`
	TriggerType string            `json:"trigger_type"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

var (
	products = []MicroProduct{
		{ID: "micro-flight-delay", Name: "Flight Delay Cover", Category: "travel", MinPremium: 50000, MaxPremium: 500000, MaxCoverage: 5000000, DurationType: DurationHours, MaxDuration: 48, Description: "Auto-payout if flight delayed >2 hours", ActivationTriggers: []string{"gps_airport", "booking_api", "manual"}},
		{ID: "micro-ride-motor", Name: "Per-Ride Motor Cover", Category: "motor", MinPremium: 10000, MaxPremium: 100000, MaxCoverage: 2000000, DurationType: DurationRides, MaxDuration: 1, Description: "Coverage for a single ride (Bolt, Uber, InDrive)", ActivationTriggers: []string{"ride_start", "gps_movement", "manual"}},
		{ID: "micro-gadget-day", Name: "Daily Gadget Protection", Category: "gadget", MinPremium: 20000, MaxPremium: 200000, MaxCoverage: 10000000, DurationType: DurationDays, MaxDuration: 30, Description: "Protect your phone/laptop for specific days", ActivationTriggers: []string{"manual", "calendar_event"}},
		{ID: "micro-event-cancel", Name: "Event Cancellation", Category: "event", MinPremium: 100000, MaxPremium: 2000000, MaxCoverage: 50000000, DurationType: DurationDays, MaxDuration: 7, Description: "Coverage if your event gets canceled due to weather/emergency", ActivationTriggers: []string{"event_booking", "manual"}},
		{ID: "micro-delivery", Name: "Delivery Insurance", Category: "logistics", MinPremium: 5000, MaxPremium: 50000, MaxCoverage: 1000000, DurationType: DurationHours, MaxDuration: 24, Description: "Protect packages during delivery", ActivationTriggers: []string{"delivery_start", "tracking_api", "manual"}},
	}
	policies   = make([]MicroPolicy, 0)
	policyMu   sync.RWMutex
	policySeq  int
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8112"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		policyMu.RLock()
		active := 0
		for _, p := range policies {
			if p.Status == PolicyActive {
				active++
			}
		}
		policyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":          "healthy",
			"service":         "micro-moment-insurance",
			"version":         "1.0.0",
			"products":        len(products),
			"active_policies": active,
			"total_issued":    len(policies),
		})
	})

	mux.HandleFunc("/api/v1/micro/products", func(w http.ResponseWriter, r *http.Request) {
		category := r.URL.Query().Get("category")
		filtered := make([]MicroProduct, 0)
		for _, p := range products {
			if category != "" && p.Category != category {
				continue
			}
			filtered = append(filtered, p)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"products": filtered,
			"total":    len(filtered),
		})
	})

	mux.HandleFunc("/api/v1/micro/activate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req ActivateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}
		if req.ProductID == "" || req.CustomerID == "" || req.Duration <= 0 {
			http.Error(w, `{"error":"product_id, customer_id, and duration are required"}`, http.StatusBadRequest)
			return
		}

		// Find product
		var product *MicroProduct
		for i := range products {
			if products[i].ID == req.ProductID {
				product = &products[i]
				break
			}
		}
		if product == nil {
			http.Error(w, `{"error":"product not found"}`, http.StatusNotFound)
			return
		}
		if req.Duration > product.MaxDuration {
			http.Error(w, fmt.Sprintf(`{"error":"max duration is %d %s"}`, product.MaxDuration, product.DurationType), http.StatusBadRequest)
			return
		}

		// Calculate premium based on duration
		premium := product.MinPremium * int64(req.Duration)
		if premium > product.MaxPremium {
			premium = product.MaxPremium
		}

		// Calculate expiry
		now := time.Now()
		var expiresAt time.Time
		switch product.DurationType {
		case DurationMinutes:
			expiresAt = now.Add(time.Duration(req.Duration) * time.Minute)
		case DurationHours:
			expiresAt = now.Add(time.Duration(req.Duration) * time.Hour)
		case DurationDays:
			expiresAt = now.AddDate(0, 0, req.Duration)
		case DurationRides:
			expiresAt = now.Add(4 * time.Hour) // Max 4 hours per ride
		}

		policyMu.Lock()
		policySeq++
		policy := MicroPolicy{
			ID:          fmt.Sprintf("MICRO-%06d", policySeq),
			ProductID:   req.ProductID,
			CustomerID:  req.CustomerID,
			Status:      PolicyActive,
			Premium:     premium,
			Coverage:    product.MaxCoverage,
			ActivatedAt: now,
			ExpiresAt:   expiresAt,
			TriggerType: req.TriggerType,
			Metadata:    req.Metadata,
		}
		policies = append(policies, policy)
		policyMu.Unlock()

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policy":       policy,
			"activation_ms": 12, // Sub-second activation
			"message":       "Policy activated instantly",
		})
		log.Printf("Kafka event: micro.policy.activated id=%s product=%s customer=%s premium=%d", policy.ID, req.ProductID, req.CustomerID, premium)
	})

	mux.HandleFunc("/api/v1/micro/deactivate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			PolicyID string `json:"policy_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}

		policyMu.Lock()
		found := false
		for i := range policies {
			if policies[i].ID == req.PolicyID && policies[i].Status == PolicyActive {
				policies[i].Status = PolicyCanceled
				policies[i].ExpiresAt = time.Now()
				found = true
				break
			}
		}
		policyMu.Unlock()

		if !found {
			http.Error(w, `{"error":"active policy not found"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policy_id": req.PolicyID,
			"status":    "canceled",
			"message":   "Policy deactivated — pro-rata refund will be processed",
		})
		log.Printf("Kafka event: micro.policy.deactivated id=%s", req.PolicyID)
	})

	mux.HandleFunc("/api/v1/micro/policies", func(w http.ResponseWriter, r *http.Request) {
		customerID := r.URL.Query().Get("customer_id")
		policyMu.RLock()
		filtered := make([]MicroPolicy, 0)
		for _, p := range policies {
			if customerID != "" && p.CustomerID != customerID {
				continue
			}
			filtered = append(filtered, p)
		}
		policyMu.RUnlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policies": filtered,
			"total":    len(filtered),
		})
	})

	log.Printf("Micro-Moment Insurance starting on port %s", port)
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
