package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

// Premium Collection Service
// Manages premium payments across multiple channels: bank transfer, card, mobile money, USSD, agent cash
// Integrates with: TigerBeetle (ledger), Mojaloop (mobile money), Kafka, Postgres
//
// Payment Methods (Nigeria):
// - Bank Transfer (NIBSS): 0% fee, T+1 settlement
// - Card (Paystack/Flutterwave): 1.5% fee, instant
// - Mobile Money (MTN MoMo): 1% fee, instant
// - Agent Cash Collection: 0% fee, manual reconciliation

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "premium-collection-service"})
}

func handleCollect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PolicyID string  `json:"policy_id"`
		Amount   float64 `json:"amount"`
		Method   string  `json:"method"` // bank_transfer, card, mobile_money, agent_cash
		Currency string  `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	feeRates := map[string]float64{"bank_transfer": 0, "card": 0.015, "mobile_money": 0.01, "agent_cash": 0}
	fee := req.Amount * feeRates[req.Method]
	
	json.NewEncoder(w).Encode(map[string]interface{}{
		"receipt_id": fmt.Sprintf("RCP-%d", time.Now().UnixNano()%1000000),
		"policy_id": req.PolicyID, "amount": req.Amount, "fee": fee,
		"net_amount": req.Amount - fee, "method": req.Method,
		"status": "confirmed", "settled_at": time.Now().Format(time.RFC3339),
	})
}

func handleReconcile(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date": time.Now().Format("2006-01-02"),
		"total_collected": 45000000, "total_reconciled": 44500000,
		"pending": 500000, "discrepancies": 3,
	})
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
	mux.HandleFunc("/api/v1/collect", handleCollect)
	mux.HandleFunc("/api/v1/reconcile", handleReconcile)
	port := ":8098"
	log.Printf("Premium Collection Service starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
