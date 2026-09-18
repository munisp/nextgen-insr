package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/insureportal/enhanced_kyc_kyb/config"
	"github.com/insureportal/enhanced_kyc_kyb/models"
)

func TestValidateQueryParam(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		key    string
		maxLen int
		want   string
		err    bool
	}{
		{"valid", "?name=test", "name", 100, "test", false},
		{"empty", "", "name", 100, "", false},
		{"too long", "?name=toolongvalue", "name", 5, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateQueryParam(req, tt.key, tt.maxLen)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}
func TestValidateIntParam(t *testing.T) {
	tests := []struct {
		name  string
		query string
		key   string
		want  int
		err   bool
	}{
		{"valid", "?page=5", "page", 5, false},
		{"empty", "", "page", 0, false},
		{"invalid", "?page=abc", "page", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateIntParam(req, tt.key)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

// --- F4 audit tests (NG-13, NG-14, NG-15) ---

func boolp(b bool) *bool { return &b }

func TestAdjudicateNIN(t *testing.T) {
	// all-clear verified
	if got := adjudicateNIN(&models.NINResult{Status: "verified", NameMatch: boolp(true), DOBMatch: boolp(true)}); got != "verified" {
		t.Fatalf("got %q", got)
	}
	// verified status but name mismatch → manual review, NOT verified
	if got := adjudicateNIN(&models.NINResult{Status: "verified", NameMatch: boolp(false)}); got != "mismatch" {
		t.Fatalf("mismatch expected, got %q", got)
	}
	if got := adjudicateNIN(&models.NINResult{Status: "verified", DOBMatch: boolp(false)}); got != "mismatch" {
		t.Fatalf("mismatch expected, got %q", got)
	}
	// failed status stays failed even with matches
	if got := adjudicateNIN(&models.NINResult{Status: "failed", NameMatch: boolp(true)}); got != "failed" {
		t.Fatalf("got %q", got)
	}
	if got := adjudicateNIN(nil); got != "failed" {
		t.Fatalf("nil result must fail closed, got %q", got)
	}
}

func TestAdjudicateBVN(t *testing.T) {
	if got := adjudicateBVN(&models.BVNResult{Status: "verified", NameMatch: boolp(true), BiometricMatch: boolp(true)}); got != "verified" {
		t.Fatalf("got %q", got)
	}
	if got := adjudicateBVN(&models.BVNResult{Status: "verified", BiometricMatch: boolp(false)}); got != "mismatch" {
		t.Fatalf("got %q", got)
	}
	if got := adjudicateBVN(&models.BVNResult{Status: "failed"}); got != "failed" {
		t.Fatalf("got %q", got)
	}
}

// NG-13: tier must NOT be granted from identifier presence alone.
func TestDetermineTierRequiresVerifiedIdentity(t *testing.T) {
	// verified=false → base tier regardless of fields
	if tier, _ := determineTier(false, true, true); tier != 1 {
		t.Fatalf("unverified identity must stay tier 1, got %d", tier)
	}
	if tier, _ := determineTier(true, true, true); tier != 3 {
		t.Fatalf("verified full identity must be tier 3, got %d", tier)
	}
	if tier, limit := determineTier(true, true, false); tier != 2 || limit != 5000000 {
		t.Fatalf("got tier %d limit %d", tier, limit)
	}
}

// NG-15: PEP screening is a real HTTP call and fails closed.
func TestScreenPEP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		json.NewEncoder(w).Encode(map[string]bool{"match": body["name"] == "Sanctioned Person"})
	}))
	defer srv.Close()

	h := &Handler{cfg: &config.Config{PEPAPIURL: srv.URL}, httpCl: srv.Client()}
	match, err := h.screenPEP("Sanctioned Person", "1980-01-01", "NG")
	if err != nil || !match {
		t.Fatalf("expected PEP match, got %v %v", match, err)
	}
	match, err = h.screenPEP("Regular Citizen", "1990-01-01", "NG")
	if err != nil || match {
		t.Fatalf("expected no match, got %v %v", match, err)
	}

	// unconfigured provider fails loud
	h2 := &Handler{cfg: &config.Config{}, httpCl: srv.Client()}
	if _, err := h2.screenPEP("X", "", ""); err == nil {
		t.Fatal("unconfigured PEP provider must error (fail-closed)")
	}
}
