package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetRates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rates", nil)
	w := httptest.NewRecorder()
	getRates(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["rates"] == nil {
		t.Error("Expected rates in response")
	}
}

func TestConvertCurrency(t *testing.T) {
	body := strings.NewReader(`{"from":"NGN","to":"USD","amount":500000}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/convert", body)
	w := httptest.NewRecorder()
	convertCurrency(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["converted"] == nil {
		t.Error("Expected converted_amount in response")
	}
}
