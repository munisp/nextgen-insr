// embedded-insurance/cmd/main.go
// White-label embedded insurance API for third-party distribution partners.
// Allows e-commerce, ride-hailing, airlines, and banks to embed insurance
// into their checkout flows via a simple REST API.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

type EmbeddedProduct struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Premium     float64 `json:"premium"`
	Cover       float64 `json:"cover"`
	Currency    string  `json:"currency"`
	Duration    string  `json:"duration"`
	Category    string  `json:"category"`
}

type EmbeddedQuoteRequest struct {
	Context     string                 `json:"context"` // "checkout","ride","flight","purchase"
	PartnerCode string                 `json:"partner_code"`
	Amount      float64                `json:"amount"`
	Currency    string                 `json:"currency"`
	CustomerRef string                 `json:"customer_ref"`
	Metadata    map[string]interface{} `json:"metadata"`
}

type EmbeddedBindRequest struct {
	ProductID   string                 `json:"product_id"`
	PartnerCode string                 `json:"partner_code"`
	CustomerRef string                 `json:"customer_ref"`
	PaymentRef  string                 `json:"payment_ref"`
	StartDate   string                 `json:"start_date"`
	EndDate     string                 `json:"end_date"`
	Metadata    map[string]interface{} `json:"metadata"`
}

type EmbeddedPolicy struct {
	PolicyNumber string    `json:"policy_number"`
	ProductName  string    `json:"product_name"`
	Premium      float64   `json:"premium"`
	Cover        float64   `json:"cover"`
	StartDate    string    `json:"start_date"`
	EndDate      string    `json:"end_date"`
	CertURL      string    `json:"certificate_url"`
	IssuedAt     time.Time `json:"issued_at"`
}

var db *sql.DB

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/insureportal?sslmode=disable"
	}

	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer db.Close()

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "embedded-insurance"})
	})

	// Get products for a given context
	mux.HandleFunc("/api/v1/products", withAuth(getProductsForContext))

	// Get a quote for embedding
	mux.HandleFunc("/api/v1/quote", withAuth(getEmbeddedQuote))

	// Bind a policy (instant issuance)
	mux.HandleFunc("/api/v1/bind", withAuth(bindEmbeddedPolicy))

	// Get certificate
	mux.HandleFunc("/api/v1/certificate/", withAuth(getCertificate))

	// Webhook for partner events
	mux.HandleFunc("/api/v1/webhook", handleWebhook)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8110"
	}
	log.Printf("Embedded Insurance API listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// withAuth validates the partner API key
func withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		apiKey := r.Header.Get("X-API-Key")
		if apiKey == "" {
			apiKey = r.URL.Query().Get("api_key")
		}
		if apiKey == "" {
			http.Error(w, `{"error":"missing API key"}`, http.StatusUnauthorized)
			return
		}

		// Validate API key against bancassurance_partners table
		var partnerID int
		var partnerCode string
		err := db.QueryRowContext(r.Context(),
			`SELECT id, partner_code FROM bancassurance_partners 
			 WHERE api_key_hash = encode(digest($1, 'sha256'), 'hex') AND status = 'active'`,
			apiKey,
		).Scan(&partnerID, &partnerCode)
		if err != nil {
			http.Error(w, `{"error":"invalid API key"}`, http.StatusUnauthorized)
			return
		}

		// Add partner context to request
		ctx := context.WithValue(r.Context(), "partner_id", partnerID)
		ctx = context.WithValue(ctx, "partner_code", partnerCode)
		next(w, r.WithContext(ctx))
	}
}

// getProductsForContext returns relevant insurance products for a given purchase context
func getProductsForContext(w http.ResponseWriter, r *http.Request) {
	context := r.URL.Query().Get("context")
	amount := r.URL.Query().Get("amount")

	products := getProductsForContextType(context, amount)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"products": products,
		"context":  context,
	})
}

func getProductsForContextType(ctx, amount string) []EmbeddedProduct {
	switch ctx {
	case "checkout", "ecommerce":
		return []EmbeddedProduct{
			{ID: "EMB-PURCHASE-PROTECT", Name: "Purchase Protection", Description: "Covers damage, theft, or loss of your purchase", Premium: 500, Cover: 50000, Currency: "NGN", Duration: "30 days", Category: "property"},
			{ID: "EMB-EXTENDED-WARRANTY", Name: "Extended Warranty", Description: "12-month warranty extension for electronics", Premium: 2000, Cover: 200000, Currency: "NGN", Duration: "12 months", Category: "property"},
		}
	case "ride", "ridesharing":
		return []EmbeddedProduct{
			{ID: "EMB-RIDE-PA", Name: "Ride Personal Accident", Description: "Covers accidents during your ride", Premium: 100, Cover: 500000, Currency: "NGN", Duration: "per ride", Category: "personal_accident"},
		}
	case "flight", "travel":
		return []EmbeddedProduct{
			{ID: "EMB-TRAVEL-BASIC", Name: "Travel Basic", Description: "Flight delay, baggage loss, medical emergency", Premium: 3000, Cover: 2000000, Currency: "NGN", Duration: "trip", Category: "travel"},
			{ID: "EMB-TRAVEL-COMPREHENSIVE", Name: "Travel Comprehensive", Description: "Full travel protection including cancellation", Premium: 8000, Cover: 5000000, Currency: "NGN", Duration: "trip", Category: "travel"},
		}
	case "loan", "credit":
		return []EmbeddedProduct{
			{ID: "EMB-CREDIT-LIFE", Name: "Credit Life", Description: "Loan balance paid if borrower dies or is disabled", Premium: 500, Cover: 0, Currency: "NGN", Duration: "loan term", Category: "life"},
		}
	default:
		return []EmbeddedProduct{
			{ID: "EMB-MICRO-PA", Name: "Micro Personal Accident", Description: "Daily cash benefit for accidents", Premium: 200, Cover: 100000, Currency: "NGN", Duration: "30 days", Category: "personal_accident"},
		}
	}
}

// getEmbeddedQuote returns a premium quote for an embedded product
func getEmbeddedQuote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req EmbeddedQuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	products := getProductsForContextType(req.Context, fmt.Sprintf("%.0f", req.Amount))
	quoteRef := "QT-" + uuid.New().String()[:8]

	json.NewEncoder(w).Encode(map[string]interface{}{
		"quote_ref":  quoteRef,
		"products":   products,
		"expires_at": time.Now().Add(24 * time.Hour).Format(time.RFC3339),
		"currency":   "NGN",
	})
}

// bindEmbeddedPolicy issues an instant policy
func bindEmbeddedPolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req EmbeddedBindRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	partnerID := r.Context().Value("partner_id").(int)

	// Resolve the product across all contexts; never invent a product.
	var product *EmbeddedProduct
	for _, ctx := range []string{"checkout", "ride", "flight", "loan", ""} {
		for _, p := range getProductsForContextType(ctx, "") {
			if p.ID == req.ProductID {
				cp := p
				product = &cp
				break
			}
		}
		if product != nil {
			break
		}
	}
	if product == nil {
		http.Error(w, `{"error":"unknown product_id"}`, http.StatusBadRequest)
		return
	}

	policyNumber := fmt.Sprintf("EMB-%s-%d-%s", req.PartnerCode, partnerID, uuid.New().String()[:8])

	// Record the embedded policy in PostgreSQL — fail CLOSED: if the record
	// cannot be persisted, no policy is claimed to exist.
	_, err := db.ExecContext(r.Context(), `
		INSERT INTO bancassurance_referrals (partner_id, referral_code, product_type, premium_amount, status, converted_at)
		VALUES ($1, $2, $3, $4, 'bound', NOW())
	`, partnerID, policyNumber, req.ProductID, product.Premium)
	if err != nil {
		log.Printf("Failed to record embedded policy: %v", err)
		http.Error(w, `{"error":"policy binding failed: could not persist policy record"}`, http.StatusServiceUnavailable)
		return
	}

	certURL := fmt.Sprintf("%s/api/v1/certificate/%s",
		os.Getenv("EMBEDDED_API_BASE_URL"),
		policyNumber,
	)

	policy := EmbeddedPolicy{
		PolicyNumber: policyNumber,
		ProductName:  product.Name,
		Premium:      product.Premium,
		Cover:        product.Cover,
		StartDate:    req.StartDate,
		EndDate:      req.EndDate,
		CertURL:      certURL,
		IssuedAt:     time.Now(),
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"policy":  policy,
	})
}

// getCertificate returns a policy certificate
func getCertificate(w http.ResponseWriter, r *http.Request) {
	policyNumber := r.URL.Path[len("/api/v1/certificate/"):]
	if policyNumber == "" {
		http.Error(w, `{"error":"policy number required"}`, http.StatusBadRequest)
		return
	}

	// Real lookup: a certificate is only "valid" when a real bound policy
	// record exists for this policy number.
	var status, productType string
	var premium sql.NullFloat64
	var issuedAt sql.NullTime
	err := db.QueryRowContext(r.Context(), `
		SELECT status, product_type, premium_amount, converted_at
		FROM bancassurance_referrals WHERE referral_code = $1
	`, policyNumber).Scan(&status, &productType, &premium, &issuedAt)
	if err == sql.ErrNoRows {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"policy_number": policyNumber,
			"valid":         false,
			"reason":        "policy not found",
		})
		return
	}
	if err != nil {
		log.Printf("Certificate lookup failed: %v", err)
		http.Error(w, `{"error":"certificate lookup unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	cert := map[string]interface{}{
		"policy_number": policyNumber,
		"issued_by":     "InsurePortal Embedded Insurance",
		"product_type":  productType,
		"status":        status,
		"valid":         status == "bound",
	}
	if premium.Valid {
		cert["premium_amount"] = premium.Float64
	}
	if issuedAt.Valid {
		cert["issued_at"] = issuedAt.Time.Format(time.RFC3339)
	}
	json.NewEncoder(w).Encode(cert)
}

// handleWebhook processes partner webhook events
func handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var event map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	log.Printf("Webhook received: %v", event["type"])
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "received"})
}
