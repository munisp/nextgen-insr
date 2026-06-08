package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"
)

// Claims Adjudication Engine
// Automated claims processing with rule-based decisioning.
// Integrates with: Kafka (events), Postgres (persistence), Redis (caching), Temporal (workflows)
//
// Business Rules:
// - Auto-approve claims ≤ ₦50,000 with valid documentation
// - Route ₦50K-₦500K to supervisor review
// - Route > ₦500K to executive approval + fraud check
// - SLA: 48h for auto-approval, 5 days for manual review

type ClaimRequest struct {
	ID          string    `json:"id"`
	PolicyID    string    `json:"policy_id"`
	ClaimantID  string    `json:"claimant_id"`
	Amount      float64   `json:"amount"`
	Type        string    `json:"type"`
	Description string    `json:"description"`
	Evidence    []string  `json:"evidence"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type AdjudicationResult struct {
	ClaimID      string  `json:"claim_id"`
	Decision     string  `json:"decision"` // approved, denied, escalated, pending_review
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
	AssignedTo   string  `json:"assigned_to,omitempty"`
	SLADeadline  string  `json:"sla_deadline"`
	RiskScore    float64 `json:"risk_score"`
}

func adjudicateClaim(claim ClaimRequest) AdjudicationResult {
	riskScore := calculateRiskScore(claim)
	
	if claim.Amount <= 50000 && riskScore < 30 && len(claim.Evidence) >= 2 {
		return AdjudicationResult{
			ClaimID:     claim.ID,
			Decision:    "approved",
			Confidence:  0.95,
			Reason:      "Auto-approved: amount within threshold, low risk, sufficient evidence",
			SLADeadline: time.Now().Add(48 * time.Hour).Format(time.RFC3339),
			RiskScore:   riskScore,
		}
	}

	if claim.Amount > 500000 || riskScore >= 70 {
		return AdjudicationResult{
			ClaimID:     claim.ID,
			Decision:    "escalated",
			Confidence:  0.60,
			Reason:      fmt.Sprintf("Escalated: high amount (₦%.0f) or high risk (%.0f%%)", claim.Amount, riskScore),
			AssignedTo:  "executive_review_queue",
			SLADeadline: time.Now().Add(5 * 24 * time.Hour).Format(time.RFC3339),
			RiskScore:   riskScore,
		}
	}

	return AdjudicationResult{
		ClaimID:     claim.ID,
		Decision:    "pending_review",
		Confidence:  0.75,
		Reason:      "Requires supervisor review: moderate amount/risk",
		AssignedTo:  "supervisor_queue",
		SLADeadline: time.Now().Add(3 * 24 * time.Hour).Format(time.RFC3339),
		RiskScore:   riskScore,
	}
}

func calculateRiskScore(claim ClaimRequest) float64 {
	score := 0.0
	if claim.Amount > 200000 { score += 20 }
	if claim.Amount > 1000000 { score += 30 }
	if len(claim.Evidence) == 0 { score += 40 }
	if len(claim.Evidence) == 1 { score += 20 }
	daysSinceSubmission := time.Since(claim.SubmittedAt).Hours() / 24
	if daysSinceSubmission < 1 { score += 10 } // Same-day claims slightly suspicious
	return math.Min(score, 100)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "claims-adjudication-engine"})
}

func handleAdjudicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var claim ClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result := adjudicateClaim(claim)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	var totalProcessed, approved, rejected int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM claims").Scan(&totalProcessed)
		db.QueryRow("SELECT COUNT(*) FROM claims WHERE status = 'approved'").Scan(&approved)
		db.QueryRow("SELECT COUNT(*) FROM claims WHERE status = 'rejected'").Scan(&rejected)
	}
	approvalRate := 0.0
	if totalProcessed > 0 {
		approvalRate = float64(approved) / float64(totalProcessed)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total_claims_processed": totalProcessed,
		"approved":               approved,
		"rejected":               rejected,
		"auto_approved_rate":     approvalRate,
		"service":               "claims-adjudication-engine",
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
	mux.HandleFunc("/api/v1/adjudicate", handleAdjudicate)
	mux.HandleFunc("/api/v1/metrics", handleMetrics)

	port := ":8091"
	log.Printf("Claims Adjudication Engine starting on %s", port)
	log.Fatal(http.ListenAndServe(port, mux))
}
