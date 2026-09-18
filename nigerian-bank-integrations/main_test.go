package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/insureportal/nigerian-bank-integrations/config"
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

// --- F4 audit tests (NG-7, NG-8) ---

func TestGenerateTransferReference(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		ref := generateTransferReference()
		if len(ref) != 4+32 || !strings.HasPrefix(ref, "NIP-") {
			t.Fatalf("bad reference format: %q", ref)
		}
		if seen[ref] {
			t.Fatalf("collision on %q", ref)
		}
		seen[ref] = true
	}
}

func TestNIBSSClientNameEnquiry(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/name-enquiry" {
			_ = json.NewEncoder(w).Encode(map[string]string{"account_name": "Ada Lovelace", "bank_name": "GTBank"})
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()
	c := &nibssClient{baseURL: srv.URL, http: &http.Client{Timeout: 5 * time.Second}}
	name, bank, err := c.NameEnquiry(context.Background(), "0123456789", "058")
	if err != nil || name != "Ada Lovelace" || bank != "GTBank" {
		t.Fatalf("name enquiry: %q %q %v", name, bank, err)
	}
}

func TestNIBSSClientTransferAndRequery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/v1/nip/transfer":
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "pending"})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/v1/nip/transfers/"):
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "success"})
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	c := &nibssClient{baseURL: srv.URL, http: &http.Client{Timeout: 5 * time.Second}}
	st, err := c.NIPTransfer(context.Background(), map[string]interface{}{"reference": "NIP-x"})
	if err != nil || st != "pending" {
		t.Fatalf("transfer: %q %v", st, err)
	}
	st, err = c.RequeryTransfer(context.Background(), "NIP-x")
	if err != nil || st != "success" {
		t.Fatalf("requery: %q %v", st, err)
	}
}

// NG-7: without NIBSS_BASE_URL the transfer endpoint must fail LOUD (412),
// never store a fake "success" transfer.
func TestInitiateTransferFailsLoudWithoutNIBSS(t *testing.T) {
	s := &Server{
		Config: &config.Config{Bank: config.BankConfig{NIPMaxAmount: 10000000}},
		NIBSS:  newNIBSSClient(config.BankConfig{}), // empty base URL
		Logger: zap.NewNop().Sugar(),
	}
	body := strings.NewReader(`{"source_account":"0123456789","destination_account":"9876543210","amount":1000}`)
	req := httptest.NewRequest("POST", "/api/v1/transfer", body)
	rec := httptest.NewRecorder()
	s.handleInitiateTransfer(rec, req)
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, want 412; body=%s", rec.Code, rec.Body.String())
	}
}
