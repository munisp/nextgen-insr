package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListDocuments(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	w := httptest.NewRecorder()
	listDocuments(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["documents"] == nil {
		t.Error("Expected documents in response")
	}
}

func TestGetVersions(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/DOC-001/versions", nil)
	w := httptest.NewRecorder()
	getVersions(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
