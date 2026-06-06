package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCalculateRiskScore_LowRisk(t *testing.T) {
	claim := ClaimRequest{
		Amount:   30000,
		Evidence: []string{"photo", "receipt", "police_report"},
		SubmittedAt: time.Now().Add(-48 * time.Hour),
	}
	score := calculateRiskScore(claim)
	if score >= 30 {
		t.Errorf("Expected low risk score (<30), got %.0f", score)
	}
}

func TestCalculateRiskScore_HighAmount(t *testing.T) {
	claim := ClaimRequest{
		Amount:   1500000,
		Evidence: []string{},
		SubmittedAt: time.Now(),
	}
	score := calculateRiskScore(claim)
	if score < 70 {
		t.Errorf("Expected high risk score (>=70) for ₦1.5M with no evidence, got %.0f", score)
	}
}

func TestAdjudicateClaim_AutoApprove(t *testing.T) {
	claim := ClaimRequest{
		ID:       "CLM-001",
		Amount:   25000,
		Evidence: []string{"photo", "receipt"},
		SubmittedAt: time.Now().Add(-48 * time.Hour),
	}
	result := adjudicateClaim(claim)
	if result.Decision != "approved" {
		t.Errorf("Expected auto-approve for ₦25K low-risk claim, got %s", result.Decision)
	}
	if result.Confidence < 0.9 {
		t.Errorf("Expected high confidence for auto-approve, got %.2f", result.Confidence)
	}
}

func TestAdjudicateClaim_Escalate(t *testing.T) {
	claim := ClaimRequest{
		ID:       "CLM-002",
		Amount:   750000,
		Evidence: []string{},
		SubmittedAt: time.Now(),
	}
	result := adjudicateClaim(claim)
	if result.Decision != "escalated" {
		t.Errorf("Expected escalation for ₦750K claim, got %s", result.Decision)
	}
	if result.AssignedTo != "executive_review_queue" {
		t.Errorf("Expected executive review queue, got %s", result.AssignedTo)
	}
}

func TestAdjudicateClaim_PendingReview(t *testing.T) {
	claim := ClaimRequest{
		ID:       "CLM-003",
		Amount:   200000,
		Evidence: []string{"photo"},
		SubmittedAt: time.Now().Add(-48 * time.Hour),
	}
	result := adjudicateClaim(claim)
	if result.Decision != "pending_review" {
		t.Errorf("Expected pending_review for ₦200K moderate claim, got %s", result.Decision)
	}
	if result.AssignedTo != "supervisor_queue" {
		t.Errorf("Expected supervisor queue, got %s", result.AssignedTo)
	}
}

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "healthy" {
		t.Errorf("Expected healthy status, got %s", resp["status"])
	}
	if resp["service"] != "claims-adjudication-engine" {
		t.Errorf("Expected service name, got %s", resp["service"])
	}
}

func TestAdjudicateEndpoint_InvalidMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/adjudicate", nil)
	w := httptest.NewRecorder()
	handleAdjudicate(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("Expected 405 for GET, got %d", w.Code)
	}
}

func TestAdjudicateEndpoint_ValidClaim(t *testing.T) {
	claim := ClaimRequest{
		ID:       "CLM-TEST",
		Amount:   15000,
		Evidence: []string{"photo", "receipt"},
		SubmittedAt: time.Now().Add(-24 * time.Hour),
	}
	body, _ := json.Marshal(claim)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/adjudicate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleAdjudicate(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var result AdjudicationResult
	json.NewDecoder(w.Body).Decode(&result)
	if result.ClaimID != "CLM-TEST" {
		t.Errorf("Expected claim ID CLM-TEST, got %s", result.ClaimID)
	}
}

func TestAdjudicateEndpoint_BadJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/adjudicate", bytes.NewReader([]byte("invalid")))
	w := httptest.NewRecorder()
	handleAdjudicate(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for bad JSON, got %d", w.Code)
	}
}

func TestRiskScoreCap(t *testing.T) {
	claim := ClaimRequest{
		Amount:   5000000,
		Evidence: []string{},
		SubmittedAt: time.Now(),
	}
	score := calculateRiskScore(claim)
	if score > 100 {
		t.Errorf("Risk score should be capped at 100, got %.0f", score)
	}
}
