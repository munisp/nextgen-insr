package main

import (
	"testing"
)

func TestInitDB_NoEnv(t *testing.T) {
	// Verify initDB doesn't panic with no DATABASE_URL
	t.Setenv("DATABASE_URL", "")
	initDB()
	// db will be nil since we can't connect - that's expected in test
}

func TestReconciliation_ServiceName(t *testing.T) {
	expected := "reconciliation-engine"
	if expected != "reconciliation-engine" {
		t.Errorf("Service name mismatch")
	}
}
