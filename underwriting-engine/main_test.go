package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCalculatePremium_Motor(t *testing.T) {
	req := QuoteRequest{Product: "motor", SumInsured: 5000000, Age: 35, ClaimsHistory: 0, Location: "Lagos"}
	result := calculatePremium(req)
	if result.Declined {
		t.Error("Motor quote should not be declined for standard profile")
	}
	if result.Premium <= 0 {
		t.Error("Premium should be positive")
	}
	if result.RiskClass != "preferred" {
		t.Errorf("Expected preferred risk class for 0 claims + Lagos, got %s", result.RiskClass)
	}
	if result.DiscountPct < 15 {
		t.Errorf("Expected >= 15%% discount for no claims, got %.0f%%", result.DiscountPct)
	}
}

func TestCalculatePremium_LifeDeclined(t *testing.T) {
	req := QuoteRequest{Product: "life", SumInsured: 10000000, Age: 80}
	result := calculatePremium(req)
	if !result.Declined {
		t.Error("Life insurance should be declined for age > 75")
	}
	if result.Reason == "" {
		t.Error("Declined quote should have a reason")
	}
}

func TestCalculatePremium_HealthHighRisk(t *testing.T) {
	// Age 65 + 4 claims = loading 0.75 + 0.60 = 1.35 > 1.0 → declined
	req := QuoteRequest{Product: "health", SumInsured: 2000000, Age: 65, ClaimsHistory: 4}
	result := calculatePremium(req)
	if !result.Declined {
		t.Error("Expected decline for age 65 + 4 claims (loading > 100%)")
	}
}

func TestCalculatePremium_HealthModerateRisk(t *testing.T) {
	// Age 55 + 2 claims = loading 0.25 + 0.20 = 0.45 → substandard
	req := QuoteRequest{Product: "health", SumInsured: 2000000, Age: 55, ClaimsHistory: 2}
	result := calculatePremium(req)
	if result.Declined {
		t.Error("Moderate risk should not be declined")
	}
	if result.RiskClass != "substandard" {
		t.Errorf("Expected substandard risk class, got %s", result.RiskClass)
	}
}

func TestCalculatePremium_MinimumPremium(t *testing.T) {
	req := QuoteRequest{Product: "home", SumInsured: 100000, Age: 30, ClaimsHistory: 0, Location: "Lagos"}
	result := calculatePremium(req)
	if result.Premium < 5000 {
		t.Errorf("Premium should not be below minimum ₦5,000, got ₦%.0f", result.Premium)
	}
}

func TestCalculatePremium_UnknownProduct(t *testing.T) {
	req := QuoteRequest{Product: "spaceship", SumInsured: 1000000}
	result := calculatePremium(req)
	if result.Declined {
		t.Error("Unknown product should use default rate, not decline")
	}
	if result.Premium <= 0 {
		t.Error("Should calculate premium even for unknown product")
	}
}

func TestCalculatePremium_ExcessiveLoading(t *testing.T) {
	req := QuoteRequest{Product: "health", SumInsured: 5000000, Age: 65, ClaimsHistory: 10}
	result := calculatePremium(req)
	if !result.Declined {
		t.Error("Excessive loading (>100%) should result in decline")
	}
}

func TestQuoteEndpoint_ValidRequest(t *testing.T) {
	body, _ := json.Marshal(QuoteRequest{Product: "motor", SumInsured: 3000000, Age: 40, Location: "Abuja"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/quote", bytes.NewReader(body))
	w := httptest.NewRecorder()
	handleQuote(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var result QuoteResponse
	json.NewDecoder(w.Body).Decode(&result)
	if result.Premium <= 0 {
		t.Error("Response should have positive premium")
	}
}

func TestQuoteEndpoint_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/quote", nil)
	w := httptest.NewRecorder()
	handleQuote(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("Expected 405 for GET, got %d", w.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	handleHealth(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestNoClaimsDiscount(t *testing.T) {
	with := QuoteRequest{Product: "motor", SumInsured: 5000000, ClaimsHistory: 2}
	without := QuoteRequest{Product: "motor", SumInsured: 5000000, ClaimsHistory: 0}
	premWith := calculatePremium(with)
	premWithout := calculatePremium(without)
	if premWithout.Premium >= premWith.Premium {
		t.Error("No-claims discount should reduce premium")
	}
}
