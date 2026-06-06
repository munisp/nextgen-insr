package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func Test_ValidateNuban(t *testing.T) {
	body := strings.NewReader(`{"account_number":"0123456789","bank_code":"058"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/validate-nuban", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	validateNUBAN(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func Test_NameEnquiry(t *testing.T) {
	body := strings.NewReader(`{"account_number":"0123456789","bank_code":"058"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/name-enquiry", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	nameEnquiry(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
