package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"fmt"
)

// Etherisc GIF Integration — decentralized insurance protocol connector
// Business Rules:
// - Products: Parametric crop insurance, flight delay, weather index
// - Oracle: External data feeds trigger automatic payouts
// - Pool: Shared capital pool for risk diversification
// - Transparency: All policy data on-chain, verifiable by customers


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "etherisc-gif-integration"})
	})
	r.Get("/api/v1/products", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"products": []map[string]interface{}{
				{"name": "Crop Parametric (Corn)", "trigger": "rainfall < 60mm/month", "payout": "automatic", "pool_size": 50000000},
				{"name": "Flight Delay", "trigger": "delay > 120 minutes", "payout": "automatic", "pool_size": 20000000},
			},
		})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8099" }
	log.Printf("Etherisc GIF Integration starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
