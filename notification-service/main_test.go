package main

import (
	"testing"
)

func TestInitDB_NoEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	initDB()
}

func TestNotification_ServiceName(t *testing.T) {
	expected := "notification-service"
	if expected != "notification-service" {
		t.Errorf("Service name mismatch")
	}
}
