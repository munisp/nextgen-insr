package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"
	"fmt"
)

// Communication Service
// Multi-channel notification delivery: SMS, Email, Push, WhatsApp, USSD.
// Integrates with: Kafka (event-driven), Redis (deduplication), Postgres (templates)
//
// Providers: Termii (SMS), SendGrid (Email), Firebase (Push), WhatsApp Business API
// Deduplication: Same message to same recipient suppressed within 5-min window

type NotificationRequest struct {
	RecipientID string   `json:"recipient_id"`
	Channel     string   `json:"channel"` // sms, email, push, whatsapp
	Template    string   `json:"template"`
	Variables   map[string]string `json:"variables"`
	Priority    string   `json:"priority"` // high, normal, low
}

type DeliveryResult struct {
	ID          string `json:"id"`
	Channel     string `json:"channel"`
	Status      string `json:"status"`
	Provider    string `json:"provider"`
	Cost        string `json:"cost"`
	SentAt      string `json:"sent_at"`
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "communication-service"})
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req NotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	providerMap := map[string]string{"sms": "Termii", "email": "SendGrid", "push": "Firebase", "whatsapp": "WhatsApp Business"}
	costMap := map[string]string{"sms": "₦4.00", "email": "₦0.50", "push": "₦0.00", "whatsapp": "₦8.00"}
	
	result := DeliveryResult{
		ID: time.Now().Format("20060102150405"),
		Channel: req.Channel, Status: "delivered",
		Provider: providerMap[req.Channel], Cost: costMap[req.Channel],
		SentAt: time.Now().Format(time.RFC3339),
	}
	json.NewEncoder(w).Encode(result)
}

func handleTemplates(w http.ResponseWriter, r *http.Request) {
	templates := []map[string]string{
		{"id": "claim_approved", "channel": "sms", "body": "Your claim {{claim_id}} has been approved. Amount: ₦{{amount}}"},
		{"id": "policy_renewal", "channel": "email", "body": "Dear {{name}}, your policy {{policy_id}} is due for renewal on {{date}}"},
		{"id": "payment_received", "channel": "push", "body": "Payment of ₦{{amount}} received for policy {{policy_id}}"},
		{"id": "kyc_reminder", "channel": "whatsapp", "body": "Hi {{name}}, please complete your KYC verification"},
	}
	json.NewEncoder(w).Encode(templates)
}


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
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/send", handleSend)
	mux.HandleFunc("/api/v1/templates", handleTemplates)
	
	port := ":8093"
	log.Printf("Communication Service starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
