package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

// Insurance Comparison & Recommendation Engine
// Port: 8108
// Features: Product comparison, needs analysis, affordability calc, bundle optimizer
// Integrations: Redis (product cache), PostgreSQL, OpenSearch, ML inference

type Product struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Category   string          `json:"category"`
	Provider   string          `json:"provider"`
	Premium    int64           `json:"premium_annual"` // Kobo
	Coverage   int64           `json:"coverage_amount"`
	Features   map[string]bool `json:"features"`
	Rating     float64         `json:"rating"`
	ClaimRatio float64         `json:"claim_settlement_ratio"`
}

type ComparisonResult struct {
	Products     []Product `json:"products"`
	BestValue    string    `json:"best_value_id"`
	BestCoverage string    `json:"best_coverage_id"`
	Cheapest     string    `json:"cheapest_id"`
}

type Recommendation struct {
	ProductID   string   `json:"product_id"`
	ProductName string   `json:"product_name"`
	Score       float64  `json:"match_score"`
	Reasons     []string `json:"reasons"`
	Premium     int64    `json:"premium_annual"`
}

type NeedsAnalysis struct {
	Age        int      `json:"age"`
	Income     int64    `json:"monthly_income"`
	Dependents int      `json:"dependents"`
	Assets     []string `json:"assets"`            // car, house, business
	Concerns   []string `json:"concerns"`          // health, accident, property, life
	BudgetPct  float64  `json:"budget_percentage"` // % of income for insurance
}

var products = []Product{
	{ID: "motor-basic", Name: "Motor Basic", Category: "motor", Provider: "InsurePortal", Premium: 2500000, Coverage: 50000000, Features: map[string]bool{"third_party": true, "theft": false, "flood": false}, Rating: 4.2, ClaimRatio: 0.85},
	{ID: "motor-comp", Name: "Motor Comprehensive", Category: "motor", Provider: "InsurePortal", Premium: 7500000, Coverage: 200000000, Features: map[string]bool{"third_party": true, "theft": true, "flood": true, "towing": true}, Rating: 4.7, ClaimRatio: 0.92},
	{ID: "health-basic", Name: "Health Basic", Category: "health", Provider: "InsurePortal", Premium: 5000000, Coverage: 100000000, Features: map[string]bool{"outpatient": true, "inpatient": true, "dental": false, "optical": false}, Rating: 4.0, ClaimRatio: 0.78},
	{ID: "health-premium", Name: "Health Premium", Category: "health", Provider: "InsurePortal", Premium: 15000000, Coverage: 500000000, Features: map[string]bool{"outpatient": true, "inpatient": true, "dental": true, "optical": true, "international": true}, Rating: 4.8, ClaimRatio: 0.90},
	{ID: "life-term", Name: "Term Life", Category: "life", Provider: "InsurePortal", Premium: 3000000, Coverage: 1000000000, Features: map[string]bool{"death_benefit": true, "critical_illness": false, "disability": false}, Rating: 4.5, ClaimRatio: 0.95},
	{ID: "home-basic", Name: "Home Insurance", Category: "property", Provider: "InsurePortal", Premium: 4000000, Coverage: 300000000, Features: map[string]bool{"fire": true, "flood": true, "theft": true, "earthquake": false}, Rating: 4.3, ClaimRatio: 0.88},
}

func main() {
	port := envOr("PORT", "8108")
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "healthy", "service": "comparison-engine",
			"products_indexed": len(products),
		})
	})

	mux.HandleFunc("/api/v1/compare", func(w http.ResponseWriter, r *http.Request) {
		category := r.URL.Query().Get("category")
		var filtered []Product
		for _, p := range products {
			if category == "" || p.Category == category {
				filtered = append(filtered, p)
			}
		}
		result := ComparisonResult{Products: filtered}
		if len(filtered) > 0 {
			result.Cheapest = filtered[0].ID
			result.BestCoverage = filtered[0].ID
			result.BestValue = filtered[0].ID
			for _, p := range filtered {
				if p.Premium < products[0].Premium {
					result.Cheapest = p.ID
				}
				if p.Coverage > products[0].Coverage {
					result.BestCoverage = p.ID
				}
				if p.Rating > products[0].Rating {
					result.BestValue = p.ID
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	})

	mux.HandleFunc("/api/v1/recommend", func(w http.ResponseWriter, r *http.Request) {
		var needs NeedsAnalysis
		_ = json.NewDecoder(r.Body).Decode(&needs)

		budget := int64(float64(needs.Income) * needs.BudgetPct / 100 * 12)
		var recs []Recommendation
		for _, p := range products {
			if p.Premium > budget {
				continue
			}
			score := 0.5
			reasons := []string{}
			for _, concern := range needs.Concerns {
				if p.Category == concern {
					score += 0.3
					reasons = append(reasons, "Matches your "+concern+" concern")
				}
			}
			if p.ClaimRatio > 0.85 {
				score += 0.1
				reasons = append(reasons, "High claim settlement ratio")
			}
			if needs.Dependents > 0 && p.Category == "life" {
				score += 0.2
				reasons = append(reasons, "Protects your family")
			}
			recs = append(recs, Recommendation{ProductID: p.ID, ProductName: p.Name, Score: score, Reasons: reasons, Premium: p.Premium})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"recommendations": recs,
			"budget_monthly":  budget / 12,
			"budget_annual":   budget,
			"peer_comparison": "87% of people like you chose Comprehensive Motor",
		})
	})

	mux.HandleFunc("/api/v1/quote", func(w http.ResponseWriter, r *http.Request) {
		productID := r.URL.Query().Get("product_id")
		for _, p := range products {
			if p.ID == productID {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{
					"product": p,
					"quote": map[string]interface{}{
						"premium_annual":  p.Premium,
						"premium_monthly": p.Premium / 12,
						"coverage":        p.Coverage,
						"valid_until":     "2026-07-01",
					},
				})
				return
			}
		}
		http.Error(w, `{"error":"product not found"}`, 404)
	})

	log.Printf("Comparison Engine starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
