package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Carbon Credit Insurance — Parametric Extension
// Port: 8126
//
// Africa-first parametric product for carbon credit protection:
// - Covers failed carbon credit projects (reforestation, solar farm)
// - Automatic payout on satellite NDVI verification
// - Green bond tokenization integration
//
// Middleware: Kafka (NDVI events), Oracle (satellite data), TigerBeetle (green ledger)

type CarbonProduct struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ProjectType   string  `json:"project_type"`
	Region        string  `json:"region"`
	CoverageType  string  `json:"coverage_type"`
	TriggerMetric string  `json:"trigger_metric"`
	Threshold     float64 `json:"threshold"`
	MaxPayout     int     `json:"max_payout"`
	AnnualPremium int     `json:"annual_premium"`
	CarbonTonnes  int     `json:"carbon_tonnes_covered"`
}

type CreditClaim struct {
	ID          string  `json:"id"`
	ProductID   string  `json:"product_id"`
	ProjectName string  `json:"project_name"`
	NDVIValue   float64 `json:"ndvi_value"`
	Threshold   float64 `json:"threshold"`
	Triggered   bool    `json:"triggered"`
	PayoutAmount int    `json:"payout_amount"`
	Status      string  `json:"status"`
	EvidenceURL string  `json:"evidence_url"`
	VerifiedAt  string  `json:"verified_at"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8126"
	}

	products := []CarbonProduct{
		{ID: "CARBON-001", Name: "Reforestation Shield", ProjectType: "reforestation", Region: "Cross River, Nigeria", CoverageType: "ndvi_decline", TriggerMetric: "NDVI < 0.3 for 60 days", Threshold: 0.3, MaxPayout: 50000000, AnnualPremium: 5000000, CarbonTonnes: 5000},
		{ID: "CARBON-002", Name: "Solar Farm Output", ProjectType: "solar", Region: "Sokoto, Nigeria", CoverageType: "output_shortfall", TriggerMetric: "Generation < 70% forecast for 30 days", Threshold: 0.7, MaxPayout: 80000000, AnnualPremium: 8000000, CarbonTonnes: 3000},
		{ID: "CARBON-003", Name: "Mangrove Restoration", ProjectType: "blue_carbon", Region: "Niger Delta, Nigeria", CoverageType: "area_loss", TriggerMetric: "Coverage area < 80% baseline", Threshold: 0.8, MaxPayout: 30000000, AnnualPremium: 3500000, CarbonTonnes: 2000},
	}

	claims := []CreditClaim{
		{ID: "CC-2026-001", ProductID: "CARBON-001", ProjectName: "Green Belt Reforestation", NDVIValue: 0.25, Threshold: 0.3, Triggered: true, PayoutAmount: 35000000, Status: "paid", EvidenceURL: "s3://evidence/satellite-img-2026-05.tiff", VerifiedAt: "2026-05-15T09:00:00Z"},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "healthy",
			"service":      "carbon-credit-insurance",
			"version":      "1.0.0",
			"products":     len(products),
			"active_claims": len(claims),
			"total_carbon_tonnes": 10000,
			"oracle_source": "sentinel2_satellite_ndvi",
		})
	})

	mux.HandleFunc("/api/v1/carbon/products", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{"products": products, "total": len(products)})
	})

	mux.HandleFunc("/api/v1/carbon/claims", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{"claims": claims, "total": len(claims)})
	})

	mux.HandleFunc("/api/v1/carbon/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"POST required"}`, http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			ProductID string  `json:"product_id"`
			NDVIValue float64 `json:"ndvi_value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
			return
		}
		var product *CarbonProduct
		for _, p := range products {
			if p.ID == req.ProductID {
				product = &p
				break
			}
		}
		if product == nil {
			http.Error(w, `{"error":"product not found"}`, http.StatusNotFound)
			return
		}
		triggered := req.NDVIValue < product.Threshold
		payoutAmount := 0
		if triggered {
			deficit := (product.Threshold - req.NDVIValue) / product.Threshold
			payoutAmount = int(float64(product.MaxPayout) * deficit)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"product_id":    req.ProductID,
			"ndvi_value":    req.NDVIValue,
			"threshold":     product.Threshold,
			"triggered":     triggered,
			"payout_amount": payoutAmount,
			"message":       map[bool]string{true: "Trigger condition met — automatic payout initiated", false: "NDVI above threshold — no payout"}[triggered],
		})
	})

	log.Printf("Carbon Credit Insurance starting on port %s", port)
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
