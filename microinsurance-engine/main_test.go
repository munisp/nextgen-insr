package main

import (
	"net/http"
	"net/http/httptest"
	"encoding/json"
	"testing"
)

func TestListProducts(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/products", nil)
	w := httptest.NewRecorder()
	listProducts(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	products, ok := resp["products"].([]interface{})
	if !ok || len(products) == 0 {
		t.Error("Expected at least one product in response")
	}
}

func TestGetStats(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	w := httptest.NewRecorder()
	getStats(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestEnrollEndpoint_ReturnsResponse(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/enroll", nil)
	w := httptest.NewRecorder()
	enroll(w, req)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Errorf("Expected 200 or 201, got %d", w.Code)
	}
}
