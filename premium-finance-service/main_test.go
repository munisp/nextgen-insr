package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCalculateInstallments(t *testing.T) {
	body := strings.NewReader(`{"premium":120000,"months":12,"interest_rate":15}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/installments", body)
	w := httptest.NewRecorder()
	calculateInstallments(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["monthly_installment"] == nil {
		t.Error("Expected monthly_payment in response")
	}
}

func TestPaymentSchedule(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/schedule/FIN-001", nil)
	w := httptest.NewRecorder()
	paymentSchedule(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
