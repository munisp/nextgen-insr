package main

import (
	"testing"
)

func TestInitDB_NoEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	initDB()
}

func TestKafkaInit(t *testing.T) {
	t.Setenv("KAFKA_REST_URL", "http://localhost:9999")
	initKafka()
	if kafkaRestURL != "http://localhost:9999" {
		t.Errorf("Expected kafka URL from env, got %s", kafkaRestURL)
	}
}
