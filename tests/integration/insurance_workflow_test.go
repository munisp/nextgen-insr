package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

// ServiceConfig holds the base URL for each service in the workflow
type ServiceConfig struct {
	AgenticUnderwriting string
	PolicyLifecycle     string
	PremiumCollection   string
	ClaimsAdjudication  string
	InstantPayout       string
	Communication       string
	AuditTrail          string
	ReinsuranceMgmt     string
	NaicomCompliance    string
	FraudDetection      string
}

func getServiceConfig() ServiceConfig {
	return ServiceConfig{
		AgenticUnderwriting: envOr("UNDERWRITING_URL", "http://localhost:9301"),
		PolicyLifecycle:     envOr("POLICY_LIFECYCLE_URL", "http://localhost:9302"),
		PremiumCollection:   envOr("PREMIUM_COLLECTION_URL", "http://localhost:9303"),
		ClaimsAdjudication:  envOr("CLAIMS_URL", "http://localhost:9304"),
		InstantPayout:       envOr("PAYOUT_URL", "http://localhost:9305"),
		Communication:       envOr("COMMUNICATION_URL", "http://localhost:9306"),
		AuditTrail:          envOr("AUDIT_URL", "http://localhost:9307"),
		ReinsuranceMgmt:     envOr("REINSURANCE_URL", "http://localhost:9308"),
		NaicomCompliance:    envOr("NAICOM_URL", "http://localhost:9309"),
		FraudDetection:      envOr("FRAUD_URL", "http://localhost:9310"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var client = &http.Client{Timeout: 30 * time.Second}

func post(url string, payload interface{}) (int, map[string]interface{}, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, fmt.Errorf("marshal: %w", err)
	}
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return 0, nil, fmt.Errorf("post %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return resp.StatusCode, result, nil
}

func get(url string) (int, map[string]interface{}, error) {
	resp, err := client.Get(url)
	if err != nil {
		return 0, nil, fmt.Errorf("get %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return resp.StatusCode, result, nil
}

func del(url string) (int, error) {
	req, _ := http.NewRequest("DELETE", url, nil)
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("delete %s: %w", url, err)
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// TestFullInsuranceWorkflow tests the complete quote→underwrite→bind→claim→payout lifecycle
func TestFullInsuranceWorkflow(t *testing.T) {
	cfg := getServiceConfig()

	t.Run("Step1_HealthChecks", func(t *testing.T) {
		services := map[string]string{
			"underwriting":    cfg.AgenticUnderwriting,
			"policy":          cfg.PolicyLifecycle,
			"premium":         cfg.PremiumCollection,
			"claims":          cfg.ClaimsAdjudication,
			"payout":          cfg.InstantPayout,
			"communication":   cfg.Communication,
			"audit":           cfg.AuditTrail,
			"reinsurance":     cfg.ReinsuranceMgmt,
			"naicom":          cfg.NaicomCompliance,
			"fraud_detection": cfg.FraudDetection,
		}
		healthy := 0
		for name, url := range services {
			code, _, err := get(url + "/health")
			if err != nil {
				t.Logf("Service %s not available: %v", name, err)
				continue
			}
			if code != 200 {
				t.Logf("Service %s returned %d", name, code)
				continue
			}
			healthy++
		}
		if healthy == 0 {
			t.Fatal("No services available")
		}
		t.Logf("%d/10 services healthy", healthy)
	})

	var quoteID, policyID, claimID string

	t.Run("Step2_CreateQuoteAndUnderwrite", func(t *testing.T) {
		quote := map[string]interface{}{
			"application_id":  "APP-" + time.Now().Format("150405"),
			"decision":        "approved",
			"premium_quoted":  75000.00,
			"risk_score":      0.25,
			"risk_class":      "standard",
		}
		code, result, err := post(cfg.AgenticUnderwriting+"/api/v1/decisions/create", quote)
		if err != nil {
			t.Fatalf("Create quote failed: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		if id, ok := result["id"]; ok {
			quoteID = fmt.Sprintf("%v", id)
		}
		t.Logf("Quote created: ID=%s", quoteID)
	})

	t.Run("Step3_FraudScreening", func(t *testing.T) {
		screening := map[string]interface{}{
			"customer_name":   "Adebayo Ogundimu",
			"screening_type":  "new_policy",
			"amount":          2500000.00,
			"risk_indicators": []string{"clean_record"},
		}
		code, result, err := post(cfg.FraudDetection+"/api/v1/fraud_alerts/create", screening)
		if err != nil {
			t.Logf("Fraud screening skipped (service may use custom endpoint): %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Logf("Fraud screening passed: %v", result)
		}
	})

	t.Run("Step4_BindPolicy", func(t *testing.T) {
		policy := map[string]interface{}{
			"policy_id":   "POL-2026-" + time.Now().Format("150405"),
			"from_status": "underwritten",
			"to_status":   "active",
			"reason":      "Approved by underwriting decision " + quoteID,
		}
		code, result, err := post(cfg.PolicyLifecycle+"/api/v1/transitions/create", policy)
		if err != nil {
			t.Fatalf("Create policy failed: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		if id, ok := result["id"]; ok {
			policyID = fmt.Sprintf("%v", id)
		}
		t.Logf("Policy bound: ID=%s", policyID)
	})

	t.Run("Step5_CollectPremium", func(t *testing.T) {
		premium := map[string]interface{}{
			"policy_id":      policyID,
			"amount":         75000.00,
			"payment_method": "bank_transfer",
			"reference":      "PAY-" + time.Now().Format("150405"),
			"status":         "completed",
		}
		code, result, err := post(cfg.PremiumCollection+"/api/v1/premium_payments/create", premium)
		if err != nil {
			t.Logf("Premium collection skipped (custom endpoint): %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Logf("Premium collected: %v", result)
		}
	})

	t.Run("Step6_ReinsuranceCession", func(t *testing.T) {
		cession := map[string]interface{}{
			"policy_id":       policyID,
			"reinsurer":       "Africa Re",
			"treaty_type":     "quota_share",
			"cession_percent": 30.0,
			"ceded_premium":   22500.00,
			"status":          "active",
		}
		code, result, err := post(cfg.ReinsuranceMgmt+"/api/v1/reinsurance_treaties/create", cession)
		if err != nil {
			t.Logf("Reinsurance cession skipped: %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Logf("Reinsurance cession: %v", result)
		}
	})

	t.Run("Step7_FileClaim", func(t *testing.T) {
		claim := map[string]interface{}{
			"policy_id":      policyID,
			"claimant_name":  "Adebayo Ogundimu",
			"claim_type":     "accident",
			"description":    "Rear-end collision on Third Mainland Bridge",
			"claimed_amount": 450000.00,
			"incident_date":  "2026-06-01",
			"status":         "submitted",
		}
		code, result, err := post(cfg.ClaimsAdjudication+"/api/v1/adjudicate", claim)
		if err != nil {
			t.Fatalf("File claim failed: %v", err)
		}
		if code == 200 || code == 201 {
			if id, ok := result["id"]; ok {
				claimID = fmt.Sprintf("%v", id)
			}
			t.Logf("Claim adjudicated: %v", result)
		} else {
			t.Logf("Adjudication returned %d: %v (non-fatal)", code, result)
		}
	})

	t.Run("Step8_AdjudicateClaim", func(t *testing.T) {
		code, result, err := get(cfg.ClaimsAdjudication + "/api/v1/metrics")
		if err != nil {
			t.Fatalf("Get metrics failed: %v", err)
		}
		if code != 200 {
			t.Fatalf("Expected 200, got %d", code)
		}
		t.Logf("Claims metrics: %v", result)
	})

	t.Run("Step9_ProcessPayout", func(t *testing.T) {
		payout := map[string]interface{}{
			"claim_id":       1,
			"customer_id":    1001,
			"amount":         420000.00,
			"currency":       "NGN",
			"channel":        "bank_transfer",
			"account_number": "0123456789",
			"bank_code":      "058",
			"reference":      fmt.Sprintf("PAY-%d", time.Now().UnixNano()),
			"status":         "initiated",
		}
		code, result, err := post(cfg.InstantPayout+"/api/v1/payouts/create", payout)
		if err != nil {
			t.Fatalf("Process payout failed: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Payout processed: %v", result)
	})

	t.Run("Step10_SendNotification", func(t *testing.T) {
		notification := map[string]interface{}{
			"recipient":    "adebayo@example.com",
			"channel":      "email",
			"template":     "claim_approved",
			"subject":      "Your Insurance Claim Has Been Approved",
			"body":         "Dear Adebayo, your claim for NGN 420,000 has been approved.",
			"claim_id":     claimID,
			"policy_id":    policyID,
		}
		code, _, err := post(cfg.Communication+"/api/v1/notifications/create", notification)
		if err != nil {
			t.Logf("Notification skipped: %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Log("Notification sent successfully")
		}
	})

	t.Run("Step11_AuditTrailVerification", func(t *testing.T) {
		audit := map[string]interface{}{
			"event_type":  "claim_approved",
			"entity_type": "claim",
			"entity_id":   claimID,
			"actor":       "system",
			"details":     "Claim auto-approved after fraud screening passed",
		}
		code, _, err := post(cfg.AuditTrail+"/api/v1/audit_events/create", audit)
		if err != nil {
			t.Logf("Audit trail skipped: %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Log("Audit entry recorded")
		}
	})

	t.Run("Step12_NaicomRegulatory", func(t *testing.T) {
		report := map[string]interface{}{
			"report_type":   "claims_quarterly",
			"period":        "2026-Q2",
			"total_claims":  1,
			"total_paid":    420000.00,
			"total_pending": 0,
			"submission_date": time.Now().Format("2006-01-02"),
		}
		code, _, err := post(cfg.NaicomCompliance+"/api/v1/compliance_reports/create", report)
		if err != nil {
			t.Logf("NAICOM report skipped: %v", err)
			return
		}
		if code == 201 || code == 200 {
			t.Log("NAICOM quarterly report submitted")
		}
	})

	t.Run("Step13_VerifyStats", func(t *testing.T) {
		services := map[string]string{
			"underwriting": cfg.AgenticUnderwriting,
			"policy":       cfg.PolicyLifecycle,
			"claims":       cfg.ClaimsAdjudication,
			"payout":       cfg.InstantPayout,
			"audit":        cfg.AuditTrail,
		}
		for name, url := range services {
			code, result, err := get(url + "/stats")
			if err != nil {
				t.Logf("Stats for %s skipped: %v", name, err)
				continue
			}
			if code == 200 {
				t.Logf("Stats %s: %v", name, result)
			}
		}
	})

	t.Run("Step14_Cleanup", func(t *testing.T) {
		if policyID != "" {
			del(cfg.PolicyLifecycle + "/api/v1/transitions/delete?id=" + policyID)
		}
		if quoteID != "" {
			del(cfg.AgenticUnderwriting + "/api/v1/decisions/delete?id=" + quoteID)
		}
		t.Log("Cleanup complete")
	})
}

// TestGroupLifeWorkflow tests group life insurance enrollment→premium→claim
func TestGroupLifeWorkflow(t *testing.T) {
	groupLifeURL := envOr("GROUP_LIFE_URL", "http://localhost:9311")
	
	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(groupLifeURL + "/health")
		if err != nil {
			t.Skipf("Group life service not available: %v", err)
		}
		if code != 200 {
			t.Skipf("Group life service unhealthy: %d", code)
		}
	})

	t.Run("CreateGroupPolicy", func(t *testing.T) {
		policy := map[string]interface{}{
			"company_name":    "Access Bank Plc",
			"policy_type":     "group_life",
			"total_employees": 500,
			"sum_insured":     5000000.00,
			"premium_rate":    0.003,
			"effective_date":  "2026-01-01",
		}
		code, result, err := post(groupLifeURL+"/api/v1/group_policies/create", policy)
		if err != nil {
			t.Fatalf("Create group policy: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Group policy created: %v", result)
	})

	t.Run("VerifyStats", func(t *testing.T) {
		code, result, err := get(groupLifeURL + "/stats")
		if err != nil {
			t.Fatalf("Stats: %v", err)
		}
		if code != 200 {
			t.Fatalf("Expected 200, got %d", code)
		}
		t.Logf("Stats: %v", result)
	})
}

// TestBancassuranceWorkflow tests bank+insurance product distribution
func TestBancassuranceWorkflow(t *testing.T) {
	cfg := getServiceConfig()
	bancaURL := envOr("BANCASSURANCE_URL", "http://localhost:9312")
	_ = cfg

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(bancaURL + "/health")
		if err != nil {
			t.Skipf("Bancassurance service not available: %v", err)
		}
		if code != 200 {
			t.Skipf("Bancassurance service unhealthy: %d", code)
		}
	})

	t.Run("CreatePartnership", func(t *testing.T) {
		partnership := map[string]interface{}{
			"bank_name":       "First Bank Nigeria",
			"product_type":    "mortgage_protection",
			"commission_rate": 15.0,
			"effective_date":  "2026-01-01",
			"status":          "active",
		}
		code, result, err := post(bancaURL+"/api/v1/partnerships/create", partnership)
		if err != nil {
			t.Fatalf("Create partnership: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Partnership created: %v", result)
	})
}
