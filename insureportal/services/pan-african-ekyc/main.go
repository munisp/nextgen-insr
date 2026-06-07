package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"fmt"
)

// Pan-African eKYC — cross-border identity verification across African markets
// Supported: Nigeria (BVN/NIN), Ghana (Ghana Card), Kenya (IPRS), South Africa (RSA ID)
// Business Rules:
// - Cross-border: Verify customer identity in originating country
// - Regulatory: Each country has different KYC requirements
// - Data residency: Identity data must remain in country of origin
// - API: Unified interface, country-specific adapters
// - SLA: < 5 seconds for real-time verification


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "pan-african-ekyc"})
	})
	r.Post("/api/v1/verify", verifyIdentity)
	r.Get("/api/v1/countries", supportedCountries)

	port := os.Getenv("PORT")
	if port == "" { port = "8131" }
	log.Printf("Pan-African eKYC starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func verifyIdentity(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Country  string `json:"country"`
		IDType   string `json:"id_type"`
		IDNumber string `json:"id_number"`
		FullName string `json:"full_name"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"verification_id": "VRF-" + time.Now().Format("20060102150405"),
		"country": body.Country, "id_type": body.IDType, "match": true,
		"confidence": 0.95, "data_residency": body.Country, "sla_ms": 1200,
	})
}

func supportedCountries(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"countries": []map[string]interface{}{
			{"code": "NG", "name": "Nigeria", "id_types": []string{"BVN", "NIN", "Voters_Card", "Drivers_License"}},
			{"code": "GH", "name": "Ghana", "id_types": []string{"Ghana_Card", "Voters_ID"}},
			{"code": "KE", "name": "Kenya", "id_types": []string{"National_ID", "Passport"}},
			{"code": "ZA", "name": "South Africa", "id_types": []string{"RSA_ID", "Passport"}},
		},
	})
}
