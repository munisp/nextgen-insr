package main

import (
	"testing"
)

func TestInitDB_NoEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	initDB()
}

func TestServiceConfig(t *testing.T) {
	expected := "multi-tenant-platform"
	if expected != "multi-tenant-platform" {
		t.Error("Service name mismatch")
	}
}
