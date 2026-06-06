package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGetUserPoints(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/U001/points", nil)
	w := httptest.NewRecorder()
	getUserPoints(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["total_points"]; !ok {
		t.Error("Expected total_points in response")
	}
}

func TestAwardPoints(t *testing.T) {
	body := strings.NewReader(`{"user_id":"U001","points":100,"reason":"policy_purchase"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/points/award", body)
	w := httptest.NewRecorder()
	awardPoints(w, req)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Errorf("Expected success, got %d", w.Code)
	}
}

func TestGetLeaderboard(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/leaderboard", nil)
	w := httptest.NewRecorder()
	getLeaderboard(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}

func TestGetUserBadges(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/U001/badges", nil)
	w := httptest.NewRecorder()
	getUserBadges(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Expected 200, got %d", w.Code)
	}
}
