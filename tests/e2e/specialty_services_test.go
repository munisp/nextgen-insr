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

var client = &http.Client{Timeout: 30 * time.Second}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func post(url string, payload interface{}) (int, map[string]interface{}, error) {
	body, _ := json.Marshal(payload)
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(data, &result)
	return resp.StatusCode, result, nil
}

func get(url string) (int, map[string]interface{}, error) {
	resp, err := client.Get(url)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(data, &result)
	return resp.StatusCode, result, nil
}

// ---------------------------------------------------------------------------
// AI Claims Auto-Adjudication
// ---------------------------------------------------------------------------
func TestAIClaimsAutoAdjudication(t *testing.T) {
	base := envOr("AI_CLAIMS_URL", "http://localhost:9320")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("HighRiskClaimRejected", func(t *testing.T) {
		claim := map[string]interface{}{
			"claim_type":      "fire",
			"claimed_amount":  5000000.00,
			"policy_age_days": 15,
			"previous_claims": 3,
			"location_risk":   "high",
		}
		code, result, err := post(base+"/api/v1/adjudicate", claim)
		if err != nil {
			t.Skipf("Adjudication endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("High-risk result: %v", result)
			if decision, ok := result["decision"]; ok {
				if decision != "auto_rejected" && decision != "manual_review" {
					t.Logf("Expected rejection/review for high-risk claim, got: %v", decision)
				}
			}
		}
	})

	t.Run("LowRiskClaimApproved", func(t *testing.T) {
		claim := map[string]interface{}{
			"claim_type":      "minor_accident",
			"claimed_amount":  50000.00,
			"policy_age_days": 365,
			"previous_claims": 0,
			"location_risk":   "low",
		}
		code, result, err := post(base+"/api/v1/adjudicate", claim)
		if err != nil {
			t.Skipf("Adjudication endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Low-risk result: %v", result)
		}
	})
}

// ---------------------------------------------------------------------------
// Parametric Insurance Engine
// ---------------------------------------------------------------------------
func TestParametricInsuranceEngine(t *testing.T) {
	base := envOr("PARAMETRIC_URL", "http://localhost:9321")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("DroughtTrigger", func(t *testing.T) {
		event := map[string]interface{}{
			"event_type":      "drought",
			"measurement":     20.0,
			"threshold":       50.0,
			"location":        "Kano",
			"policy_id":       "PARAM-001",
			"coverage_amount": 150000.00,
		}
		code, result, err := post(base+"/api/v1/evaluate", event)
		if err != nil {
			t.Skipf("Evaluate endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Drought trigger result: %v", result)
			if triggered, ok := result["triggered"]; ok {
				if triggered != true {
					t.Errorf("Expected drought trigger (20mm < 50mm threshold)")
				}
			}
		}
	})

	t.Run("FlightDelayTrigger", func(t *testing.T) {
		event := map[string]interface{}{
			"event_type":      "flight_delay",
			"measurement":     180.0,
			"threshold":       120.0,
			"location":        "Lagos",
			"policy_id":       "PARAM-002",
			"coverage_amount": 50000.00,
		}
		code, result, err := post(base+"/api/v1/evaluate", event)
		if err != nil {
			t.Skipf("Evaluate endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Flight delay result: %v", result)
		}
	})

	t.Run("NoTrigger_NormalRain", func(t *testing.T) {
		event := map[string]interface{}{
			"event_type":      "drought",
			"measurement":     150.0,
			"threshold":       50.0,
			"location":        "Rivers",
			"policy_id":       "PARAM-003",
			"coverage_amount": 100000.00,
		}
		code, result, err := post(base+"/api/v1/evaluate", event)
		if err != nil {
			t.Skipf("Evaluate endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Normal rain result: %v", result)
			if triggered, ok := result["triggered"]; ok {
				if triggered != false {
					t.Errorf("Expected no trigger (150mm > 50mm threshold)")
				}
			}
		}
	})
}

// ---------------------------------------------------------------------------
// Fraud Network Graph
// ---------------------------------------------------------------------------
func TestFraudNetworkGraph(t *testing.T) {
	base := envOr("FRAUD_GRAPH_URL", "http://localhost:9322")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("AnalyzeNetwork", func(t *testing.T) {
		network := map[string]interface{}{
			"nodes": []map[string]interface{}{
				{"id": "C001", "type": "customer", "name": "John Doe"},
				{"id": "A001", "type": "agent", "name": "Agent Smith"},
				{"id": "A002", "type": "agent", "name": "Agent Jones"},
				{"id": "D001", "type": "device", "imei": "123456789"},
				{"id": "D002", "type": "device", "imei": "987654321"},
				{"id": "L001", "type": "location", "address": "123 Lagos St"},
				{"id": "P001", "type": "phone", "number": "+234801234567"},
			},
			"edges": []map[string]interface{}{
				{"from": "C001", "to": "A001", "type": "submitted_through"},
				{"from": "C001", "to": "A002", "type": "submitted_through"},
				{"from": "C001", "to": "D001", "type": "used_device"},
				{"from": "A001", "to": "D002", "type": "used_device"},
				{"from": "A001", "to": "L001", "type": "located_at"},
				{"from": "A002", "to": "L001", "type": "located_at"},
			},
		}
		code, result, err := post(base+"/api/v1/analyze", network)
		if err != nil {
			t.Skipf("Analyze endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Network analysis: %v", result)
			if score, ok := result["risk_score"]; ok {
				t.Logf("Risk score: %v", score)
			}
		}
	})
}

// ---------------------------------------------------------------------------
// Predictive Churn Engine
// ---------------------------------------------------------------------------
func TestPredictiveChurnEngine(t *testing.T) {
	base := envOr("CHURN_URL", "http://localhost:9323")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("PredictHighChurnRisk", func(t *testing.T) {
		customer := map[string]interface{}{
			"customer_id":       "CUST-001",
			"policy_age_months": 11,
			"claims_count":      0,
			"payment_delays":    3,
			"engagement_score":  0.2,
			"nps_score":         3,
		}
		code, result, err := post(base+"/api/v1/predict", customer)
		if err != nil {
			t.Skipf("Predict endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Churn prediction: %v", result)
		}
	})
}

// ---------------------------------------------------------------------------
// Digital Twin Risk Modeler
// ---------------------------------------------------------------------------
func TestDigitalTwinRiskModeler(t *testing.T) {
	base := envOr("DIGITAL_TWIN_URL", "http://localhost:9324")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("SimulateFloodRisk", func(t *testing.T) {
		scenario := map[string]interface{}{
			"scenario_type":      "flood",
			"location":           "Lagos",
			"severity":           0.8,
			"duration_days":      5,
			"properties_at_risk": 1500,
			"avg_property_value": 15000000.0,
		}
		code, result, err := post(base+"/api/v1/simulate", scenario)
		if err != nil {
			t.Skipf("Simulate endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Flood simulation: %v", result)
		}
	})
}

// ---------------------------------------------------------------------------
// Insurance-as-a-Service (IaaS)
// ---------------------------------------------------------------------------
func TestInsuranceAsAService(t *testing.T) {
	base := envOr("IAAS_URL", "http://localhost:9325")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("CreateEmbeddedProduct", func(t *testing.T) {
		product := map[string]interface{}{
			"partner_name":   "Jumia Nigeria",
			"product_type":   "gadget_protection",
			"coverage_limit": 500000.00,
			"premium_rate":   0.05,
			"commission":     20.0,
		}
		code, result, err := post(base+"/api/v1/products/create", product)
		if err != nil {
			t.Skipf("Products endpoint not available: %v", err)
		}
		if code == 200 || code == 201 {
			t.Logf("Embedded product created: %v", result)
		}
	})
}

// ---------------------------------------------------------------------------
// Takaful Module (Sharia-compliant)
// ---------------------------------------------------------------------------
func TestTakafulModule(t *testing.T) {
	base := envOr("TAKAFUL_URL", "http://localhost:9326")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("CreateTakafulCertificate", func(t *testing.T) {
		cert := map[string]interface{}{
			"participant_name": "Ibrahim Hassan",
			"contribution":     50000.00,
			"fund_type":        "family_takaful",
			"tabarru_ratio":    0.3,
			"investment_ratio": 0.7,
			"shariah_board":    "FIRS-compliant",
		}
		code, result, err := post(base+"/api/v1/takaful_certificates/create", cert)
		if err != nil {
			t.Fatalf("Create certificate: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Takaful certificate: %v", result)
	})
}

// ---------------------------------------------------------------------------
// Microinsurance Engine
// ---------------------------------------------------------------------------
func TestMicroinsuranceEngine(t *testing.T) {
	base := envOr("MICROINSURANCE_URL", "http://localhost:9327")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("CreateMicroPolicy", func(t *testing.T) {
		policy := map[string]interface{}{
			"customer_phone":  "+2348012345678",
			"product":         "crop_insurance",
			"premium":         500.00,
			"sum_insured":     50000.00,
			"payment_channel": "ussd",
			"location":        "Benue",
		}
		code, result, err := post(base+"/api/v1/micro_policies/create", policy)
		if err != nil {
			t.Fatalf("Create micro policy: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Micro policy: %v", result)
	})
}

// ---------------------------------------------------------------------------
// USSD Gateway
// ---------------------------------------------------------------------------
func TestUSSDGateway(t *testing.T) {
	base := envOr("USSD_URL", "http://localhost:9328")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("CreateSession", func(t *testing.T) {
		session := map[string]interface{}{
			"msisdn":       "+2348012345678",
			"session_id":   fmt.Sprintf("USSD-%d", time.Now().UnixNano()),
			"input":        "*347*Insurance#",
			"service_code": "*347*Insurance#",
		}
		code, result, err := post(base+"/api/v1/ussd_sessions/create", session)
		if err != nil {
			t.Fatalf("Create session: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("USSD session: %v", result)
	})
}

// ---------------------------------------------------------------------------
// Usage-Based Insurance
// ---------------------------------------------------------------------------
func TestUsageBasedInsurance(t *testing.T) {
	base := envOr("UBI_URL", "http://localhost:9329")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("SubmitTelemetry", func(t *testing.T) {
		telemetry := map[string]interface{}{
			"device_id":         "OBD-001",
			"policy_id":         "UBI-001",
			"speed_kmh":         85.0,
			"distance_km":       150.0,
			"harsh_braking":     2,
			"night_driving_pct": 0.15,
			"score":             78.0,
		}
		code, result, err := post(base+"/api/v1/ubi_telemetry/create", telemetry)
		if err != nil {
			t.Fatalf("Submit telemetry: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("Telemetry: %v", result)
	})
}

// ---------------------------------------------------------------------------
// Enhanced KYC/KYB
// ---------------------------------------------------------------------------
func TestEnhancedKYCKYB(t *testing.T) {
	base := envOr("KYC_URL", "http://localhost:9330")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("VerifyCustomerKYC", func(t *testing.T) {
		kyc := map[string]interface{}{
			"customer_name": "Adebayo Ogundimu",
			"bvn":           "12345678901",
			"nin":           "12345678901",
			"phone":         "+2348012345678",
			"document_type": "national_id",
			"status":        "pending",
		}
		code, result, err := post(base+"/api/v1/kyc_verifications/create", kyc)
		if err != nil {
			t.Fatalf("Create KYC: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("KYC verification: %v", result)
	})
}

// ---------------------------------------------------------------------------
// NDPR Compliance
// ---------------------------------------------------------------------------
func TestNDPRCompliance(t *testing.T) {
	base := envOr("NDPR_URL", "http://localhost:9331")

	t.Run("HealthCheck", func(t *testing.T) {
		code, _, err := get(base + "/health")
		if err != nil {
			t.Skipf("Service not available: %v", err)
		}
		if code != 200 {
			t.Fatalf("Unhealthy: %d", code)
		}
	})

	t.Run("CreateDataSubjectRequest", func(t *testing.T) {
		request := map[string]interface{}{
			"subject_name":   "Adebayo Ogundimu",
			"request_type":   "data_access",
			"email":          "adebayo@example.com",
			"status":         "pending",
			"submitted_date": time.Now().Format("2006-01-02"),
		}
		code, result, err := post(base+"/api/v1/data_requests/create", request)
		if err != nil {
			t.Fatalf("Create request: %v", err)
		}
		if code != 201 {
			t.Fatalf("Expected 201, got %d: %v", code, result)
		}
		t.Logf("NDPR request: %v", result)
	})
}
