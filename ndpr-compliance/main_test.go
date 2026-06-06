package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecordConsent(t *testing.T) {
	body := strings.NewReader(`{"user_id":"U001","purpose":"marketing","granted":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/consent", body)
	w := httptest.NewRecorder()
	recordConsent(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestSubmitDSAR(t *testing.T) {
	body := strings.NewReader(`{"user_id":"U001","type":"data_export","email":"user@example.com"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/dsar", body)
	w := httptest.NewRecorder()
	submitDSAR(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestGetDSARStatus(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/dsar/DSAR-001", nil)
	w := httptest.NewRecorder()
	getDSARStatus(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestReportBreach(t *testing.T) {
	body := strings.NewReader(`{"description":"Unauthorized access to customer data","severity":"high"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/breach", body)
	w := httptest.NewRecorder()
	reportBreach(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}
