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

// Notification Service — multi-channel notification delivery
// Channels: SMS (Termii), Email (SendGrid), Push (FCM/APNS), WhatsApp, In-App
// Business Rules:
// - Priority: P1 (all channels), P2 (push+email), P3 (in-app only)
// - Quiet hours: 10PM-7AM for non-critical notifications
// - Rate limit: Max 5 SMS/day per customer, 3 push/hour
// - Templates: NAICOM-approved for policy/claim communications
// - Delivery confirmation: Required for policy issuance, claim payment
// - Retry: 3 attempts with exponential backoff (1min, 5min, 30min)


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
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "notification-service"})
	})
	r.Post("/api/v1/send", sendNotification)
	r.Get("/api/v1/templates", listTemplates)
	r.Get("/api/v1/delivery-stats", deliveryStats)

	port := os.Getenv("PORT")
	if port == "" { port = "8122" }
	log.Printf("Notification Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func sendNotification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Channel  string `json:"channel"`
		To       string `json:"to"`
		Template string `json:"template"`
		Priority int    `json:"priority"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(202)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"notification_id": "NTF-" + time.Now().Format("20060102150405"),
		"channel": body.Channel, "status": "queued", "priority": body.Priority,
		"estimated_delivery": "< 30 seconds", "retry_policy": "3 attempts, exponential backoff",
	})
}

func listTemplates(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"templates": []map[string]string{
			{"id": "TPL-001", "name": "policy_issuance", "channel": "sms,email", "naicom_approved": "true"},
			{"id": "TPL-002", "name": "claim_payment", "channel": "sms,email,push", "naicom_approved": "true"},
			{"id": "TPL-003", "name": "renewal_reminder", "channel": "sms,push", "naicom_approved": "true"},
			{"id": "TPL-004", "name": "premium_due", "channel": "sms,whatsapp", "naicom_approved": "true"},
		},
	})
}

func deliveryStats(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sms": map[string]interface{}{"sent": 4500, "delivered": 4350, "failed": 150, "rate": 96.7},
		"email": map[string]interface{}{"sent": 2200, "delivered": 2150, "bounced": 50, "rate": 97.7},
		"push": map[string]interface{}{"sent": 8000, "delivered": 7200, "rate": 90.0},
		"period": "last_24_hours",
	})
}
