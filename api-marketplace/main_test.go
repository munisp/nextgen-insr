package main

import (
	"net/http/httptest"
	"testing"
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
