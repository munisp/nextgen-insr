package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/insureportal/microinsurance-engine/models"
	"go.uber.org/zap"
)

func TestParseIntQuery(t *testing.T) {
	tests := []struct {
		name     string
		val      string
		fallback int
		want     int
	}{
		{"valid", "5", 0, 5},
		{"empty", "", 10, 10},
		{"invalid", "abc", 3, 0},
		{"negative", "-2", 7, 7},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseIntQuery(tt.val, tt.fallback); got != tt.want {
				t.Errorf("parseIntQuery(%q, %d) = %d, want %d", tt.val, tt.fallback, got, tt.want)
			}
		})
	}
}

func TestValidateProduct(t *testing.T) {
	valid := models.MicroProduct{
		ProductID: "MIC-1", Name: "Test", Premium: 100,
		CoverageAmount: 1000, MaxAge: 65, MinAge: 18,
		Status: models.ProductActive,
	}
	if err := validateProduct(valid); err != nil {
		t.Errorf("validateProduct(valid) = %v, want nil", err)
	}
	if err := validateProduct(models.MicroProduct{}); err == nil {
		t.Error("validateProduct(empty) = nil, want error")
	}
}

func TestValidateEnrollment(t *testing.T) {
	valid := struct {
		CustomerID    string            `json:"customer_id"`
		PhoneNumber   string            `json:"phone_number"`
		FirstName     string            `json:"first_name"`
		LastName      string            `json:"last_name"`
		DateOfBirth   string            `json:"date_of_birth"`
		ProductID     string            `json:"product_id"`
		Channel       string            `json:"channel"`
		PaymentMethod string            `json:"payment_method"`
		GroupID       string            `json:"group_id,omitempty"`
		KYCDocuments  map[string]string `json:"kyc_documents,omitempty"`
		Metadata      map[string]any    `json:"metadata,omitempty"`
	}{CustomerID: "C1", ProductID: "MIC-1", Channel: "ussd"}
	if err := validateEnrollment(valid); err != nil {
		t.Errorf("validateEnrollment(valid) = %v, want nil", err)
	}
	bad := valid
	bad.Channel = "carrier-pigeon"
	if err := validateEnrollment(bad); err == nil {
		t.Error("validateEnrollment(bad channel) = nil, want error")
	}
}

func TestHealthHandler(t *testing.T) {
	logger := zap.NewNop()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	healthHandler(logger)(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("health returned %d, want 200", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("unexpected content-type: %s", ct)
	}
}
