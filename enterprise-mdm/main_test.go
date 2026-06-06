package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListGoldenRecords(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/golden-records", nil)
	w := httptest.NewRecorder()
	listGoldenRecords(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestFindDuplicates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/duplicates", nil)
	w := httptest.NewRecorder()
	findDuplicates(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestDataQualityScore(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/data-quality", nil)
	w := httptest.NewRecorder()
	dataQualityScore(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Error("Expected non-empty data quality response")
	}
}
