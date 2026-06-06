package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVerifyKYC(t *testing.T) {
	body := strings.NewReader(`{"bvn":"12345678901","nin":"98765432109","full_name":"Adewale Ogundimu","tier":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/kyc/verify", body)
	w := httptest.NewRecorder()
	verifyKYC(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Error("Expected non-empty response")
	}
}

func TestVerifyKYB(t *testing.T) {
	body := strings.NewReader(`{"rc_number":"RC123456","company_name":"Acme Insurance Ltd"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/kyb/verify", body)
	w := httptest.NewRecorder()
	verifyKYB(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestKycStatus(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/kyc/C001/status", nil)
	w := httptest.NewRecorder()
	kycStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
