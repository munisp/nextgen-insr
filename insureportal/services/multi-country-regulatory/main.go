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

// multi-country-regulatory — production microservice for InsurePortal platform
// Integrates with: Kafka, Redis, Postgres


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
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "healthy", "service": "multi-country-regulatory", "version": "1.0.0",
			"uptime": time.Since(startTime).String(),
		})
	})
	r.Get("/api/v1/info", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"service": "multi-country-regulatory", "started_at": startTime.Format(time.RFC3339),
			"uptime_seconds": int(time.Since(startTime).Seconds()),
			"ready": true, "dependencies": []string{"postgres", "redis", "kafka"},
		})
	})
	r.Get("/api/v1/status", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"operational": true, "last_heartbeat": time.Now().Format(time.RFC3339),
		})
	})
	port := os.Getenv("PORT")
	if port == "" { port = "8120" }
	log.Printf("multi-country-regulatory starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

var startTime = time.Now()
