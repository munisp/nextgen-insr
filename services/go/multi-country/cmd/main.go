package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

// Multi-Country Expansion Framework — Pan-African Insurance
// Port: 8117
//
// Country configuration engine for regulatory rules, tax rates,
// product templates, currencies, and KYC flows per jurisdiction.
//
// Supported: Nigeria (NAICOM), Ghana (NIC), Kenya (IRA), South Africa (FSCA), Egypt (FRA)
// Middleware: PostgreSQL, Keycloak, Permify, APISIX, TigerBeetle, Kafka

type Country struct {
	Code       string   `json:"code"`
	Name       string   `json:"name"`
	Currency   string   `json:"currency"`
	CurrencySymbol string `json:"currency_symbol"`
	Regulator  string   `json:"regulator"`
	Languages  []string `json:"languages"`
	KYCFlow    string   `json:"kyc_flow"`
	TaxRate    float64  `json:"tax_rate"`
	DataResidency string `json:"data_residency_law"`
	TimeZone   string   `json:"timezone"`
	Status     string   `json:"status"`
}

var countries = []Country{
	{Code: "NG", Name: "Nigeria", Currency: "NGN", CurrencySymbol: "₦", Regulator: "NAICOM", Languages: []string{"en", "ha", "yo", "ig", "pcm"}, KYCFlow: "bvn_nin", TaxRate: 0.05, DataResidency: "NDPR", TimeZone: "Africa/Lagos", Status: "active"},
	{Code: "GH", Name: "Ghana", Currency: "GHS", CurrencySymbol: "GH₵", Regulator: "NIC", Languages: []string{"en", "ak", "ee"}, KYCFlow: "ghana_card", TaxRate: 0.06, DataResidency: "DPA-2012", TimeZone: "Africa/Accra", Status: "planned"},
	{Code: "KE", Name: "Kenya", Currency: "KES", CurrencySymbol: "KSh", Regulator: "IRA", Languages: []string{"en", "sw"}, KYCFlow: "huduma_namba", TaxRate: 0.04, DataResidency: "DPA-2019", TimeZone: "Africa/Nairobi", Status: "planned"},
	{Code: "ZA", Name: "South Africa", Currency: "ZAR", CurrencySymbol: "R", Regulator: "FSCA", Languages: []string{"en", "af", "zu", "xh"}, KYCFlow: "sa_id", TaxRate: 0.15, DataResidency: "POPIA", TimeZone: "Africa/Johannesburg", Status: "planned"},
	{Code: "EG", Name: "Egypt", Currency: "EGP", CurrencySymbol: "E£", Regulator: "FRA", Languages: []string{"ar", "en"}, KYCFlow: "national_id", TaxRate: 0.10, DataResidency: "DPL-2020", TimeZone: "Africa/Cairo", Status: "planned"},
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8117"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		active := 0
		for _, c := range countries {
			if c.Status == "active" {
				active++
			}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":           "healthy",
			"service":          "multi-country",
			"version":          "1.0.0",
			"countries_total":  len(countries),
			"countries_active": active,
		})
	})

	mux.HandleFunc("/api/v1/countries", func(w http.ResponseWriter, r *http.Request) {
		status := r.URL.Query().Get("status")
		filtered := make([]Country, 0)
		for _, c := range countries {
			if status != "" && c.Status != status {
				continue
			}
			filtered = append(filtered, c)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"countries": filtered,
			"total":     len(filtered),
		})
	})

	mux.HandleFunc("/api/v1/countries/config/", func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Path[len("/api/v1/countries/config/"):]
		for _, c := range countries {
			if c.Code == code {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"country":    c,
					"products":   getProductTemplates(c.Code),
					"compliance": getComplianceRules(c.Code),
				})
				return
			}
		}
		http.Error(w, `{"error":"country not found"}`, http.StatusNotFound)
	})

	mux.HandleFunc("/api/v1/countries/regulatory-map", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"regulatory_requirements": map[string]interface{}{
				"NG": map[string]interface{}{"min_capital": 3000000000, "solvency_ratio": 1.5, "reports": []string{"quarterly_returns", "annual_audit", "solvency_margin"}},
				"GH": map[string]interface{}{"min_capital": 15000000, "solvency_ratio": 1.5, "reports": []string{"quarterly_returns", "annual_audit"}},
				"KE": map[string]interface{}{"min_capital": 500000000, "solvency_ratio": 1.5, "reports": []string{"quarterly_returns", "annual_audit", "risk_report"}},
				"ZA": map[string]interface{}{"min_capital": 25000000, "solvency_ratio": 1.0, "reports": []string{"annual_audit", "solvency_assessment", "own_risk"}},
				"EG": map[string]interface{}{"min_capital": 60000000, "solvency_ratio": 1.5, "reports": []string{"quarterly_returns", "annual_audit"}},
			},
		})
	})

	log.Printf("Multi-Country Framework starting on port %s", port)
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func getProductTemplates(code string) []map[string]interface{} {
	base := []map[string]interface{}{
		{"id": "motor-tpo", "name": "Motor Third Party", "mandatory": true},
		{"id": "health-basic", "name": "Basic Health", "mandatory": false},
		{"id": "life-term", "name": "Term Life", "mandatory": false},
	}
	if code == "NG" {
		base = append(base, map[string]interface{}{"id": "agric-crop", "name": "Crop Insurance", "mandatory": false})
	}
	return base
}

func getComplianceRules(code string) map[string]interface{} {
	return map[string]interface{}{
		"kyc_required":      true,
		"aml_screening":     true,
		"data_residency":    true,
		"policy_wording":    "local_language_required",
		"cooling_off_days":  14,
	}
}
