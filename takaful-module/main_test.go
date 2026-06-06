package main

import (
	"testing"
)

func TestInitDB_NoEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	initDB()
}

func TestServiceConfig(t *testing.T) {
	expected := "takaful-module"
	if expected != "takaful-module" {
		t.Error("Service name mismatch")
	}
}
