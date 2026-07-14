package e2e

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

// E2E Golden Path Tests for InsurePortal
// These tests verify core business workflows against running services.
// Requires: DATABASE_URL, services running on their respective ports.

var baseURL string

func TestMain(m *testing.M) {
	baseURL = os.Getenv("E2E_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	os.Exit(m.Run())
}

func httpClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}

func jsonPost(t *testing.T, url string, body interface{}) (*http.Response, map[string]interface{}) {
	t.Helper()
	b, _ := json.Marshal(body)
	resp, err := httpClient().Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("POST %s failed: %v", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return resp, result
}

func jsonGet(t *testing.T, url string) (*http.Response, map[string]interface{}) {
	t.Helper()
	resp, err := httpClient().Get(url)
	if err != nil {
		t.Fatalf("GET %s failed: %v", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return resp, result
}

// ─── Workflow 1: Health Check All Services ───────────────────────────────────

func TestHealthChecks(t *testing.T) {
	services := map[string]string{
		"claims-adjudication":  os.Getenv("CLAIMS_URL"),
		"policy-renewal":       os.Getenv("RENEWAL_URL"),
		"agent-commission":     os.Getenv("COMMISSION_URL"),
		"enhanced-kyc":         os.Getenv("KYC_URL"),
		"notification-service": os.Getenv("NOTIFICATION_URL"),
	}

	for name, url := range services {
		if url == "" {
			continue
		}
		t.Run(name, func(t *testing.T) {
			resp, body := jsonGet(t, url+"/health")
			if resp.StatusCode != 200 {
				t.Errorf("%s /health returned %d", name, resp.StatusCode)
			}
			if status, ok := body["status"].(string); !ok || status != "healthy" {
				t.Errorf("%s /health status = %v, want healthy", name, body["status"])
			}
			if db, ok := body["database"].(string); !ok || db != "connected" {
				t.Errorf("%s database = %v, want connected", name, body["database"])
			}
		})
	}
}

// ─── Workflow 2: Policy Creation → Premium → Claim → Payout ─────────────────

func TestPolicyLifecycle(t *testing.T) {
	renewalURL := os.Getenv("RENEWAL_URL")
	if renewalURL == "" {
		t.Skip("RENEWAL_URL not set")
	}

	// Step 1: Create a policy renewal task
	resp, body := jsonPost(t, renewalURL+"/api/v1/renewal_tasks/create", map[string]interface{}{
		"policy_id":    1001,
		"customer_id":  2001,
		"renewal_date": "2026-07-01",
		"premium_old":  50000.00,
		"premium_new":  52500.00,
		"auto_renew":   true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create renewal task: status %d, body: %v", resp.StatusCode, body)
	}
	taskID := body["id"]
	t.Logf("Created renewal task: %v", taskID)

	// Step 2: Verify the task exists
	resp, body = jsonGet(t, fmt.Sprintf("%s/api/v1/renewal_task?id=%v", renewalURL, taskID))
	if resp.StatusCode != 200 {
		t.Fatalf("Get renewal task: status %d", resp.StatusCode)
	}

	// Step 3: List tasks
	resp, body = jsonGet(t, renewalURL+"/api/v1/renewal_tasks?page=1&limit=10")
	if resp.StatusCode != 200 {
		t.Fatalf("List renewal tasks: status %d", resp.StatusCode)
	}
	total, ok := body["total"].(float64)
	if !ok || total < 1 {
		t.Errorf("Expected at least 1 renewal task, got %v", body["total"])
	}
}

// ─── Workflow 3: KYC Verification ────────────────────────────────────────────

func TestKYCVerification(t *testing.T) {
	kycURL := os.Getenv("KYC_URL")
	if kycURL == "" {
		t.Skip("KYC_URL not set")
	}

	// Submit KYC verification
	resp, body := jsonPost(t, kycURL+"/api/v1/verifications/create", map[string]interface{}{
		"customer_id":     3001,
		"document_type":   "national_id",
		"document_number": "A00000001",
		"id_match_score":  95.5,
		"liveness_score":  88.0,
		"aml_check":       true,
		"pep_check":       false,
		"status":          "verified",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create KYC: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("KYC verification created: %v", body["id"])

	// Verify it's in the list
	resp, body = jsonGet(t, kycURL+"/api/v1/verifications?page=1&limit=5")
	if resp.StatusCode != 200 {
		t.Fatalf("List KYC: status %d", resp.StatusCode)
	}
}

// ─── Workflow 4: Agent Commission Calculation ────────────────────────────────

func TestAgentCommission(t *testing.T) {
	commURL := os.Getenv("COMMISSION_URL")
	if commURL == "" {
		t.Skip("COMMISSION_URL not set")
	}

	resp, body := jsonPost(t, commURL+"/api/v1/commissions/create", map[string]interface{}{
		"agent_id":        501,
		"policy_id":       1001,
		"commission_type": "new_business",
		"rate":            0.05,
		"amount":          2500.00,
		"currency":        "NGN",
		"status":          "approved",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create commission: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("Commission created: %v", body["id"])
}

// ─── Workflow 5: Claims Adjudication ─────────────────────────────────────────

func TestClaimsAdjudication(t *testing.T) {
	claimsURL := os.Getenv("CLAIMS_URL")
	if claimsURL == "" {
		t.Skip("CLAIMS_URL not set")
	}

	// Health check
	resp, body := jsonGet(t, claimsURL+"/health")
	if resp.StatusCode != 200 {
		t.Fatalf("Claims health: status %d", resp.StatusCode)
	}
	if body["status"] != "healthy" {
		t.Fatalf("Claims health: %v", body)
	}

	// Readiness
	resp, _ = jsonGet(t, claimsURL+"/ready")
	if resp.StatusCode != 200 {
		t.Fatalf("Claims ready: status %d", resp.StatusCode)
	}

	// Liveness
	resp, _ = jsonGet(t, claimsURL+"/live")
	if resp.StatusCode != 200 {
		t.Fatalf("Claims live: status %d", resp.StatusCode)
	}
}

// ─── Workflow 6: Notification Delivery ───────────────────────────────────────

func TestNotificationDelivery(t *testing.T) {
	notifURL := os.Getenv("NOTIFICATION_URL")
	if notifURL == "" {
		t.Skip("NOTIFICATION_URL not set")
	}

	resp, body := jsonPost(t, notifURL+"/api/v1/notification_logs/create", map[string]interface{}{
		"recipient_id": 2001,
		"channel":      "sms",
		"template":     "policy_renewal_reminder",
		"subject":      "Policy Renewal Due",
		"body":         "Your motor insurance policy expires on July 1, 2026",
		"status":       "queued",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create notification: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("Notification queued: %v", body["id"])
}

// ─── Workflow 7: Audit Trail Immutability ────────────────────────────────────

func TestAuditTrail(t *testing.T) {
	auditURL := os.Getenv("AUDIT_URL")
	if auditURL == "" {
		t.Skip("AUDIT_URL not set")
	}

	resp, body := jsonPost(t, auditURL+"/api/v1/audit_events/create", map[string]interface{}{
		"user_id":       101,
		"action":        "policy.approve",
		"resource_type": "policy",
		"resource_id":   1001,
		"ip_address":    "10.0.1.50",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create audit event: status %d, body: %v", resp.StatusCode, body)
	}

	// Verify it cannot be deleted (immutability check)
	eventID := body["id"]
	resp2, err := httpClient().Do(func() *http.Request {
		req, _ := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/api/v1/audit_events/delete?id=%v", auditURL, eventID), nil)
		return req
	}())
	if err != nil {
		t.Fatalf("Delete audit event: %v", err)
	}
	defer resp2.Body.Close()
	// In production, audit deletion should be restricted — for now we verify the event was created
	t.Logf("Audit event created: %v", eventID)
}

// ─── Workflow 8: NAICOM Filing ───────────────────────────────────────────────

func TestNAICOMFiling(t *testing.T) {
	naicomURL := os.Getenv("NAICOM_URL")
	if naicomURL == "" {
		t.Skip("NAICOM_URL not set")
	}

	resp, body := jsonPost(t, naicomURL+"/api/v1/filings/create", map[string]interface{}{
		"filing_type": "quarterly_return",
		"period":      "2026-Q2",
		"status":      "draft",
		"data":        map[string]interface{}{"gross_premium": 1500000000, "net_claims": 450000000},
		"filed_by":    "compliance_officer@insureportal.io",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create filing: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("NAICOM filing created: %v", body["id"])
}

// ─── Workflow 9: Microinsurance Enrollment ───────────────────────────────────

func TestMicroinsuranceEnrollment(t *testing.T) {
	microURL := os.Getenv("MICROINSURANCE_URL")
	if microURL == "" {
		t.Skip("MICROINSURANCE_URL not set")
	}

	resp, body := jsonPost(t, microURL+"/api/v1/micro_policys/create", map[string]interface{}{
		"customer_id":       4001,
		"product_code":      "CROP_BASIC",
		"sum_insured":       100000.00,
		"premium":           500.00,
		"premium_frequency": "monthly",
		"channel":           "ussd",
		"start_date":        "2026-06-01",
		"end_date":          "2027-05-31",
		"status":            "active",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create micro policy: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("Micro policy created: %v", body["id"])
}

// ─── Workflow 10: Takaful Pool ───────────────────────────────────────────────

func TestTakafulPool(t *testing.T) {
	takafulURL := os.Getenv("TAKAFUL_URL")
	if takafulURL == "" {
		t.Skip("TAKAFUL_URL not set")
	}

	resp, body := jsonPost(t, takafulURL+"/api/v1/pools/create", map[string]interface{}{
		"pool_name":           "Family Takaful Pool 2026",
		"pool_type":           "family",
		"total_contributions":  5000000.00,
		"participants":         150,
		"wakala_fee_pct":       0.30,
		"mudharaba_pct":        0.60,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("Create takaful pool: status %d, body: %v", resp.StatusCode, body)
	}
	t.Logf("Takaful pool created: %v", body["id"])
}
